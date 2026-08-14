import type {
	DocumentData,
	QueryDocumentSnapshot,
	Timestamp,
} from "firebase/firestore";
import {
	BASE_62_DIGITS,
	generateKeyBetween,
	generateNKeysBetween,
} from "fractional-indexing";

/**
 * The one document type every board, task and subtask is made of.
 *
 * A project, a task and a subtask are the same shape at different depths, and
 * any node with children can be opened as a board. Depth is *derived* from
 * `ancestorIds.length`, never stored.
 *
 * Two invariants in here are not conveniences — the rules in `firestore.rules`
 * enforce them, and losing either one loses documents:
 *
 * 1. **A node's `visibility` equals its parent's.** Only a root node sets it.
 *    Firestore has no field-level read rules and allows a single
 *    `array-contains` per query, so `ancestorIds array-contains X &&
 *    participantIds array-contains me` is not expressible. Without uniform
 *    visibility, no client query can see another member's private descendant —
 *    so a reparent leaves it with stale `ancestorIds` and a delete orphans it
 *    permanently, with no error anywhere.
 * 2. **A private node's `participantIds` contains all of its parent's**, which
 *    is what makes "I am a participant of every descendant of a private node I
 *    can read" true, and so makes the private subtree query complete.
 *
 * The cost is a product restriction: a private card cannot live inside a shared
 * project. It sits at the root, or under another private card. That restriction
 * is worth having anyway — a hidden child makes its parent lie, and every count
 * derived from children diverges per viewer.
 */

/**
 * The global status vocabulary. A board chooses which of these to show; it
 * cannot invent new ones. Stored as a string id so a custom status is a new
 * value rather than a migration, and so cross-board queries stay comparable.
 */
export type Status =
	| "backlog"
	| "next_up"
	| "research"
	| "planning"
	| "execution"
	| "review"
	| "done"
	| "blocked";

export const statuses: readonly Status[] = [
	"backlog",
	"next_up",
	"research",
	"planning",
	"execution",
	"review",
	"done",
	"blocked",
];

export type Priority = "low" | "normal" | "high" | "urgent";

export const priorities: readonly Priority[] = [
	"low",
	"normal",
	"high",
	"urgent",
];

/**
 * Sorting and scoring go through the ordinal, never through the id's spelling,
 * so a new value in the middle of the scale needs no migration and no rename.
 */
export const priorityOrder: Record<Priority, number> = {
	low: 0,
	normal: 1,
	high: 2,
	urgent: 3,
};

/**
 * Deliberately semantic rather than duration-shaped: "an evening" has no
 * numeric form, and retuning what "quick" means must not become a migration.
 */
export type Effort = "quick" | "hours" | "evening" | "weekend" | "multi_week";

export const efforts: readonly Effort[] = [
	"quick",
	"hours",
	"evening",
	"weekend",
	"multi_week",
];

export const effortOrder: Record<Effort, number> = {
	quick: 0,
	hours: 1,
	evening: 2,
	weekend: 3,
	multi_week: 4,
};

export type Visibility = "shared" | "private";

export interface ChecklistItem {
	id: string;
	text: string;
	done: boolean;
}

export interface Photo {
	id: string;
	/**
	 * A Cloud Storage path, never a download URL — URLs carry tokens that
	 * rotate, so a stored one stops working without anything having changed.
	 */
	path: string;
	uploadedAt: Timestamp | null;
	uploadedBy: string;
}

export interface Node {
	id: string;
	title: string;
	status: Status;
	/** Fractional index, ordered within its `(parentId, status)` column. */
	rank: string;
	/** `null` is a root node. */
	parentId: string | null;
	/** Root → parent. The last element equals `parentId`. */
	ancestorIds: string[];
	/** Inherited from the parent unless overridden. */
	locationId: string | null;
	/** The denormalized location path, so a roll-up is one index lookup. */
	locationAncestorIds: string[];
	/** Who is working on this. Empty means unassigned. */
	participantIds: string[];
	/** Always equal to the parent's. Only a root node sets it. */
	visibility: Visibility;
	/** `'YYYY-MM-DD'` — a calendar day, not an instant. */
	dueDate: string | null;
	priority: Priority | null;
	/** Node ids this is waiting on (#66). */
	blockedBy: string[];
	notes: string;
	checklist: ChecklistItem[];
	effort: Effort | null;
	photos: Photo[];
	/** Constrains every board query, so it is written from the first document. */
	archived: boolean;
	/** Set if and only if `status === 'done'`. */
	completedAt: Timestamp | null;
	createdAt: Timestamp | null;
	createdBy: string;
	updatedAt: Timestamp | null;
}

/** Longest title a node may have, matched by `validNode()` in `firestore.rules`. */
export const maxTitleLength = 200;
/** Matched by `validNode()`. Notes absorb cost and budget until #57. */
export const maxNotesLength = 10000;
export const maxChecklistItems = 200;
export const maxPhotos = 50;

