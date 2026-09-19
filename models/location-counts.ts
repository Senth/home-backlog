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
 * above it. The ancestor trail is read out of `pool` itself, the home's open
 * set; a crumb the pool does not hold contributes nothing, the same neutral
 * answer `effectiveLocation` gives it. A card filed nowhere counts nowhere,
 * and zero never enters the map — a place with nothing waiting says nothing.
 *
 * Pure: the hook that feeds it (`use-location-counts`) mounts the pool pair
 * the Overview and the boards already open — no new listener, no new query.
 */
export function locationCounts(
	pool: readonly Node[],
): ReadonlyMap<string, number> {
	const byId = new Map(pool.map((node) => [node.id, node]));
	const counts = new Map<string, number>();
	for (const node of pool) {
		const ancestors = node.ancestorIds.map((id) => byId.get(id) ?? null);
		const at = effectiveLocation(node, ancestors);
		if (at === null) continue;
		const chain = [at.locationId, ...at.locationAncestorIds];
		for (const id of chain) counts.set(id, (counts.get(id) ?? 0) + 1);
	}
	return counts;
}
