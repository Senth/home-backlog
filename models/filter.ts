import { dayDifference, dueState, soonInDays } from "@/models/due-date";
import {
	type CreatedVia,
	compareNodes,
	type EffectiveLocation,
	type Effort,
	effortOrder,
	type Node,
	type Priority,
	priorityOrder,
	type Status,
	unresolvedBlockers,
	type Visibility,
} from "@/models/node";
import { doneWithinDays, maxDoneWithinDays } from "@/models/overview";

const dayInMs = 24 * 60 * 60 * 1000;

/**
 * What a card's conditions match and how its rows sort (unknown last) — the
 * pure half of an Overview card. This file knows nothing about a `Card`: no
 * title, no rank, no scope, no seeds. `models/overview-cards.ts` owns the
 * card and applies this file's predicates and order to its rows.
 */

/**
 * What a card asks about. An **open** card reads the work still to do; a
 * **done** card reads what was completed. Both carry conditions and a sort —
 * the mode changes which questions make sense, not the shape.
 */
export type CardMode = "open" | "done";

/** What a `dueDate` condition can ask for — the spec's four plain words. */
export type DueFilter = "comingUp" | "late" | "notLate" | "none";

/**
 * One condition. All conditions on a card AND together; there is no OR and no
 * nesting. Within one condition the values are ORs — "effort is quick", not
 * "effort is quick and hours".
 *
 * People conditions name members by uid, with two reserved words: `"me"` is
 * the reader, and `"none"` (assignee only) is unassigned. A `comingUp`
 * `dueDate` condition carries the window it asks about — late or within `n`
 * days, `n` editable, defaulting to `soonInDays` when absent. A `completedAt`
 * condition asks for completions within `n` days, defaulting to
 * `doneWithinDays` when absent; it is a done-card question.
 */
export type CardCondition =
	| { field: "status"; anyOf: Status[] }
	| { field: "priority"; anyOf: (Priority | "none")[] }
	| { field: "effort"; anyOf: (Effort | "none")[] }
	| { field: "dueDate"; is: DueFilter; n?: number }
	| { field: "labelIds"; anyOf: string[] }
	| { field: "completedAt"; is: "within"; n?: number }
	| { field: "isRoot"; is: boolean }
	| { field: "hasChildren"; is: boolean }
	| { field: "assigneeIds"; anyOf: string[] }
	| { field: "participantIds"; anyOf: string[] }
	| { field: "blockedBy"; is: "any" | "none" }
	| { field: "locationId"; is: "any" | "none" }
	| { field: "locationId"; anyOf: readonly string[] }
	| { field: "visibility"; is: Visibility }
	| { field: "createdVia"; is: CreatedVia }
	| { field: "notes" | "photos" | "checklist"; is: boolean };

export type SortField =
	| "dueDate"
	| "priority"
	| "effort"
	| "status"
	| "completedAt";

export interface CardSort {
	field: SortField;
	direction: "asc" | "desc";
}

/**
 * Whether a card of `mode` may carry a condition on `field`. The modes split
 * the condition set where the question stops making sense: status, `dueDate`
 * and `blockedBy` are questions about work still to do, so a done card drops
 * them; `completedAt` has no answer on open work, so it is done-only.
 */
export function conditionCarriedBy(
	mode: CardMode,
	field: CardCondition["field"],
): boolean {
	return mode === "done"
		? field !== "status" && field !== "dueDate" && field !== "blockedBy"
		: field !== "completedAt";
}

/**
 * Whether a card of `mode` may sort on `field`. Sorting a done card by
 * `completedAt` is the newest-first order its window asks for; an open card
 * has no completion to rank by.
 */
export function sortCarriedBy(mode: CardMode, field: SortField): boolean {
	return mode === "done" || field !== "completedAt";
}

/** What one condition holds a node against; `uid` answers `"me"`. */
export interface MatchContext {
	uid: string;
	now: Date;
	/**
	 * What each blocker id resolves to, so `blockedBy` can mean what #66 made
	 * "waiting" mean: the *unresolved* entries, never the stored list — a done
	 * blocker keeps its entry as inert history. A blocker absent from the map
	 * counts as unresolved, the not-yet direction everywhere else takes; with
	 * an empty map every entry is unresolved, which is the raw-length
	 * behavior the condition shipped with.
	 */
	blockers: ReadonlyMap<string, Node | null>;
	/**
	 * The place each node answers to (#290) — its own, or the nearest one an
	 * ancestor passes down, with that place's own path — keyed by node id, so
	 * "in or under" reads an inherited place the node's stored fields do not
	 * name. Optional: a caller with no ancestor data omits it, and every node
	 * then answers from its stored fields, which is what the condition read
	 * before #290.
	 */
	locations?: ReadonlyMap<string, EffectiveLocation | null>;
	/**
	 * The labels each node answers to (#100) — its own plus everything its
	 * trail passes down, the list `effectiveLabels` resolves — keyed by node
	 * id, so "labelled" reads an inherited label the node's stored fields do
	 * not name. Optional: a caller with no label data omits it, and every node
	 * then answers from its own `labelIds` alone.
	 */
	labels?: ReadonlyMap<string, readonly string[]>;
}