/*
 * ---------------------------------------------------------------------------
 * Rank
 * ---------------------------------------------------------------------------
 *
 * Drag and drop (#5) is post-MVP; `rank` exists now purely so that adding it is
 * a UI change with no data migration.
 *
 * A rank is ordered **within its `(parentId, status)` column** — that is what a
 * board reorder manipulates. Moving a card to another column recomputes its
 * rank from that column's neighbours in the same write as the status change.
 *
 * Fractional, not float: around fifty repeated midpoint inserts at one spot
 * exhaust double precision, and the renormalization pass that fixes it rewrites
 * a whole column — a batch write that fails offline, which is exactly where
 * drag and drop gets used. `fractional-indexing` has no such limit; a key just
 * grows a character.
 */

/** Base 62 over `0-9A-Za-z`, whose character order is also its sort order. */
const rankDigits = BASE_62_DIGITS;

/**
 * A rank between two neighbours in the same column. Either bound may be null —
 * `rankBetween(null, first)` is "at the top", `rankBetween(last, null)` is "at
 * the end".
 */
export function rankBetween(
	before: string | null,
	after: string | null,
): string {
	return generateKeyBetween(before, after, rankDigits);
}

/** The rank of a card appended to a column, given that column's last rank. */
export function rankAtEnd(last: string | null): string {
	return rankBetween(last, null);
}

/**
 * `count` ranks in order between two neighbours, for a bulk subtree create over
 * the REST API (#7). One call rather than a fold, because generating them
 * pairwise produces keys that grow a character per item.
 */
export function rankSequence(
	before: string | null,
	after: string | null,
	count: number,
): string[] {
	return generateNKeysBetween(before, after, count, rankDigits);
}

/**
 * The board sort: rank, then id.
 *
 * The id is not decoration. Two people offline can produce the same rank
 * between the same neighbours, and a tie that resolves by arrival order renders
 * differently on every device. Breaking it on the id costs no field and no
 * write, and it covers ties arriving from the REST API or a seeded fixture too;
 * the next drag breaks the tie permanently.
 */
