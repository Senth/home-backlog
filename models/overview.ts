import { dueState, soonInDays, toCalendarDay } from "@/models/due-date";
import { hiddenByParticipants, type Node, rootIdOf } from "@/models/node";

/**
 * What each of Overview's three sections holds, as pure functions over the
 * nodes the listeners already returned.
 *
 * The queries in `data/nodes.ts` bound what arrives; these decide what is
 * *shown*. The two overlap on purpose. A listener stays open for hours, so the
 * `now` a query was built with drifts — a card due in seven days is still in
 * Q3's result set eight days later — and the cache answers a cold start with
 * whatever it last held. Re-asking the question here is what keeps the section
 * agreeing with its own heading, and it is the half that can be tested without
 * Firestore.
 */

/** How far back Recently done reaches. Named nowhere on screen — see the spec. */
export const doneWithinDays = 30;

const dayInMs = 24 * 60 * 60 * 1000;

/**
 * Rows one dated section can hold: Q3–Q6's `limit`, and the ceiling a `+N more`
 * counts against. Twenty is already past what a summary can be.
 */
export const overviewLimit = 20;

/**
 * Rows a section shows before it offers the rest behind `+N more`.
 *
 * Lives here rather than in the screen because `comingUp` needs it: what
 * Ongoing projects *renders* is what makes a Coming up row a duplicate, and
 * what it merely *holds* is not.
 */
export const rowsPerSection = 5;

/**
 * Coming up's upper bound, as the calendar day the query compares against.
 *
 * `soonInDays` is the constant that already decides whether a card face shows a
 * due chip, so "soon" means one thing in the app.
 */
export function comingUpUntil(now: Date): string {
	const until = new Date(now);
	until.setDate(until.getDate() + soonInDays);
	return toCalendarDay(until);
}

/**
 * Recently done's lower bound. An instant, not a calendar day: `completedAt` is
 * a `Timestamp`, and nothing about a completion is timezone-shaped.
 */
export function doneSince(now: Date): Date {
	return new Date(now.getTime() - doneWithinDays * dayInMs);
}

/**
 * Whether Overview hides this node, decided by **its root** rather than by the
 * node itself.
 *
 * A board's `hiddenByParticipants` is `participantIds.length > 0 &&
 * !includes(uid)`, and a shared *descendant* deliberately carries `[]` — which
 * is what keeps a step visible on a board. Applied per node here it would hide
 * somebody's personal project from Ongoing projects while that project's dated
 * step still landed in Coming up, the screen contradicting itself within one
 * scroll.
 *
 * A root that is not among the loaded roots is **hidden**. The roots pair is
 * answered before any section renders, so the only way to reach that branch is
 * a state that should not exist — except one that should: a private step I am a
 * participant of, whose private root I am not on and therefore cannot read.
 * Leaking somebody's private work is the worse of the two failures.
 */
export function hiddenByRoot(
	node: Node,
	roots: readonly Node[],
	uid: string,
): boolean {
	const rootId = rootIdOf(node);
	const root = roots.find((candidate) => candidate.id === rootId);
	return root === undefined || hiddenByParticipants(root, uid);
}

/**
 * Ongoing projects: the roots that are in progress, in the order the household
 * put them in.
 *
 * Roots, not every node in execution at any depth — "ongoing project" is a
 * question about projects, and a list mixing *Renovate bathroom* with *order
 * tiles* answers neither. No query and no index of its own: this is a filter
 * over the root board's own pair, which the hide scope needs anyway, and
 * `mergeNodeResults` has already sorted it by `(rank, id)`.
 */
export function ongoingProjects(roots: readonly Node[], uid: string): Node[] {
	return roots.filter(
		(root) => root.status === "execution" && !hiddenByRoot(root, roots, uid),
	);
}

/**
 * Coming up: everything dated that is late or due within `soonInDays`, oldest
 * first — which is late-first, and is what the query already orders by.
 *
 * No lower bound on how far back late reaches. A card overdue by 400 days is
 * still overdue, and the honest answer to it is archiving it, not hiding it
 * from the one screen that would say so.
 *
 * **Never a row Ongoing projects is already showing.** An in-progress root that
 * is overdue otherwise appears twice on a screen that holds fifteen rows at its
 * cap, with the same title and the same *26 days late* chip — one project
 * taking two of the five rows a section has, and the one thing in the house
 * that is late said twice in a single glance. That is the guilt this screen
 * refuses to carry in colour arriving through repetition instead.
 *
 * **Showing, not holding.** The comparison is against Ongoing projects' first
 * `rowsPerSection` rows, in the `rank` order the household chose — not against
 * everything it holds. A sixth in-progress project that is overdue is behind
 * `+N more`, so deduping it against the whole list would take it off the screen
 * entirely: not visible in Ongoing, and dropped from the one section that sorts
 * late-first and would have put it at the top. "Is anything on fire" is the
 * question this screen exists to answer, and that is the answer disappearing.
 *
 * Expanding Ongoing projects past five can therefore show a row that is also in
 * Coming up. That is the right trade: it takes a deliberate tap, the two rows
 * are a section apart, and the alternative is losing the row while it is
 * collapsed — which is the state the screen is almost always in.
 */
export function comingUp(
	nodes: readonly Node[],
	roots: readonly Node[],
	uid: string,
	now: Date,
): Node[] {
	const shownAsOngoing = new Set(
		ongoingProjects(roots, uid)
			.slice(0, rowsPerSection)
			.map((root) => root.id),
	);

	return nodes
		.filter((node) => {
			const state = dueState(node.dueDate, now);
			return (
				(state === "late" || state === "soon") &&
				node.completedAt === null &&
				!shownAsOngoing.has(node.id) &&
				!hiddenByRoot(node, roots, uid)
			);
		})
		.sort((a, b) => {
			const left = a.dueDate ?? "";
			const right = b.dueDate ?? "";
			if (left !== right) return left < right ? -1 : 1;
			return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
		});
}

/**
 * Recently done: what was completed in the last `doneWithinDays`, newest first.
 *
 * Titles and nothing else — no total, no streak, no per-person tally. A number
 * turns encouragement into a grade.
 */
export function recentlyDone(
	nodes: readonly Node[],
	roots: readonly Node[],
	uid: string,
	now: Date,
): Node[] {
	const since = doneSince(now).getTime();

	return nodes
		.filter((node) => {
			const completed = node.completedAt;
			return (
				completed !== null &&
				completed.toMillis() >= since &&
				!hiddenByRoot(node, roots, uid)
			);
		})
		.sort((a, b) => {
			const left = a.completedAt?.toMillis() ?? 0;
			const right = b.completedAt?.toMillis() ?? 0;
			if (left !== right) return right - left;
			return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
		});
}
