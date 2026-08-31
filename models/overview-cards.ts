import { dayDifference, dueState, soonInDays } from "@/models/due-date";
import {
	type CreatedVia,
	compareNodes,
	type Effort,
	effortOrder,
	type Node,
	type Priority,
	priorityOrder,
	rankSequence,
	type Status,
	unresolvedBlockers,
	type Visibility,
} from "@/models/node";
import { hiddenByRoot, overviewLimit } from "@/models/overview";

/**
 * One Overview card, and the pure machinery behind it: what a condition
 * matches, how a card sorts (unknown last), and how the three config scopes
 * merge into the one ordered list the screen renders.
 *
 * A card is a `.filter().sort().slice()` over the pool the listeners already
 * returned — the same shape `models/overview.ts` holds for the three fixed
 * sections, which this file re-expresses as seeds. The queries bound what
 * *can* arrive; `cardRows` decides what is *shown*, re-asked with a fresh
 * `now` on every render for the same reason the sections do it.
 */

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
 * days, `n` editable, defaulting to `soonInDays` when absent.
 */
export type CardCondition =
	| { field: "status"; anyOf: Status[] }
	| { field: "priority"; anyOf: (Priority | "none")[] }
	| { field: "effort"; anyOf: (Effort | "none")[] }
	| { field: "dueDate"; is: DueFilter; n?: number }
	| { field: "isRoot"; is: boolean }
	| { field: "hasChildren"; is: boolean }
	| { field: "assigneeIds"; anyOf: string[] }
	| { field: "participantIds"; anyOf: string[] }
	| { field: "blockedBy"; is: "any" | "none" }
	| { field: "locationId"; is: "any" | "none" }
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

/** What a card says when it has no rows: gone, or one sentence. */
export type CardEmpty = { mode: "hide" } | { mode: "say"; key: string };

/** `"completed"` is only ever the Recently done seed — see `seedCards`. */
export interface Card {
	id: string;
	kind: "filter" | "completed";
	/** Set on seeds; a restore re-creates the card from it. */
	seedId: SeedId | null;
	/** `null` on an untouched seed, which the screen titles from i18n instead. */
	title: string | null;
	conditions: CardCondition[];
	/** `null` is board order — `(rank, id)`, the household's own arrangement. */
	sort: CardSort | null;
	/** Rows shown collapsed. */
	shown: number;
	/** Rows held in total; the rest behind `+N more` is dropped, not hidden. */
	max: number;
	empty: CardEmpty;
	/** Fractional, from the same helpers as a node's rank. */
	rank: string;
}

/** The ids the seven seeds are stored under. */
export type SeedId =
	| "ongoing"
	| "comingUp"
	| "quickWins"
	| "aFewHours"
	| "needsSplitting"
	| "needsEstimate"
	| "recentlyDone";

/** Where an untouched seed's heading comes from; the editor's keys land later. */
export const seedTitleKeys: Record<SeedId, string> = {
	ongoing: "overview.ongoing.title",
	comingUp: "overview.due.title",
	quickWins: "overview.cards.title.quickWins",
	aFewHours: "overview.cards.title.aFewHours",
	needsSplitting: "overview.cards.title.needsSplitting",
	needsEstimate: "overview.cards.title.needsEstimate",
	recentlyDone: "overview.done.title",
};

/**
 * The seven seeds, written once into a missing global config — never diffed
 * against this list again, so a seed the user removed stays removed.
 *
 * The order here is the screen's starting order, carried by fractional ranks
 * generated in one call. The four effort cards partition the effort scale —
 * `quick` / `hours`–`evening` / `weekend`+ / unset — so every task with an
 * effort lands in exactly one of them.
 */
