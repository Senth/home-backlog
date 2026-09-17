import { hiddenByParticipants, type Node, rootIdOf } from "@/models/node";

/**
 * What Overview's cards compute over the nodes the listeners already
 * returned.
 *
 * The three fixed sections became filter cards (#166) and live in
 * `models/overview-cards.ts`; what is left here is the part every card
 * shares — the privacy predicate, and the done window the done pair's query
 * and a done card's `completedAt` condition are both written against — and
 * the two row budgets the queries and the seeds are written against.
 *
 * The queries in `data/nodes.ts` bound what *can* arrive; the cards decide
 * what is *shown*. The two overlap on purpose. A listener stays open for
 * hours, so the `now` a query was built with drifts — a card due in seven
 * days is still in the pool pair's result set eight days later — and the
 * cache answers a cold start with whatever it last held. Re-asking the
 * question here is what keeps a card agreeing with its own heading, and it
 * is the half that can be tested without Firestore.
 */

/** How far back Recently done reaches. Named nowhere on screen — see the spec. */
export const doneWithinDays = 30;

const dayInMs = 24 * 60 * 60 * 1000;

/**
 * Rows one section can hold: the done pair's `limit`, and the per-card `max`
 * of the seeds that never asked for a tighter one. Twenty is already past
 * what a summary can be.
 */
export const overviewLimit = 20;

/**
 * Rows a card shows before it offers the rest behind `+N more`.
 *
 * The seeds that never asked for a tighter number show this many — the five
 * the three fixed sections always showed — so the screen a household already
 * knows keeps its shape.
 */
export const rowsPerSection = 5;

/**
 * Recently done's lower bound. An instant, not a calendar day: `completedAt`
 * is a `Timestamp`, and nothing about a completion is timezone-shaped.
 */
export function doneSince(now: Date): Date {
	return new Date(now.getTime() - doneWithinDays * dayInMs);
}

/**
 * Whether Overview hides this node, decided by **its root** rather than by
 * the node itself.
 *
 * A board's `hiddenByParticipants` is `participantIds.length > 0 &&
 * !includes(uid)`, and a shared *descendant* deliberately carries `[]` — which
 * is what keeps a step visible on a board. Applied per node here it would hide
 * somebody's personal project from every card while that project's dated step
 * still landed in Coming up, the screen contradicting itself within one
 * scroll.
 *
 * A root that is not among the loaded roots is **hidden**. The roots pair is
 * answered before any card renders, so the only way to reach that branch is a
 * state that should not exist — except one that should: a private step I am a
 * participant of, whose private root I am not on and therefore cannot read.
 * Leaking somebody's private work is the worse of the two failures.
 */
export function hiddenByRoot(
	node: Node,
	rootsById: ReadonlyMap<string, Node>,
	uid: string,
): boolean {
	const root = rootsById.get(rootIdOf(node));
	return root === undefined || hiddenByParticipants(root, uid);
}
