import type { Request, Response, Router } from "express";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { visibleTo } from "./api-nodes.js";
import { type ApiCaller, caller, homeAccess, recordWrite } from "./auth.js";
import { type BulkPlan, parseBulkBody, planBulk } from "./bulk.js";
import { ApiError } from "./errors.js";
import {
	db,
	homesCollection,
	nodesCollection,
	runsCollection,
} from "./firestore.js";
import { handle } from "./handler.js";
import { rankAfter, type Status } from "./node.js";
import type { ParentFacts } from "./validate.js";

/**
 * `POST /v1/homes/{h}/nodes:bulk` — one agent run, one new subtree, one commit.
 *
 * The plan is built and validated whole by `bulk.ts` with no I/O at all; this
 * file is the four reads it needs, the batch, and the replay record.
 */

/**
 * How long a run is remembered.
 *
 * Long enough for a retry loop, a rerun after a crash, or a person noticing in
 * the morning; short enough that the collection does not grow forever. A
 * Firestore TTL policy on `expiresAt` does the deleting, and it is configured
 * per collection group rather than by `firebase deploy` — see `OPERATIONS.md`.
 */
const runTtlHours = 24;

/**
 * An `Idempotency-Key` has to be a legal Firestore document id, because that is
 * what it becomes. Refusing an unusable one is better than hashing it into
 * something the caller cannot recognise in a later error.
 */
const idempotencyKeyPattern = /^[A-Za-z0-9_.:-]{1,200}$/;

function idempotencyKeyOf(request: Request): string | null {
	const key = request.get("idempotency-key");
	if (!key) return null;
	if (!idempotencyKeyPattern.test(key) || key === "." || key === "..") {
		throw new ApiError(
			400,
			"invalid_idempotency_key",
			"An Idempotency-Key is 1–200 characters of letters, digits, `-`, `_`, `.` or `:`.",
		);
	}
	return key;
}

async function bulkCreate(request: Request, response: Response): Promise<void> {
	const me: ApiCaller = caller(response);
	const homeId = request.params.homeId;
	if (!homeId) {
		throw new ApiError(400, "invalid_path", "Missing homeId in the path.");
	}
	const home = await homeAccess(me, homeId);

	const nodes = db
		.collection(homesCollection)
		.doc(homeId)
		.collection(nodesCollection);

	const idempotencyKey = idempotencyKeyOf(request);
	const runRef =
		idempotencyKey === null
			? null
			: me.keyRef.collection(runsCollection).doc(idempotencyKey);

	// The replay, checked before any work. A run is recorded under the key that
	// made it, so revoking a key takes its history with it — and so the node
	// document stays exactly what `boards-and-nodes` describes, with no API
	// concern in a schema every screen and every rule then carries forever.
	if (runRef !== null) {
		const previous = await runRef.get();
		if (previous.exists) {
			response.setHeader("Idempotency-Replayed", "true");
			response.json({
				rootId: previous.get("rootId"),
				ids: previous.get("ids"),
			});
			return;
		}
	}

	const payload = parseBulkBody(request.body);

	let parent: ParentFacts | null = null;
	if (payload.parentId !== null) {
		const snapshot = await nodes.doc(payload.parentId).get();
		if (!snapshot.exists || !visibleTo(snapshot.data() ?? {}, me.uid)) {
			throw new ApiError(
				404,
				"node_not_found",
				`No node ${payload.parentId} in ${homeId}.`,
			);
		}
		const data = snapshot.data() ?? {};
		parent = {
			id: snapshot.id,
			visibility: data.visibility === "private" ? "private" : "shared",
			participantIds: Array.isArray(data.participantIds)
				? (data.participantIds as string[])
				: [],
			columns: Array.isArray(data.columns) ? (data.columns as Status[]) : [],
			ancestorIds: Array.isArray(data.ancestorIds)
				? (data.ancestorIds as string[])
				: [],
		};
	}

	const rootStatus: Status =
		payload.nodes.find((node) => node.parentRef === null)?.status ?? "backlog";
	const board = await nodes
		.where("archived", "==", false)
		.where("parentId", "==", payload.parentId)
		.orderBy("rank")
		.get();
	const rootRank = rankAfter(
		board.docs
			.filter((node) => node.get("status") === rootStatus)
			.map((node) => String(node.get("rank") ?? "")),
	);

	const plan: BulkPlan = planBulk({
		payload,
		idFor: Object.fromEntries(
			payload.nodes.map((node) => [node.ref, nodes.doc().id]),
		),
		parent,
		rootRank,
		createdBy: me.uid,
		memberUids: home.memberUids,
		now: FieldValue.serverTimestamp(),
	});

	// One batch, all of it. The Admin SDK bypasses the rules, which is what makes
	// this possible at all: under them a child written before its parent commits
	// fails `inheritsFrom`, so the tree would have to go top-down over a network,
	// where a timeout mid-flight leaves half a tree — and half a tree is not
	// untidy but corrupt.
	const batch = db.batch();
	for (const item of plan.items) batch.set(nodes.doc(item.id), item.data);

	if (parent !== null) {
		batch.update(nodes.doc(parent.id), {
			childCount: FieldValue.increment(1),
			...(rootStatus === "done" ? { doneCount: FieldValue.increment(1) } : {}),
		});
	}

	if (runRef !== null) {
		// In the same batch as the tree, deliberately. A replay record written
		// separately could fail on its own, and an agent that retried would then
		// write the whole subtree a second time.
		batch.set(runRef, {
			ids: plan.ids,
			rootId: plan.rootId,
			createdAt: FieldValue.serverTimestamp(),
			expiresAt: Timestamp.fromMillis(
				Date.now() + runTtlHours * 60 * 60 * 1000,
			),
		});
	}

	await batch.commit();
	await recordWrite(me, home);

	response.status(201).json({ rootId: plan.rootId, ids: plan.ids });
}

export function registerBulkRoute(v1: Router): void {
	// `:bulk` rather than `/bulk`, so the path can never collide with a node id.
	v1.post("/homes/:homeId/nodes\\:bulk", handle(bulkCreate));
}