export function compareNodes(a: Node, b: Node): number {
	if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/*
 * ---------------------------------------------------------------------------
 * Structure
 * ---------------------------------------------------------------------------
 */

/** The `ancestorIds` of a child of `parent` — `[]` for a root node. */
export function childAncestorIds(parent: Node | null): string[] {
	return parent === null ? [] : [...parent.ancestorIds, parent.id];
}

/**
 * A descendant's `ancestorIds` after the subtree it sits in has been moved.
 *
 * `movedAncestors` is the moved node's *new* path. Everything from the moved
 * node downwards keeps its own relative path — a reparent moves a subtree
 * whole, and no descendant's `parentId` changes — so the rewrite is a splice at
 * the point where the moved node appears.
 *
 * This is the function the split in `firestore.rules` leans on. The rules check
 * the path structurally rather than walking it, so a wrong *grandparent* id
 * passes them; `parentId` stays the source of truth and this is what derives
 * the rest of it, which is why it is tested rather than trusted.
 */
export function movedAncestorIds(
	descendant: Node,
	movedId: string,
	movedAncestors: readonly string[],
): string[] {
	const index = descendant.ancestorIds.indexOf(movedId);
	if (index === -1) return [...descendant.ancestorIds];
	return [...movedAncestors, ...descendant.ancestorIds.slice(index)];
}

/**
 * The results of the two board queries, as one board.
 *
 * Deduping is required rather than defensive: a *shared* node I participate in
 * matches both queries, and would otherwise be drawn twice. The merge lives
 * here, not in the hook, so it can be tested without Firestore.
 */
export function mergeNodeResults(
	shared: readonly Node[],
	participating: readonly Node[],
): Node[] {
	const byId = new Map<string, Node>();
	for (const node of [...shared, ...participating]) byId.set(node.id, node);
	return [...byId.values()].sort(compareNodes);
}

/**
 * Whether a status change must also write `completedAt`.
 *
 * A node that is already done and stays done keeps the date it has — rewriting
 * it on every edit would make "completed" mean "last touched", which is the
 * same mistake as deriving the date from `updatedAt`.
 */
export type CompletionChange = "keep" | "set" | "clear";

export function completionChange(
	current: Status,
	next: Status,
): CompletionChange {
	if (next === "done") return current === "done" ? "keep" : "set";
	return current === "done" ? "clear" : "keep";
}

/*
 * ---------------------------------------------------------------------------
 * Creating
 * ---------------------------------------------------------------------------
 */

/**
 * What a create writes, minus the fields only the server can fill:
 * `createdAt`, `updatedAt`, `createdBy` and `completedAt` are `data/nodes.ts`'s,
 * because they are `serverTimestamp()` sentinels and the uid of the caller.
 *
 * Every other field is written, with a value, on every create. Firestore does
 * not index an absent field, so `where('archived', '==', false)` silently skips
 * every document written before `archived` existed: adding a *queried* field
 * later is a backfill, not a schema change.
 */
export type NodeData = Omit<
	Node,
	"id" | "completedAt" | "createdAt" | "createdBy" | "updatedAt"
>;

export interface NewNodeInput {
	title: string;
	/** From `rankAtEnd()` or `rankBetween()`, against the target column. */
	rank: string;
	/** The board this is created on, or null for the root board. */
	parent?: Node | null;
	status?: Status;
	/** Honoured only at the root; a child always takes its parent's. */
	visibility?: Visibility;
	/** Added to whatever the parent's privacy already requires. */
	participantIds?: readonly string[];
	locationId?: string | null;
	locationAncestorIds?: readonly string[];
	dueDate?: string | null;
	priority?: Priority | null;
	effort?: Effort | null;
	notes?: string;
}

/**
 * A new node, with everything it inherits already resolved.
 *
 * The two subtree invariants are upheld by *construction* here: `visibility` is
 * taken from the parent whenever there is one — the caller's is honoured only
 * at the root — and a child of a private parent starts with that parent's
 * participants. A caller that got either wrong would be refused by the rules,
 * which is the right backstop but a poor first line.
 *
 * A location is *not* inherited when it is explicitly given: a child may sit in
 * a different room from its parent, and moving a node in the project tree never
 * moves it in the location tree.
 */
export function newNodeData(input: NewNodeInput): NodeData {
	const parent = input.parent ?? null;
	const inherited =
		parent?.visibility === "private" ? parent.participantIds : [];
	const participantIds = [...inherited];
	for (const uid of input.participantIds ?? []) {
		if (!participantIds.includes(uid)) participantIds.push(uid);
	}

	const location =
		input.locationId === undefined
			? {
					locationId: parent?.locationId ?? null,
					locationAncestorIds: [...(parent?.locationAncestorIds ?? [])],
				}
			: {
					locationId: input.locationId,
					locationAncestorIds: [...(input.locationAncestorIds ?? [])],
				};

	return {
		title: input.title.trim(),
		status: input.status ?? "backlog",
		rank: input.rank,
		parentId: parent?.id ?? null,
		ancestorIds: childAncestorIds(parent),
		...location,
		participantIds,
		visibility: parent?.visibility ?? input.visibility ?? "shared",
		dueDate: input.dueDate ?? null,
		priority: input.priority ?? null,
		blockedBy: [],
		notes: input.notes ?? "",
		checklist: [],
		effort: input.effort ?? null,
		photos: [],
		archived: false,
	};
}

/*
 * ---------------------------------------------------------------------------
 * Reading
 * ---------------------------------------------------------------------------
 */

function stringOr(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function oneOf<T extends string>(
	value: unknown,
	allowed: readonly T[],
	fallback: T,
): T {
	return allowed.includes(value as T) ? (value as T) : fallback;
}

function oneOfOrNull<T extends string>(
	value: unknown,
	allowed: readonly T[],
): T | null {
	return allowed.includes(value as T) ? (value as T) : null;
}

function checklistItems(value: unknown): ChecklistItem[] {
	if (!Array.isArray(value)) return [];
	return value.map((item) => ({
		id: stringOr(item?.id, ""),
		text: stringOr(item?.text, ""),
		done: item?.done === true,
	}));
}

function photoList(value: unknown): Photo[] {
	if (!Array.isArray(value)) return [];
	return value.map((item) => ({
		id: stringOr(item?.id, ""),
		path: stringOr(item?.path, ""),
		uploadedAt: item?.uploadedAt ?? null,
		uploadedBy: stringOr(item?.uploadedBy, ""),
	}));
}

/**
 * A stored document, read defensively.
 *
 * Every field is written on create, so in practice nothing here is missing —
 * but a document from the REST API (#7), from a seeded fixture, or from a
 * version of the app that predates a field, still has to render rather than
 * crash a board. `visibility` is the one coercion that is *not* cosmetic: it
 * falls back to `'shared'`, which is what an unreadable-by-anyone document
 * would already have been denied for.
 */
export function toNode(snapshot: QueryDocumentSnapshot<DocumentData>): Node {
	const data = snapshot.data();

	return {
		id: snapshot.id,
		title: stringOr(data.title, ""),
		status: oneOf(data.status, statuses, "backlog"),
		rank: stringOr(data.rank, ""),
		parentId: stringOrNull(data.parentId),
		ancestorIds: strings(data.ancestorIds),
		locationId: stringOrNull(data.locationId),
		locationAncestorIds: strings(data.locationAncestorIds),
		participantIds: strings(data.participantIds),
		visibility: data.visibility === "private" ? "private" : "shared",
		dueDate: stringOrNull(data.dueDate),
		priority: oneOfOrNull(data.priority, priorities),
		blockedBy: strings(data.blockedBy),
		notes: stringOr(data.notes, ""),
		checklist: checklistItems(data.checklist),
		effort: oneOfOrNull(data.effort, efforts),
		photos: photoList(data.photos),
		archived: data.archived === true,
		completedAt: data.completedAt ?? null,
		createdAt: data.createdAt ?? null,
		createdBy: stringOr(data.createdBy, ""),
		updatedAt: data.updatedAt ?? null,
	};
}
