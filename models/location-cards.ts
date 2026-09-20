import { effectiveLocation, type Node, priorityOrder } from "@/models/node";

/** What a place's own card list draws at most before it says "+N more". */
export const maxLocationCards = 5;

/** The chain the list falls through, most-urgent column first (Q8). */
export const locationCardSources = ["execution", "next_up", "backlog"] as const;

export type LocationCardSource = (typeof locationCardSources)[number];

export interface CardsAtPlace {
	/** Which chain the drawn cards came from — what the heading says. */
	source: LocationCardSource;
	/** At most `maxLocationCards`, priority first. */
	cards: Node[];
	/** What the "+N more" names; the filtered board holds the rest. */
	more: number;
}

function byPriorityThenRank(a: Node, b: Node): number {
	const priority = (node: Node) =>
		priorityOrder[node.priority ?? "normal"] ?? 0;
	if (priority(a) !== priority(b)) return priority(b) - priority(a);
	if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The cards one place's row draws (#205) — the opposite question from the
 * row's count (Q15): **exactly this place**, no roll-up, so a card is never
 * on screen twice. Leaf cards only (a card with steps is a board, and boards
 * do not sit inside a tree row), whose effective location — own or inherited
 * (#290) — is this place. The first chain that holds anything wins
 * (execution, then next up, then to do) and the heading names it; at most
 * five by priority, then `more` for the "+N more" that opens the filtered
 * board. A place with nothing in any chain draws no card list at all.
 *
 * The ancestor trail is read out of `pool` itself, the same source the
 * roll-up counts from — the pool pair Overview already holds, no new
 * listener. Pure, so the selection is testable without a render.
 */
export function cardsAtPlace(
	pool: readonly Node[],
	locationId: string,
): CardsAtPlace | null {
	const byId = new Map(pool.map((node) => [node.id, node]));
	const atPlace = pool.filter((node) => {
		if (node.childCount > 0) return false;
		const ancestors = node.ancestorIds.map((id) => byId.get(id) ?? null);
		const at = effectiveLocation(node, ancestors);
		return at !== null && at.locationId === locationId;
	});

	for (const source of locationCardSources) {
		const bucket = atPlace.filter((node) => node.status === source);
		if (bucket.length === 0) continue;
		const sorted = [...bucket].sort(byPriorityThenRank);
		return {
			source,
			cards: sorted.slice(0, maxLocationCards),
			more: Math.max(0, sorted.length - maxLocationCards),
		};
	}
	return null;
}
