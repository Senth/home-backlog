import { asObject, type NodeBody, parseNodeBody } from "./body.js";
import { ApiError, type ApiErrorDetail } from "./errors.js";
import { maxBatchWrites } from "./firestore.js";
import {
	defaultColumns,
	rankSequence,
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
 * A whole subtree, planned before a single document is written.
 *
 * This is the endpoint the feature exists for: an agent researches a job,
 * breaks it into steps, and files the result as one tree. Three decisions shape
 * everything below.
 *
 * **Validate all, then commit atomically.** Every node in the payload is checked
 * before anything is written, so the caller gets per-index errors it can fix and
 * resend, and a half-written tree never exists. Partial success was rejected: it
 * only helps if failures are unpredictable at validation time, and they are not
 * — a too-long title, an unknown status, a `parentRef` naming nothing are all
 * decidable before writing. What it would buy instead is the orphan.
 *
 * **The server assigns ids; the payload uses local refs.** Caller-supplied
 * document ids give a beautiful replay story and agents generate `"1"`, `"2"`,
 * `"3"`: those collide with the next run in the same home, they make the replay
 * test misfire (`all ids already exist` then means *someone else used them*),
 * monotonic ids concentrate writes into one index range, and some strings are
 * not legal document ids at all. Replay is therefore explicit, through
 * `Idempotency-Key`.
 *
 * **One call is one new root.** Exactly one node has no `parentRef`. That is
 * what makes a run undoable: one run, one root, one delete, one confirmation.
 * A forest payload would leave somebody deleting each root by hand, online-only,
 * one confirmation each, for a single mistaken run.
 */

/**
 * The most nodes one call may carry.
 *
 * A Firestore batch commits 500 writes, and two of them are spoken for: the
 * attach parent's counters, and the replay record. Both ride in the same batch
 * on purpose — a run whose replay record failed separately would be re-run in
 * full by an agent that retried.
 */
export const maxBulkNodes = maxBatchWrites - 2;

export interface BulkNode extends NodeBody {
	/** Caller-chosen, unique, and meaningful only inside this request. */
	ref: string;
	/** Another node's `ref`. Absent on exactly one node: the new root. */
	parentRef: string | null;
	/** Where this node sat in the request, so an error can point at it. */
	index: number;
}

export interface BulkPayload {
	/** An existing node to attach the new root under, or null for the root board. */
	parentId: string | null;
	nodes: BulkNode[];
}

export interface BulkPlanItem {
	ref: string;
	id: string;
	data: Record<string, unknown>;
}

export interface BulkPlan {
	rootId: string;
	/** `ref` → id, which is what the response returns and the replay stores. */
	ids: Record<string, string>;
	items: BulkPlanItem[];
}

export interface BulkContext {
	payload: BulkPayload;
	/** One generated document id per ref, made by the handler. */
	idFor: Record<string, string>;
	/** The existing node the root attaches under, already resolved and readable. */
	parent: ParentFacts | null;
	/** The rank the new root takes in its column at the attach point. */
	rootRank: string;
	createdBy: string;
	/** Every current member's uid, for a shared root that names none. */
	memberUids: readonly string[];
	/** A server timestamp sentinel, or a real date in a test. */
	now: unknown;
}

function fail(details: ApiErrorDetail[]): never {
	throw new ApiError(
		400,
		details[0].code,
		details.length === 1
			? details[0].message
			: `${details.length} nodes in this payload are not valid. Nothing was written.`,
		details,
	);
}

/**
 * Read a bulk payload, with each node's own fields checked by the same
 * allow-list a single create uses.
 *
 * `ref` and `parentRef` are permitted alongside the node fields; `parentId` on a
 * node is not, and says so — inside a payload, structure is expressed in refs,
 * and a node naming a real id as its parent would be a second root wearing a
 * disguise.
 */
export function parseBulkBody(body: unknown): BulkPayload {
	const raw = asObject(body);

	const parentId =
		raw.parentId === undefined || raw.parentId === null
			? null
			: typeof raw.parentId === "string"
				? raw.parentId
				: fail([
						{
							field: "parentId",
							code: "invalid_type",
							message: "parentId must be a node id or null.",
						},
					]);

	if (!Array.isArray(raw.nodes)) {
		fail([
			{
				field: "nodes",
				code: "invalid_type",
				message: "nodes must be a list of nodes to create.",
			},
		]);
	}
	if (raw.nodes.length === 0) {
		fail([
			{
				field: "nodes",
				code: "empty_payload",
				message: "A bulk create needs at least one node.",
			},
		]);
	}
	if (raw.nodes.length > maxBulkNodes) {
		fail([
			{
				field: "nodes",
				code: "too_many_nodes",
				message: `A bulk create writes at most ${maxBulkNodes} nodes, because it commits as one atomic batch. Send the rest as a second run under the same root.`,
			},
		]);
	}

	const details: ApiErrorDetail[] = [];
	const nodes: BulkNode[] = [];

	for (const [index, entry] of raw.nodes.entries()) {
		try {
			const object = asObject(entry);
			if ("parentId" in object) {
				details.push({
					index,
					field: "parentId",
					code: "parent_id_in_bulk",
					message:
						"Inside a payload, name the parent with parentRef. The request's own parentId attaches the whole tree under an existing node.",
				});
				continue;
			}

			// The single-node verbs file work in a place (#246); the bulk planner
			// does not resolve places, so a payload that named one would be
			// silently unfiled — refused rather than ignored.
			if ("locationId" in object || "locationAncestorIds" in object) {
				details.push({
					index,
					field: "locationId" in object ? "locationId" : "locationAncestorIds",
					code: "locations_unavailable",
					message:
						"A bulk create files nothing yet: it cannot check a location id. PATCH each node's locationId afterwards.",
				});
				continue;
			}

			const fields = parseNodeBody(object, "create", ["ref", "parentRef"]);
			const ref = object.ref;
			if (typeof ref !== "string" || ref.length === 0) {
				details.push({
					index,
					field: "ref",
					code: "ref_required",
					message: "Every node needs a ref, so the others can point at it.",
				});
				continue;
			}
			const parentRef = object.parentRef ?? null;
			if (parentRef !== null && typeof parentRef !== "string") {
				details.push({
					index,
					field: "parentRef",
					code: "invalid_type",
					message: "parentRef must be another node's ref, or absent.",
				});
				continue;
			}

			nodes.push({ ...fields, ref, parentRef, index });
		} catch (error) {
			if (!(error instanceof ApiError)) throw error;
			// A single node's own refusal, re-pointed at its position in the array.
			for (const detail of error.details ?? [
				{ code: error.code, message: error.message },
			]) {
				details.push({ ...detail, index });
			}
		}
	}

	if (details.length > 0) fail(details);
	return { parentId, nodes };
}

/** The facts a node contributes as a parent to the nodes below it. */
interface PlannedFacts extends ParentFacts {
	depth: number;
}

/**
 * Turn a payload into the exact documents to write, or refuse it whole.
 *
 * Pure: no I/O, so the write is a separate step that either commits everything
 * or nothing. Every check here is decidable from the payload plus the four facts
 * the handler read once.
 */
export function planBulk(context: BulkContext): BulkPlan {
	const { payload, idFor, parent, rootRank, createdBy, memberUids, now } =
		context;
	const { nodes } = payload;

	const details: ApiErrorDetail[] = [];
	const byRef = new Map<string, BulkNode>();

	for (const node of nodes) {
		if (byRef.has(node.ref)) {
			details.push({
				index: node.index,
				field: "ref",
				code: "duplicate_ref",
				message: `Two nodes share the ref "${node.ref}".`,
			});
			continue;
		}
		byRef.set(node.ref, node);
	}
	if (details.length > 0) fail(details);

	for (const node of nodes) {
		if (node.parentRef !== null && !byRef.has(node.parentRef)) {
			details.push({
				index: node.index,
				field: "parentRef",
				code: "unknown_parent_ref",
				message: `No node in this payload has the ref "${node.parentRef}". To attach under an existing node, use the request's parentId.`,
			});
		}
		if (node.parentRef !== null && node.visibility !== undefined) {
			details.push({
				index: node.index,
				field: "visibility",
				code: "visibility_mismatch",
				message:
					"Only the root of a payload sets visibility; every node under it inherits.",
			});
		}
		if (node.parentRef !== null && node.participantIds !== undefined) {
			details.push({
				index: node.index,
				field: "participantIds",
				code: "participants_immutable",
				message:
					"Only the root of a payload sets participants; every node under it inherits.",
			});
		}
	}
	if (details.length > 0) fail(details);

	const roots = nodes.filter((node) => node.parentRef === null);
	if (roots.length !== 1) {
		// One call is one new root, which is what makes a run undoable: one run,
		// one root, one delete, one confirmation dialog.
		fail(
			roots.length === 0
				? [
						{
							field: "nodes",
							code: "no_root",
							message:
								"Exactly one node must have no parentRef. This payload has none, which means its refs form a cycle.",
						},
					]
				: roots.map((node) => ({
						index: node.index,
						field: "parentRef",
						code: "not_one_root",
						message: `One call creates one subtree, so exactly one node may have no parentRef. This payload has ${roots.length}.`,
					})),
		);
	}

	const root = roots[0];
	const childrenOf = new Map<string, BulkNode[]>();
	for (const node of nodes) {
		if (node.parentRef === null) continue;
		const siblings = childrenOf.get(node.parentRef) ?? [];
		siblings.push(node);
		childrenOf.set(node.parentRef, siblings);
	}

	// Breadth-first from the one root. Anything this does not reach is in a cycle
	// among itself — which would otherwise commit as documents unreachable from
	// every board and every breadcrumb, the exact failure atomicity is for.
	const rootVisibility: Visibility =
		parent?.visibility ?? root.visibility ?? "shared";
	// The same two guards `createNode` runs, re-pointed at the root's index. The
	// payload's root is a real root only when nothing was named to attach it
	// under; otherwise it is a child and takes its parent's list like any other.
	// A shared root left unset takes every current member — `[]` on a root is
	// refused by the rules since #102, and a bulk-written one would be frozen
	// against every later update, including the `childCount` bump a new step
	// makes.
	const rootParticipants =
		parent !== null
			? parent.visibility === "private"
				? [...parent.participantIds]
				: []
			: rootVisibility === "private"
				? [createdBy]
				: (root.participantIds ?? [...memberUids]);
	try {
		refuseUnusableParticipants(
			root.participantIds,
			parent === null,
			rootVisibility,
			memberUids,
		);
		refuseEmptyRootParticipants(
			rootVisibility,
			parent === null,
			rootParticipants,
		);
	} catch (error) {
		if (!(error instanceof ApiError)) throw error;
		fail([
			{
				index: root.index,
				field: "participantIds",
				code: error.code,
				message: error.message,
			},
		]);
	}
	const rootDepth = parent === null ? 0 : parent.ancestorIds.length + 1;

	const items: BulkPlanItem[] = [];
	const factsOf = new Map<string, PlannedFacts>();
	const queue: { node: BulkNode; facts: PlannedFacts | null; rank: string }[] =
		[{ node: root, facts: null, rank: rootRank }];

	while (queue.length > 0) {
		const { node, facts, rank } = queue.shift() as (typeof queue)[number];
		const id = idFor[node.ref];
		const depth = facts === null ? rootDepth : facts.depth + 1;
		const ancestorIds =
			facts === null
				? parent === null
					? []
					: [...parent.ancestorIds, parent.id]
				: [...facts.ancestorIds, facts.id];
		const visibility = facts === null ? rootVisibility : facts.visibility;
		const participantIds =
			facts === null
				? rootParticipants
				: facts.visibility === "private"
					? [...facts.participantIds]
					: [];

		const children = childrenOf.get(node.ref) ?? [];
		const status: Status = node.status ?? "backlog";

		const data: Record<string, unknown> = {
			title: (node.title ?? "").trim(),
			status,
			rank,
			parentId: facts === null ? (parent?.id ?? null) : facts.id,
			ancestorIds,
			locationId: null,
			locationAncestorIds: [],
			participantIds,
			assigneeIds: node.assigneeIds ?? [],
			visibility,
			columns: [...defaultColumns],
			// Computed by the endpoint, never taken from the body: the payload is
			// the only thing that knows how many children each node has, and a
			// caller-supplied count could disagree with the tree it arrived with.
			childCount: children.length,
			doneCount: children.filter((child) => child.status === "done").length,
			dueDate: node.dueDate ?? null,
			priority: node.priority ?? null,
			blockedBy: node.blockedBy ?? [],
			labelIds: node.labelIds ?? [],
			notes: node.notes ?? "",
			checklist: node.checklist ?? [],
			effort: node.effort ?? null,
			photos: [],
			archived: false,
			createdVia: "api",
			completedAt: status === "done" ? now : null,
			createdAt: now,
			createdBy,
			updatedAt: now,
		};

		const nodeContext: { nodeId: string; parent: ParentFacts | null } = {
			nodeId: id,
			parent: facts ?? parent,
		};
		for (const issue of validateNode(data, nodeContext)) {
			details.push({ ...issue, index: node.index });
		}

		items.push({ ref: node.ref, id, data });

		const own: PlannedFacts = {
			id,
			visibility,
			participantIds,
			columns: [...defaultColumns],
			ancestorIds,
			depth,
		};
		factsOf.set(node.ref, own);

		// Ranks come from one `rankSequence` per (parent, status) column, in the
		// order the caller listed them — a fold of pairwise calls would grow a
		// character per item, and array order is the only ordering a payload
		// expresses.
		for (const group of groupByStatus(children).values()) {
			const ranks = rankSequence(null, null, group.length);
			for (const [position, child] of group.entries()) {
				queue.push({ node: child, facts: own, rank: ranks[position] });
			}
		}
	}

	if (items.length !== nodes.length) {
		const stranded = nodes.filter((node) => !factsOf.has(node.ref));
		details.push(
			...stranded.map((node) => ({
				index: node.index,
				field: "parentRef",
				code: "cycle",
				message: `"${node.ref}" is not reachable from the payload's root, so its refs form a cycle.`,
			})),
		);
	}

	if (details.length > 0) fail(details);

	return {
		rootId: idFor[root.ref],
		ids: Object.fromEntries(items.map((item) => [item.ref, item.id])),
		items,
	};
}

/** Children grouped by the column they land in, keeping the caller's order. */
function groupByStatus(children: readonly BulkNode[]): Map<Status, BulkNode[]> {
	const groups = new Map<Status, BulkNode[]>();
	for (const child of children) {
		const status: Status = child.status ?? "backlog";
		const group = groups.get(status) ?? [];
		group.push(child);
		groups.set(status, group);
	}
	return groups;
}