export function seedCards(): Record<string, Card> {
	const ranks = rankSequence(null, null, 7);
	const seeds: Omit<Card, "rank">[] = [
		{
			id: "ongoing",
			kind: "filter",
			seedId: "ongoing",
			title: null,
			conditions: [
				{ field: "status", anyOf: ["execution"] },
				{ field: "isRoot", is: true },
			],
			sort: null,
			shown: 5,
			max: overviewLimit,
			empty: { mode: "say", key: "overview.ongoing.empty" },
		},
		{
			id: "comingUp",
			kind: "filter",
			seedId: "comingUp",
			title: null,
			conditions: [{ field: "dueDate", is: "comingUp" }],
			sort: { field: "dueDate", direction: "asc" },
			shown: 5,
			max: overviewLimit,
			empty: { mode: "say", key: "overview.due.empty" },
		},
		{
			id: "quickWins",
			kind: "filter",
			seedId: "quickWins",
			title: null,
			conditions: [
				{ field: "effort", anyOf: ["quick"] },
				{ field: "isRoot", is: false },
				{ field: "hasChildren", is: false },
			],
			sort: { field: "priority", direction: "desc" },
			shown: 3,
			max: 3,
			empty: { mode: "say", key: "overview.cards.empty.quickWins" },
		},
		{
			id: "aFewHours",
			kind: "filter",
			seedId: "aFewHours",
			title: null,
			conditions: [{ field: "effort", anyOf: ["hours", "evening"] }],
			sort: { field: "priority", direction: "desc" },
			shown: 3,
			max: 3,
			empty: { mode: "say", key: "overview.cards.empty.generic" },
		},
		{
			id: "needsSplitting",
			kind: "filter",
			seedId: "needsSplitting",
			title: null,
			conditions: [
				{ field: "effort", anyOf: ["weekend", "multi_week"] },
				{ field: "isRoot", is: false },
				{ field: "hasChildren", is: false },
			],
			sort: { field: "priority", direction: "desc" },
			shown: 5,
			max: 10,
			empty: { mode: "say", key: "overview.cards.empty.needsSplitting" },
		},
		{
			id: "needsEstimate",
			kind: "filter",
			seedId: "needsEstimate",
			title: null,
			conditions: [{ field: "effort", anyOf: ["none"] }],
			sort: null,
			shown: 5,
			max: 10,
			empty: { mode: "say", key: "overview.cards.empty.generic" },
		},
		{
			id: "recentlyDone",
			kind: "completed",
			seedId: "recentlyDone",
			title: null,
			conditions: [],
			sort: { field: "completedAt", direction: "desc" },
			shown: 5,
			max: overviewLimit,
			empty: { mode: "hide" },
		},
	];

	return Object.fromEntries(
		seeds.map((seed, index) => [seed.id, { ...seed, rank: ranks[index] }]),
	) as Record<string, Card>;
}

/*
 * ---------------------------------------------------------------------------
 * Matching
 * ---------------------------------------------------------------------------
 */

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
	 * behaviour the condition shipped with.
	 */
	blockers: ReadonlyMap<string, Node | null>;
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
		case "locationId":
			return condition.is === "any"
				? node.locationId !== null
				: node.locationId === null;
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

function matchesConditions(
	node: Node,
	conditions: readonly CardCondition[],
	ctx: MatchContext,
): boolean {
	return conditions.every((condition) => matches(node, condition, ctx));
}

/*
 * ---------------------------------------------------------------------------
 * Sorting and slicing
 * ---------------------------------------------------------------------------
 */

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

/** What one card holds from the pool: filtered, de-privatized, sorted. */
export function cardRows(
	card: Card,
	nodes: readonly Node[],
	ctx: MatchContext & { roots: readonly Node[] },
): Node[] {
	if (card.kind === "completed") return [];
	return sortRows(
		nodes.filter(
			(node) =>
				matchesConditions(node, card.conditions, ctx) &&
				!hiddenByRoot(node, ctx.roots, ctx.uid),
		),
		card.sort,
	);
}

/*
 * ---------------------------------------------------------------------------
 * The three scopes
 * ---------------------------------------------------------------------------
 */

/** Where a card is stored — which of the three config surfaces holds it. */
export type CardScope = "global" | "home" | "shared";

/**
 * One card as the editor draws it: the card, where it is stored, and whether
 * this member hid it (shared cards only — a hide rides on the hider's own doc
 * and never touches the card itself).
 */
export interface EditorCard {
	card: Card;
	scope: CardScope;
	hidden: boolean;
}

/**
 * Global + home + shared, with each card's scope and hide flag, ordered by
 * `(rank, id)`. A later scope wins on an id collision, which is what makes a
 * home copy able to shadow a global card; the editor's list keeps hidden
 * shared cards (badged) where the screen's own list drops them.
 */
