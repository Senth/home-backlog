import type { CardCondition, CardMode } from "@/models/filter";
import { toCondition } from "@/models/overview-cards";

/**
 * The board's filter, stored locally — one per home (#62), shared by every
 * board, reach included, so following a card into a drill-down keeps looking
 * through the same eyes. It lives in `AsyncStorage`, not Firestore: a filter
 * is one member's lens on the household's work, not household data.
 */

/** How wide the filter looks: this board's children, or everything below. */
export type BoardReach = "board" | "subtree";

export interface BoardFilter {
	/** Which half of the work the conditions read. */
	mode: CardMode;
	/** How wide the filter looks. */
	reach: BoardReach;
	/** What held-back work must answer to; the conditions AND together. */
	conditions: CardCondition[];
}

/**
 * A set filter expires 24 hours after the last time the app opened a board —
 * pure sliding, no absolute cap, so a household using the app daily never
 * loses its filter and one that stops for a day does.
 */
export const boardFilterTtlMs = 24 * 60 * 60 * 1000;

/**
 * One key per home — never one per board. The filter follows the member
 * across the home's boards, so a per-board key would write a blob for every
 * screen they pass through and expiry would never mean anything.
 */
export function boardFilterKey(homeId: string): string {
	return `home-backlog.boardFilter.${homeId}`;
}

/** The filter as one stored string, stamped with when it was last touched. */
export function encodeBoardFilter(
	filter: BoardFilter,
	savedAt: number,
): string {
	return JSON.stringify({
		v: 1,
		savedAt,
		mode: filter.mode,
		reach: filter.reach,
		conditions: filter.conditions,
	});
}

/**
 * The string back into a filter, or `null` — never a throw, the way `toCard`
 * reads a document. A blob from a future version, or junk of any shape, is
 * "no filter": a lens this app cannot understand must not crash the board,
 * and must not half-apply either, so anything unreadable inside falls back
 * field by field the same way a stored card's fields do.
 */
export function decodeBoardFilter(
	raw: string | null,
	now: Date,
): BoardFilter | null {
	if (raw === null) return null;
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof data !== "object" || data === null) return null;
	const stored = data as Record<string, unknown>;
	if (stored.v !== 1 || typeof stored.savedAt !== "number") return null;
	if (now.getTime() - stored.savedAt > boardFilterTtlMs) return null;
	const mode: CardMode = stored.mode === "done" ? "done" : "open";
	const reach: BoardReach = stored.reach === "subtree" ? "subtree" : "board";
	return {
		mode,
		reach,
		conditions: Array.isArray(stored.conditions)
			? stored.conditions
					.map((condition) => toCondition(condition, mode))
					.filter((condition): condition is CardCondition => condition !== null)
			: [],
	};
}
