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
 * It is not shared by import, and neither is anything else: **no file crosses
 * the package boundary.** Two reasons, and the second is the one that decides
 * it. `models/node.ts` types its timestamps as the *client* SDK's `Timestamp`,
 * a different class from `firebase-admin/firestore`'s, so borrowing the type
 * would ship the client SDK in the deployed image. And under a hybrid module
 * kind TypeScript picks a file's format from the nearest `package.json` — the
 * repo root's has no `"type"`, so any file compiled from up there emits as
 * CommonJS into this ESM package and Node cannot named-import it.
 *
 * `models/api-key.ts` is therefore *not* shared either: the token format lives
 * in `api-key.ts` beside this file, and `maxKeyNameLength` is stated on both
 * sides — a duplicated bound, not duplicated code.
 */

export type Status = "backlog" | "next_up" | "execution" | "done";

/** Enum order, and the order an appended column takes. */
export const statuses: readonly Status[] = [
	"backlog",
	"next_up",
	"execution",
	"done",
];

export type Visibility = "shared" | "private";

/**
 * Who wrote a node. Written at creation and immutable — the API writes `'api'`,
 * every client write is `'app'`, and the rules refuse a client that claims
 * otherwise. A node written before the field existed has none, and absent means
 * `'app'`.
 */
export type CreatedVia = "app" | "api";

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

/**
 * The set a new board starts with, at every depth. It used to depend on depth,
 * and stopped when #99 removed the three stage columns — see `models/node.ts`.
 */
export const defaultColumns: readonly Status[] = statuses;

export const maxTitleLength = 200;
export const maxNotesLength = 10000;
export const maxChecklistItems = 200;
export const maxAttachments = 50;

/**
 * How many labels one card may carry, mirrored from `models/label.ts`'s
 * `maxLabelsPerNode` — a duplicated bound, not duplicated code, for the same
 * reason `maxKeyNameLength` is stated on both sides. It is what the card
 * face's gutter is built around.
 */
export const maxLabelsPerNode = 6;

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
 * A rank at the end of a column, given that column's ranks **in order**.
 *
 * Not simply `rankAtEnd(last)`, because `generateKeyBetween` *validates* the key
 * it is given and throws on one it did not produce — `"z0"` is not a valid order
 * key, and neither is anything a fixture, a hand-edited document or a future bug
 * might leave behind. Unhandled, that turns every create in that column into a
 * 500 with nothing an agent could act on, and the column becomes permanently
 * unwritable over the API.
 *
 * So the last *usable* rank wins, and a column with nothing usable in it starts
 * over. The worst case is a card that lands in the wrong place in its column,
 * which the next reorder fixes — the same trade the app already makes when it
 * ranks against a possibly stale board.
 */
export function rankAfter(ranks: readonly string[]): string {
	for (let index = ranks.length - 1; index >= 0; index--) {
		try {
			return rankAtEnd(ranks[index]);
		} catch {
			// Not a key this library produced. Try the one before it.
		}
	}
	return rankAtEnd(null);
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