export function editorList(
	global: readonly Card[],
	home: readonly Card[],
	shared: readonly Card[],
	hiddenSharedIds: readonly string[],
): EditorCard[] {
	const byId = new Map<string, EditorCard>();
	for (const card of global)
		byId.set(card.id, { card, scope: "global", hidden: false });
	for (const card of home)
		byId.set(card.id, { card, scope: "home", hidden: false });

	const hidden = new Set(hiddenSharedIds);
	for (const card of shared) {
		byId.set(card.id, { card, scope: "shared", hidden: hidden.has(card.id) });
	}

	// `(rank, id)` — the same order a board column holds its cards in, so a
	// card the household arranged on one screen sits in the same place here.
	return [...byId.values()].sort((a, b) => {
		if (a.card.rank !== b.card.rank) return a.card.rank < b.card.rank ? -1 : 1;
		return a.card.id < b.card.id ? -1 : a.card.id > b.card.id ? 1 : 0;
	});
}

/** Which scope each merged card lives in — later scope wins, as the merge does. */
export function cardScopes(
	global: readonly Card[],
	home: readonly Card[],
	shared: readonly Card[],
): Record<string, CardScope> {
	const scopes: Record<string, CardScope> = {};
	for (const card of global) scopes[card.id] = "global";
	for (const card of home) scopes[card.id] = "home";
	for (const card of shared) scopes[card.id] = "shared";
	return scopes;
}

/**
 * The seeds the member deleted: every seed whose id is nowhere among the
 * cards they still hold, in any scope. These are what *Removed originals*
 * lists, and a restore re-creates one from this exact shape.
 */
export function removedSeeds(cards: readonly Card[]): Card[] {
	const present = new Set<string>(
		cards.flatMap((card) => (card.seedId === null ? [] : [card.seedId])),
	);
	return Object.values(seedCards()).filter((seed) => !present.has(seed.id));
}

/*
 * ---------------------------------------------------------------------------
 * Editing conditions
 * ---------------------------------------------------------------------------
 */

/**
 * The one condition a card holds on a field, or `null`. A card carries at
 * most one condition per field — two on the same field would AND into
 * near-nothing — which is what makes the editor's one-field-at-a-time chips
 * able to show the whole state.
 */
export function conditionForField(
	conditions: readonly CardCondition[],
	field: CardCondition["field"],
): CardCondition | null {
	return conditions.find((condition) => condition.field === field) ?? null;
}

/**
 * The conditions after one field was edited: the field's previous condition
 * replaced or removed. An empty any-of means the field says nothing, so the
 * condition goes — a chip group the reader unticked entirely is not a
 * condition that matches nothing.
 */
export function withCondition(
	conditions: readonly CardCondition[],
	next: CardCondition | null,
): CardCondition[] {
	const others = conditions.filter(
		(condition) => condition.field !== next?.field,
	);
	const keeps = next !== null && !("anyOf" in next && next.anyOf.length === 0);
	return keeps ? [...others, next] : [...others];
}

/*
 * ---------------------------------------------------------------------------
 * Reading a stored card
 * ---------------------------------------------------------------------------
 */

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function whole(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? Math.trunc(value)
		: fallback;
}

const conditionFields = new Set([
	"status",
	"priority",
	"effort",
	"dueDate",
	"isRoot",
	"hasChildren",
	"assigneeIds",
	"participantIds",
	"blockedBy",
	"locationId",
	"visibility",
	"createdVia",
	"notes",
	"photos",
	"checklist",
]);

const sortFields = new Set([
	"dueDate",
	"priority",
	"effort",
	"status",
	"completedAt",
]);

/**
 * A stored condition, or `null` when it is not one. Junk is dropped rather
 * than coerced — a half-understood condition hiding rows quietly is worse
 * than a card that says nothing matches.
 */
