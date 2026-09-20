import type { Location } from "@/models/locations";
import { effectiveLocation, type Node } from "@/models/node";

/**
 * The open-card count per place (#205), **rolled up through the subtree** —
 * *Basement* says 12 even though all twelve sit in Workshop and Boiler room,
 * because the count answers "is anything waiting down here" and a collapsed
 * parent that says nothing is lying by omission. The card list on the row
 * (phase 5) answers the opposite question — *exactly this place* — and the
 * two deliberately do not agree.
 *
 * The chain a card counts for is the "in or under" reach its row's tap
 * writes (`locationFilter`): the place the card effectively answers to — its
 * own, or the nearest one an ancestor passes down (#290) — and every place
 * above it. The chain is walked from the tree itself, `parentId` up, and
 * never from a card's stored `locationAncestorIds`: the crumb can be empty
 * or stale, and a count that trusts it collapses to the card's own place —
 * which is the bug the roll-up shipped with. A place the list does not hold
 * counts for itself alone, and zero never enters the map — a place with
 * nothing waiting says nothing.
 *
 * Pure: the hook that feeds it (`use-location-counts`) mounts the pool pair
 * the Overview and the boards already open — no new listener, no new query.
 */
export function locationCounts(
	pool: readonly Node[],
	locations: readonly Location[],
): ReadonlyMap<string, number> {
	const byId = new Map(pool.map((node) => [node.id, node]));
	const placeParent = new Map(
		locations.map((place) => [place.id, place.parentId]),
	);
	const counts = new Map<string, number>();
	for (const node of pool) {
		const ancestors = node.ancestorIds.map((id) => byId.get(id) ?? null);
		const at = effectiveLocation(node, ancestors);
		if (at === null) continue;
		let id: string | null = at.locationId;
		const walked = new Set<string>();
		while (id !== null && !walked.has(id)) {
			walked.add(id);
			counts.set(id, (counts.get(id) ?? 0) + 1);
			id = placeParent.get(id) ?? null;
		}
	}
	return counts;
}