function matches(node: Node, condition: CardCondition, ctx: MatchContext) {
	switch (condition.field) {
		case "status":
			return condition.anyOf.includes(node.status);
		case "priority":
			return condition.anyOf.includes(node.priority ?? "none");
		case "effort":
			return condition.anyOf.includes(node.effort ?? "none");
		case "dueDate": {
			const state = dueState(node.dueDate, ctx.now);
			if (condition.is === "comingUp") {
				if (state === "late") return true;
				const days =
					node.dueDate === null ? null : dayDifference(node.dueDate, ctx.now);
				return days !== null && days <= (condition.n ?? soonInDays);
			}
			if (condition.is === "late") return state === "late";
			if (condition.is === "notLate") {
				return node.dueDate !== null && state !== "late";
			}
			return node.dueDate === null;
		}
		case "labelIds":
			return condition.anyOf.some((id) =>
				(ctx.labels?.get(node.id) ?? node.labelIds).includes(id),
			);
		case "completedAt": {
			// An instant, not a calendar day: a completion has no timezone shape.
			const completed = node.completedAt?.toMillis() ?? null;
			if (completed === null) return false;
			const window =
				Math.min(condition.n ?? doneWithinDays, maxDoneWithinDays) * dayInMs;
			return completed >= ctx.now.getTime() - window;
		}
		case "isRoot":
			return (node.parentId === null) === condition.is;
		case "hasChildren":
			return node.childCount > 0 === condition.is;
		case "assigneeIds":
			return condition.anyOf.some((value) =>
				value === "me"
					? node.assigneeIds.includes(ctx.uid)
					: value === "none"
						? node.assigneeIds.length === 0
						: node.assigneeIds.includes(value),
			);
		case "participantIds":
			return condition.anyOf.some((value) =>
				value === "me"
					? node.participantIds.includes(ctx.uid)
					: node.participantIds.includes(value),
			);
		case "blockedBy": {
			// #66's meaning, through `unresolvedBlockers`: a blocker completed
			// while waiting stays in `blockedBy` as inert history, so the
			// stored length is not the answer. A blocker absent from the map
			// — private to another member, gone, or not yet read — counts as
			// unresolved, which is the privacy-safe not-yet.
			const unresolved = unresolvedBlockers(node, ctx.blockers);
			return condition.is === "any"
				? unresolved.length > 0
				: unresolved.length === 0;
		}
		case "locationId": {
			// The picker form: in or under the place the card answers to (#290) —
			// its own, or the nearest one an ancestor passes down. The place's
			// id is the "in", its `locationAncestorIds` the "under". Without the
			// context map the node's stored fields are the whole answer, which
			// is what the condition read before #290.
			const at =
				ctx.locations?.get(node.id) ??
				(node.locationId === null
					? null
					: {
							locationId: node.locationId,
							locationAncestorIds: node.locationAncestorIds,
						});
			if ("anyOf" in condition) {
				return (
					at !== null &&
					(condition.anyOf.includes(at.locationId) ||
						condition.anyOf.some((id) => at.locationAncestorIds.includes(id)))
				);
			}
			return condition.is === "any" ? at !== null : at === null;
		}
		case "visibility":
			return node.visibility === condition.is;
		case "createdVia":
			return node.createdVia === condition.is;
		case "notes":
			return node.notes.length > 0 === condition.is;
		case "photos":
			return node.photos.length > 0 === condition.is;
		case "checklist":
			return node.checklist.length > 0 === condition.is;
	}
}

export function matchesConditions(
	node: Node,
	conditions: readonly CardCondition[],
	ctx: MatchContext,
): boolean {
	return conditions.every((condition) => matches(node, condition, ctx));
}

function sortValue(node: Node, field: SortField): number | string | null {
	switch (field) {
		case "dueDate":
			return node.dueDate;
		case "priority":
			return node.priority === null ? null : priorityOrder[node.priority];
		case "effort":
			return node.effort === null ? null : effortOrder[node.effort];
		case "status":
			return node.status;
		case "completedAt":
			return node.completedAt?.toMillis() ?? null;
	}
}

/**
 * The card's sort, with the one rule that matters most: **unknown is not
 * lowest**. A `null` priority, effort, date or completion sorts last whatever
 * the direction — "not set" is not a position on the scale, and the answer to
 * it is estimating, not ranking under everything that was. Ties break on
 * `(rank, id)`, the board's own order.
 */
export function sortRows(rows: readonly Node[], sort: CardSort | null): Node[] {
	return [...rows].sort((a, b) => {
		if (sort !== null) {
			const left = sortValue(a, sort.field);
			const right = sortValue(b, sort.field);
			if (left === null && right !== null) return 1;
			if (right === null && left !== null) return -1;
			if (left !== null && right !== null && left !== right) {
				const ordered = left < right ? -1 : 1;
				return sort.direction === "asc" ? ordered : -ordered;
			}
		}
		return compareNodes(a, b);
	});
}
