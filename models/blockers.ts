import { type Node, priorityOrder } from "@/models/node";

/**
 * The waiting-on rules the details screen shows, decided outside it (#237).
 *
 * A card's `blockedBy` is a list of ids; what each id *means* depends on what
 * the reader could resolve it to — the map the screen reads blockers from,
 * whose values may be `null` for a blocker the server confirmed gone, and
 * simply absent for one nobody has heard from yet. Everything here takes that
 * map rather than a component's state, so the row and the card face cannot
 * drift apart on what waiting means.
 */

/** The priority a blocker sorts by: `null` ranks under every set one. */
function priorityRank(node: Node): number {
	return node.priority === null ? -1 : priorityOrder[node.priority];
}

/**
 * The blockers as the waiting-on row reads them: still-open first, then by
 * priority highest first, then the order the card stored them in.
 *
 * A done blocker stops holding the card but keeps its place in the list —
 * it is the history the *all done* line counts — so it sorts last rather
 * than dropping out. The sort rides on `Array#sort`'s stability, which is
 * what keeps two blockers of equal priority in their stored order.
 */
export function orderBlockers(
	ids: readonly string[],
	reads: ReadonlyMap<string, Node | null>,
): Node[] {
	return ids
		.flatMap((id) => {
			const blocker = reads.get(id);
			return blocker ? [blocker] : [];
		})
		.sort((a, b) => {
			const aDone = a.status === "done" ? 1 : 0;
			const bDone = b.status === "done" ? 1 : 0;
			if (aDone !== bDone) return aDone - bDone;
			return priorityRank(b) - priorityRank(a);
		});
}

/**
 * The one blocker the row names, or `null` when the list resolves to nothing
 * — empty, or every entry unread or gone.
 */
export function leadBlocker(
	ids: readonly string[],
	reads: ReadonlyMap<string, Node | null>,
): Node | null {
	return orderBlockers(ids, reads)[0] ?? null;
}

/**
 * Whether the card's whole waiting list has resolved.
 *
 * An unread or gone blocker is **not** done — *"all done" must never be said
 * about a card nobody could read* — so a missing map entry fails this, the
 * same honest not-yet `unresolvedBlockers` takes. An empty list is not *all
 * done* either: a card waiting on nothing is not in the resolved state, it is
 * simply not waiting.
 */
export function allBlockersDone(
	ids: readonly string[],
	reads: ReadonlyMap<string, Node | null>,
): boolean {
	return ids.length > 0 && ids.every((id) => reads.get(id)?.status === "done");
}
