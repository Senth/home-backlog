import type { Request, Response, Router } from "express";
import type {
	DocumentData,
	DocumentSnapshot,
	QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { apiNode, etagFor, visibleTo } from "./api-nodes.js";
import { type ApiCaller, caller, homeAccess, recordWrite } from "./auth.js";
import { type NodeBody, parseNodeBody } from "./body.js";
import { ApiError } from "./errors.js";
import {
	db,
	homesCollection,
	maxBatchWrites,
	nodesCollection,
} from "./firestore.js";
import { handle } from "./handler.js";
import {
	childAncestorIds,
	completionChange,
	defaultColumns,
	movedAncestorIds,
	rankAfter,
	type Status,
	type Visibility,
} from "./node.js";
import {
	type ParentFacts,
	refuseEmptyRootParticipants,
	refuseUnusableParticipants,
	validateNode,
} from "./validate.js";

/**
 * Creating, changing and deleting one node.
 *
 * These write with the Admin SDK, so `firestore.rules` enforces nothing here.
 * Every document assembled below therefore goes through `validateNode` before
 * it is committed, and none of them is written any other way.
 *
 * `PATCH` owns moves and reparents. The client splits them into `updateNode`,
 * `moveNode` and `reparentNode` because three different screens call them, which
 * is a UI concern: sending `status` makes the server recompute `rank` at the end
 * of the target column, and sending `parentId` makes it rewrite `ancestorIds`
 * for the whole subtree and fix both parents' counters. An agent should not have
 * to know which of three calls its edit needs.
 */

function homeNodes(homeId: string) {
	return db.collection(homesCollection).doc(homeId).collection(nodesCollection);
}

function param(request: Request, name: string): string {
	const value = request.params[name];
	if (typeof value !== "string" || value.length === 0) {
		throw new ApiError(400, "invalid_path", `Missing ${name} in the path.`);
	}
	return value;
}

function notFound(nodeId: string, homeId: string): ApiError {
	// The same answer for "not there" and "not yours", exactly as `getNode` in
	// `data/nodes.ts` returns the same null for both: telling them apart would
	// let a caller enumerate everyone else's private cards one guessed id at a
	// time.
	return new ApiError(404, "node_not_found", `No node ${nodeId} in ${homeId}.`);
}

async function visibleNode(
	homeId: string,
	nodeId: string,
	uid: string,
): Promise<DocumentSnapshot<DocumentData>> {
	const snapshot = await homeNodes(homeId).doc(nodeId).get();
	if (!snapshot.exists || !visibleTo(snapshot.data() ?? {}, uid)) {
		throw notFound(nodeId, homeId);
	}
	return snapshot;
}

function factsOf(snapshot: DocumentSnapshot<DocumentData>): ParentFacts {
	const data = snapshot.data() ?? {};
	return {
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

/** The parent a request names, resolved and checked, or `null` for the root. */
async function resolveParent(
	homeId: string,
	parentId: string | null,
	uid: string,
): Promise<ParentFacts | null> {
	if (parentId === null) return null;
	return factsOf(await visibleNode(homeId, parentId, uid));
}

/**
 * The rank of a node appended to the end of a `(parentId, status)` column.
 *
 * Read from the board query rather than from a `status`-ordered one, so that
 * this needs no index the app does not already have. A board is bounded by
 * construction, and the ranks come back in order — filtering by status preserves
 * that order, so the last match is the column's last card.
 *
 * The Admin SDK sees every sibling, including ones the caller cannot: that is
 * *better* than the app can do, because a rank computed against only the visible
 * cards could collide with an invisible one at the root board.
 */
async function rankAtEndOfColumn(
	homeId: string,
	parentId: string | null,
	status: Status,
	excludeId?: string,
): Promise<string> {
	const board = await homeNodes(homeId)
		.where("archived", "==", false)
		.where("parentId", "==", parentId)
		.orderBy("rank")
		.get();

	const column = board.docs.filter(
		(node) => node.get("status") === status && node.id !== excludeId,
	);
	return rankAfter(column.map((node) => String(node.get("rank") ?? "")));
}

/** Every descendant of a node, at any depth. */
async function descendantsOf(
	homeId: string,
	nodeId: string,
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
	// One query, with no visibility split. The app has to union two — a query may
	// hold only one `array-contains` clause, and it must be provably safe — but
	// the Admin SDK is subject to no rules, so this is both complete and simple.
	const subtree = await homeNodes(homeId)
		.where("ancestorIds", "array-contains", nodeId)
		.get();
	return subtree.docs;
}

/**
 * The cap on a subtree operation, in documents.
 *
 * A reparent or a cascading delete is **one batch** or it is nothing: a node
 * whose parent is gone is unreachable from every board and every breadcrumb, and
 * nothing in the app could ever find it again. Firestore commits at most 500
 * writes at once, and the moved node plus its parents take three of them, so a
 * subtree that will not fit is refused with a number rather than half-written.
 */
export function refuseOversizedSubtree(count: number, operation: string): void {
	if (count + 3 <= maxBatchWrites) return;
	throw new ApiError(
		409,
		"subtree_too_large",
		`${operation} would touch ${count} documents, and one atomic batch holds ${maxBatchWrites}. Do it in the app, or in smaller pieces.`,
	);
}

/**
 * `If-Match`, checked against the node's `updatedAt`.
 *
 * Optional, and the only concurrency control the API has: an agent that read a
 * card, thought about it, and comes back to write can find out that somebody
 * edited it in between rather than silently overwriting them. Every node
 * response carries the same value as its `ETag`.
 */
function checkPrecondition(
	request: Request,
	snapshot: DocumentSnapshot<DocumentData>,
): void {
	const expected = request.get("if-match");
	if (!expected) return;

	const current = etagOf(snapshot);
	if (expected.replace(/"/g, "") !== current.replace(/"/g, "")) {
		throw new ApiError(
			412,
			"version_mismatch",
			`This node has changed since ${expected}. Read it again before writing.`,
		);
	}
}

function etagOf(snapshot: DocumentSnapshot<DocumentData>): string {
	return etagFor(snapshot.get("updatedAt"));
}

/** Read the committed document back, so a response never carries a sentinel. */
async function respondWithNode(
	response: Response,
	homeId: string,
	nodeId: string,
	status: number,
): Promise<void> {
	const written = await homeNodes(homeId).doc(nodeId).get();
	response.setHeader("ETag", etagOf(written));
	response.status(status).json(apiNode(written.id, written.data() ?? {}));
}

/** Turn validation issues into the one 400 that names all of them at once. */
function refuseInvalid(
	data: Record<string, unknown>,
	context: { nodeId: string; parent: ParentFacts | null },
): void {
	const issues = validateNode(data, context);
	if (issues.length === 0) return;

	throw new ApiError(
		400,
		issues[0].code,
		issues[0].message,
		issues.map((issue) => ({
			field: issue.field,
			code: issue.code,
			message: issue.message,
		})),
	);
}

function counterFields(childCount: number, doneCount: number) {
	const fields: Record<string, unknown> = {};
	if (childCount !== 0) fields.childCount = FieldValue.increment(childCount);
	if (doneCount !== 0) fields.doneCount = FieldValue.increment(doneCount);
	return fields;
}

async function createNode(request: Request, response: Response): Promise<void> {
	const me: ApiCaller = caller(response);
	const homeId = param(request, "homeId");
	const home = await homeAccess(me, homeId);

	const body = parseNodeBody(request.body, "create");
	const parent = await resolveParent(homeId, body.parentId ?? null, me.uid);

	// A child always takes its parent's visibility — the uniform-visibility
	// invariant is what makes privacy queryable at all — so a body that disagrees
	// is refused rather than silently overridden.
	if (
		parent !== null &&
		body.visibility &&
		body.visibility !== parent.visibility
	) {
		throw new ApiError(
			400,
			"visibility_mismatch",
			`A child of a ${parent.visibility} node is ${parent.visibility}.`,
		);
	}

	const visibility: Visibility =
		parent?.visibility ?? body.visibility ?? "shared";
	// A private root gets its creator, and only its creator. Writing yourself out
	// of your own private node strands it where nobody can read or delete it; a
	// private *child* carries its parent's list, which is what makes "I am a
	// participant of every descendant I can read" true. A shared root left
	// unset takes every current member rather than `[]` — #102 refuses an empty
	// one, and the household is the only honest default for "who is this on".
	refuseUnusableParticipants(
		body.participantIds,
		parent === null,
		visibility,
		home.memberUids,
	);
	const participantIds =
		parent !== null
			? parent.visibility === "private"
				? [...parent.participantIds]
				: []
			: visibility === "private"
				? [me.uid]
				: (body.participantIds ?? home.memberUids);
	refuseEmptyRootParticipants(visibility, parent === null, participantIds);

	const status: Status = body.status ?? "backlog";
	const ancestorIds = childAncestorIds(parent);
	const ref = homeNodes(homeId).doc();

	const document: Record<string, unknown> = {
		title: (body.title ?? "").trim(),
		status,
		rank: await rankAtEndOfColumn(homeId, parent?.id ?? null, status),
		parentId: parent?.id ?? null,
		ancestorIds,
		locationId: null,
		locationAncestorIds: [],
		participantIds,
		assigneeIds: body.assigneeIds ?? [],
		visibility,
		// The board this node's *children* will form, frozen at creation.
		columns: [...defaultColumns],
		childCount: 0,
		doneCount: 0,
		dueDate: body.dueDate ?? null,
		priority: body.priority ?? null,
		blockedBy: body.blockedBy ?? [],
		notes: body.notes ?? "",
		checklist: body.checklist ?? [],
		effort: body.effort ?? null,
		photos: [],
		archived: false,
		// The mark a household reads on the node detail screen. Written here and
		// never again, and unwritable by any client — the rules see to that.
		createdVia: "api",
		completedAt: status === "done" ? FieldValue.serverTimestamp() : null,
		createdAt: FieldValue.serverTimestamp(),
		createdBy: me.uid,
		updatedAt: FieldValue.serverTimestamp(),
	};

	refuseInvalid(document, { nodeId: ref.id, parent });

	const batch = db.batch();
	batch.set(ref, document);
	if (parent !== null) {
		batch.update(
			homeNodes(homeId).doc(parent.id),
			counterFields(1, status === "done" ? 1 : 0),
		);
	}
	await batch.commit();
	await recordWrite(me, home);

	await respondWithNode(response, homeId, ref.id, 201);
}

async function patchNode(request: Request, response: Response): Promise<void> {
	const me = caller(response);
	const homeId = param(request, "homeId");
	const home = await homeAccess(me, homeId);

	const nodeId = param(request, "nodeId");
	const snapshot = await visibleNode(homeId, nodeId, me.uid);
	checkPrecondition(request, snapshot);

	const current = snapshot.data() ?? {};
	const body = parseNodeBody(request.body, "update");

	const reparenting = "parentId" in body;
	const oldParentId = (current.parentId ?? null) as string | null;
	const newParentId = reparenting ? (body.parentId ?? null) : oldParentId;

	const oldStatus = current.status as Status;
	const status = body.status ?? oldStatus;
	const statusChanged = status !== oldStatus;

	const parent = await resolveParent(homeId, newParentId, me.uid);

	if (reparenting && newParentId !== oldParentId) {
		// A node moved inside its own subtree is a cycle: unreachable from every
		// board and every breadcrumb, with nothing on any screen to say it exists.
		if (
			parent !== null &&
			(parent.id === nodeId || parent.ancestorIds.includes(nodeId))
		) {
			throw new ApiError(
				400,
				"cycle",
				"A node cannot be moved inside its own subtree.",
			);
		}
		// Visibility is uniform down a subtree and the API cannot flip it, so a
		// move that would change it is refused rather than half-performed.
		if (parent !== null && parent.visibility !== current.visibility) {
			throw new ApiError(
				400,
				"visibility_mismatch",
				`This node is ${current.visibility} and that parent is ${parent.visibility}. An API key cannot change visibility.`,
			);
		}
	}

	const moved = reparenting && newParentId !== oldParentId;
	const descendants = moved ? await descendantsOf(homeId, nodeId) : [];
	if (moved) refuseOversizedSubtree(descendants.length, "This move");

	const completion = completionChange(oldStatus, status);
	const ancestorIds = moved
		? childAncestorIds(parent)
		: ((current.ancestorIds ?? []) as string[]);

	// The identical asymmetry `data/nodes.ts`'s `reparentNode` has, and the
	// identical fix (#102): a shared step promoted to a root takes the old
	// root's participants, since a root can no longer hold `[]`. It costs one
	// `get()` of that root, which — being shared — is readable by every member.
	const promoting = moved && parent === null && current.visibility === "shared";
	let promotedParticipants: string[] = [];
	if (promoting) {
		const oldAncestorIds = (current.ancestorIds ?? []) as string[];
		const rootId = oldAncestorIds[0] ?? nodeId;
		const rootSnapshot = await homeNodes(homeId).doc(rootId).get();
		const rootParticipants = rootSnapshot.get("participantIds");
		promotedParticipants = Array.isArray(rootParticipants)
			? (rootParticipants as string[])
			: [];
		refuseEmptyRootParticipants("shared", true, promotedParticipants);
	}

	const changes: Record<string, unknown> = {
		...(body.title !== undefined ? { title: body.title.trim() } : {}),
		...(body.notes !== undefined ? { notes: body.notes } : {}),
		...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
		...(body.priority !== undefined ? { priority: body.priority } : {}),
		...(body.effort !== undefined ? { effort: body.effort } : {}),
		...(body.assigneeIds !== undefined
			? { assigneeIds: body.assigneeIds }
			: {}),
		...(body.blockedBy !== undefined ? { blockedBy: body.blockedBy } : {}),
		...(body.checklist !== undefined ? { checklist: body.checklist } : {}),
		...(body.status !== undefined ? { status } : {}),
		...(completion === "set"
			? { completedAt: FieldValue.serverTimestamp() }
			: {}),
		...(completion === "clear" ? { completedAt: null } : {}),
		...(moved
			? {
					parentId: newParentId,
					ancestorIds,
					// Participants answer a question about a *project*. A shared root
					// that becomes a step keeps them otherwise, and the board's
					// default-hide filter is uniform at every depth — so the step would
					// stay hidden from everyone not on it, with no control able to clear
					// it. A private node must keep its list: every descendant carries
					// all of its parent's participants.
					...(parent !== null && current.visibility === "shared"
						? { participantIds: [] }
						: {}),
					...(promoting ? { participantIds: promotedParticipants } : {}),
				}
			: {}),
		updatedAt: FieldValue.serverTimestamp(),
	};

	// A rank is ordered within its `(parentId, status)` column, so a new column —
	// whether reached by a status change or by a move — needs one computed from
	// that column's neighbours.
	if (statusChanged || moved) {
		changes.rank = await rankAtEndOfColumn(homeId, newParentId, status, nodeId);
	}

	refuseInvalid({ ...current, ...changes }, { nodeId, parent });

	const batch = db.batch();
	batch.update(homeNodes(homeId).doc(nodeId), changes);

	if (moved) {
		if (oldParentId !== null) {
			batch.update(
				homeNodes(homeId).doc(oldParentId),
				counterFields(-1, oldStatus === "done" ? -1 : 0),
			);
		}
		if (newParentId !== null) {
			batch.update(
				homeNodes(homeId).doc(newParentId),
				counterFields(1, status === "done" ? 1 : 0),
			);
		}
		for (const descendant of descendants) {
			batch.update(descendant.ref, {
				ancestorIds: movedAncestorIds(
					(descendant.get("ancestorIds") ?? []) as string[],
					nodeId,
					ancestorIds,
				),
				updatedAt: FieldValue.serverTimestamp(),
			});
		}
	} else if (completion !== "keep" && oldParentId !== null) {
		// The card stayed where it is and crossed Done. Only its parent's
		// `doneCount` moves.
		batch.update(
			homeNodes(homeId).doc(oldParentId),
			counterFields(0, completion === "set" ? 1 : -1),
		);
	}

	await batch.commit();
	await recordWrite(me, home);

	await respondWithNode(response, homeId, nodeId, 200);
}

async function deleteNode(request: Request, response: Response): Promise<void> {
	const me = caller(response);
	const homeId = param(request, "homeId");
	const home = await homeAccess(me, homeId);

	const nodeId = param(request, "nodeId");
	const snapshot = await visibleNode(homeId, nodeId, me.uid);
	checkPrecondition(request, snapshot);

	const descendants = await descendantsOf(homeId, nodeId);
	const cascade = request.query.cascade === "true";

	/*
	 * The API's confirmation dialog.
	 *
	 * The app makes a destructive delete deliberate with a `ConfirmDialog`; over
	 * REST the equivalent is that the destructive act has to be spelled out in
	 * the request rather than stumbled into — and the first answer tells the
	 * caller exactly how much it was about to remove.
	 *
	 * Refusing to delete a root outright was rejected: an agent that wrote a
	 * wrong tree could then never clean up after itself, and every mistake would
	 * become somebody's manual work.
	 */
	if (descendants.length > 0 && !cascade) {
		const children = descendants.filter(
			(node) => node.get("parentId") === nodeId,
		).length;
		throw new ApiError(
			409,
			"has_children",
			`This node has ${children} step${children === 1 ? "" : "s"} and ${descendants.length} document${descendants.length === 1 ? "" : "s"} below it. Repeat with ?cascade=true to delete them all.`,
		);
	}

	refuseOversizedSubtree(descendants.length, "This delete");

	const batch = db.batch();
	for (const descendant of descendants) batch.delete(descendant.ref);
	batch.delete(homeNodes(homeId).doc(nodeId));

	// Only **one** parent's counters move, however large the subtree: every
	// descendant's parent is inside the subtree and goes with it, so the only
	// document left holding a count of something gone is this node's own parent.
	const parentId = (snapshot.get("parentId") ?? null) as string | null;
	if (parentId !== null) {
		batch.update(
			homeNodes(homeId).doc(parentId),
			counterFields(-1, snapshot.get("status") === "done" ? -1 : 0),
		);
	}

	await batch.commit();
	await recordWrite(me, home);

	response.json({ id: nodeId, deleted: descendants.length + 1 });
}

export function registerWriteRoutes(v1: Router): void {
	v1.post("/homes/:homeId/nodes", handle(createNode));
	v1.patch("/homes/:homeId/nodes/:nodeId", handle(patchNode));
	v1.delete("/homes/:homeId/nodes/:nodeId", handle(deleteNode));
}

export type { NodeBody };