function toCondition(value: unknown): CardCondition | null {
	if (typeof value !== "object" || value === null) return null;
	const data = value as Record<string, unknown>;
	if (typeof data.field !== "string" || !conditionFields.has(data.field)) {
		return null;
	}

	switch (data.field) {
		case "status":
			return {
				field: "status",
				anyOf: strings(data.anyOf),
			} as CardCondition;
		case "priority":
		case "effort":
			return {
				field: data.field,
				anyOf: strings(data.anyOf),
			} as CardCondition;
		case "dueDate": {
			if (
				!["comingUp", "late", "notLate", "none"].includes(data.is as string)
			) {
				return null;
			}
			const is = data.is as DueFilter;
			// The window rides only on `comingUp`; `whole`'s `0` fallback drops an
			// absent or junk `n`, which is exactly the default-window case.
			const n = whole(data.n, 0);
			return n > 0 && is === "comingUp"
				? { field: "dueDate", is, n }
				: { field: "dueDate", is };
		}
		case "blockedBy":
		case "locationId":
			return data.is === "any" || data.is === "none"
				? { field: data.field as "blockedBy", is: data.is }
				: null;
		case "visibility":
			return data.is === "shared" || data.is === "private"
				? { field: "visibility", is: data.is }
				: null;
		case "createdVia":
			return data.is === "app" || data.is === "api"
				? { field: "createdVia", is: data.is }
				: null;
		default:
			// `isRoot`, `hasChildren`, `assigneeIds`, `participantIds`, `notes`,
			// `photos`, `checklist` — the boolean and people shapes.
			return typeof data.is === "boolean"
				? { field: data.field as "isRoot", is: data.is }
				: "anyOf" in data
					? { field: data.field as "assigneeIds", anyOf: strings(data.anyOf) }
					: null;
	}
}

/**
 * A stored document read defensively, the way `toNode` is: every field has a
 * fallback, so a card written by another version of the app renders rather
 * than crashing the one screen that opens first.
 */
export function toCard(
	id: string,
	data: Record<string, unknown> | undefined | null,
): Card | null {
	if (typeof data !== "object" || data === null) return null;

	const sortData =
		typeof data.sort === "object" && data.sort !== null
			? (data.sort as Record<string, unknown>)
			: {};
	const emptyData =
		typeof data.empty === "object" && data.empty !== null
			? (data.empty as Record<string, unknown>)
			: undefined;

	return {
		id,
		kind: data.kind === "completed" ? "completed" : "filter",
		seedId: typeof data.seedId === "string" ? (data.seedId as SeedId) : null,
		title: typeof data.title === "string" ? data.title : null,
		conditions: Array.isArray(data.conditions)
			? data.conditions
					.map(toCondition)
					.filter((condition): condition is CardCondition => condition !== null)
			: [],
		sort:
			typeof sortData.field === "string" &&
			sortFields.has(sortData.field) &&
			(sortData.direction === "asc" || sortData.direction === "desc")
				? { field: sortData.field as SortField, direction: sortData.direction }
				: null,
		shown: whole(data.shown, 5),
		max: whole(data.max, overviewLimit),
		empty:
			typeof emptyData?.mode === "string" &&
			emptyData.mode === "say" &&
			typeof emptyData.key === "string"
				? { mode: "say", key: emptyData.key }
				: { mode: "hide" },
		rank: typeof data.rank === "string" ? data.rank : "",
	};
}

/*
 * ---------------------------------------------------------------------------
 * Export/import — one card, one string, clipboard-local
 * ---------------------------------------------------------------------------
 */

/**
 * The card as one pasteable string: the fields a *shared* card needs and
 * nothing else — no id, no rank (the importer mints their own), no seedId
 * (an import is never a seed), and the title already resolved, because the
 * reader's i18n does not travel with it. Plain JSON survives a clipboard
 * round-trip as-is; there is nothing here to compress or version.
 */
export function exportCard(card: Card): string {
	return JSON.stringify({
		kind: card.kind,
		title: card.title,
		conditions: card.conditions,
		sort: card.sort,
		shown: card.shown,
		max: card.max,
		empty: card.empty,
	});
}

/**
 * The string back into a card-to-be, or `null` — never a throw. `toCard` does
 * the defensive reading, so a field the string cannot say falls back exactly
 * the way a stored document does. A card that claims to be the built-in
 * completed card, or that has no title at all, is not a card a member can
 * own — that string is simply not one.
 */
export function importCard(text: string): Omit<Card, "id" | "rank"> | null {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof data !== "object" || data === null) return null;
	const card = toCard("", data as Record<string, unknown>);
	if (card === null || card.kind === "completed" || card.title === null) {
		return null;
	}
	const { id: _id, rank: _rank, ...rest } = card;
	return rest;
}
