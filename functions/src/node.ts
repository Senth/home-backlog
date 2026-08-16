import {
	BASE_62_DIGITS,
	generateKeyBetween,
	generateNKeysBetween,
} from "fractional-indexing";

/**
 * The node vocabulary, mirrored on the server side.
 *
 * This is a **deliberate second copy** of what `models/node.ts` states for the
 * app and `firestore.rules` states for every client write. It exists because the
 * API writes with the Admin SDK, which bypasses the rules entirely — and it does
 * that so a bulk subtree create can commit in one atomic batch, which under the
 * rules is impossible: a rule's `get()` reads committed state, so a child
 * written before its parent commits fails `inheritsFrom`, and writing top-down
 * over a network means a timeout mid-flight leaves half a tree.
 *
 * A copy can drift from its original, and that risk is accepted rather than
 * denied. What holds it closed is that `validate.test.ts` is written from the
 * same case list as `tests/rules/firestore.test.ts`, and that the two lists are
 * short and closed: seven statuses, four priorities, five efforts.
 *
 * It is not shared by import, for a plain mechanical reason: `models/node.ts`
 * types its timestamps as the *client* SDK's `Timestamp`, which is a different
 * class from `firebase-admin/firestore`'s, and pulling the client SDK into a
 * Cloud Function to borrow a type would ship it in the deployed image.
 * `models/api-key.ts`, which has no imports at all, *is* shared — the two cases
 * are different, and the difference is the import list.
 */

export type Status =
	| "backlog"
	| "next_up"
	| "research"
	| "planning"
	| "execution"
	| "review"
	| "done";

/** Enum order, and the order an appended column takes. */
export const statuses: readonly Status[] = [
	"backlog",
	"next_up",
	"research",
	"planning",
	"execution",
	"review",
	"done",
];

export type Visibility = "shared" | "private";

export const visibilities: readonly Visibility[] = ["shared", "private"];

export type Priority = "low" | "normal" | "high" | "urgent";

export const priorities: readonly Priority[] = [
	"low",
	"normal",
	"high",
	"urgent",
];

export type Effort = "quick" | "hours" | "evening" | "weekend" | "multi_week";

export const efforts: readonly Effort[] = [
	"quick",
	"hours",
	"evening",
	"weekend",
	"multi_week",
];

/** The root board and the board inside a project get every stage. */
export const fullColumns: readonly Status[] = statuses;

/**
 * Deep boards. A research column whose cards each contain their own research
 * column is nonsense, and these three read as *To do · In progress · Done*.
 */
export const simpleColumns: readonly Status[] = [
	"backlog",
	"execution",
	"done",
];

/** The root board is not a document, so its set is a constant. */
export const rootColumns: readonly Status[] = fullColumns;

/**
 * The frozen column set for a node at `depth`, describing the board its
 * *children* form. A node's own depth is `ancestorIds.length`.
 */
export function columnsForDepth(depth: number): readonly Status[] {
	return depth === 0 ? fullColumns : simpleColumns;
}

export const maxTitleLength = 200;
export const maxNotesLength = 10000;
export const maxChecklistItems = 200;
export const maxPhotos = 50;

/** `'YYYY-MM-DD'` — a calendar day, not an instant. */
export const dueDatePattern = /^\d{4}-\d{2}-\d{2}$/;

/*
 * ---------------------------------------------------------------------------
 * Rank
 * ---------------------------------------------------------------------------
 *
 * A rank orders a node **within its `(parentId, status)` column**, so a card
 * arriving in another column takes a rank computed from that column's
 * neighbours. `fractional-indexing` is a real shared dependency rather than a
 * mirrored constant, so the one thing that genuinely could not survive drift —
 * the digit alphabet, whose character order is also its sort order — cannot.
 */

const rankDigits = BASE_62_DIGITS;

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
 * `count` ranks in order, for a bulk subtree create. One call rather than a
 * fold, because generating them pairwise grows a character per item.
 */
export function rankSequence(
	before: string | null,
	after: string | null,
	count: number,
): string[] {
	return generateNKeysBetween(before, after, count, rankDigits);
}

/*
 * ---------------------------------------------------------------------------
 * Structure
 * ---------------------------------------------------------------------------
 */

/** The `ancestorIds` of a child of a node with this path — `[]` for a root. */
export function childAncestorIds(
	parent: { id: string; ancestorIds: readonly string[] } | null,
): string[] {
	return parent === null ? [] : [...parent.ancestorIds, parent.id];
}

/**
 * A descendant's `ancestorIds` after the subtree it sits in has moved.
 *
 * A reparent moves a subtree whole and no descendant's `parentId` changes, so
 * the rewrite is a splice at the point where the moved node appears.
 */
export function movedAncestorIds(
	ancestorIds: readonly string[],
	movedId: string,
	movedAncestors: readonly string[],
): string[] {
	const index = ancestorIds.indexOf(movedId);
	if (index === -1) return [...ancestorIds];
	return [...movedAncestors, ...ancestorIds.slice(index)];
}

/**
 * Whether a status change must also write `completedAt`.
 *
 * A node already done and staying done keeps the date it has — rewriting it
 * would make "completed" mean "last touched".
 */
export type CompletionChange = "keep" | "set" | "clear";

export function completionChange(
	current: Status,
	next: Status,
): CompletionChange {
	if (next === "done") return current === "done" ? "keep" : "set";
	return current === "done" ? "clear" : "keep";
}
