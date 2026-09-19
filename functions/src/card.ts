import { createHash } from "node:crypto";
import {
	type CreatedVia,
	efforts,
	maxTitleLength,
	priorities,
	statuses,
	type Visibility,
} from "./node.js";
import type { ValidationIssue } from "./validate.js";

/**
 * The Overview card vocabulary, mirrored on the server side.
 *
 * This is a **deliberate second copy** of what `models/overview-cards.ts`
 * states for the app, for the same reason `node.ts` and `label.ts` are: the
 * card verbs write with the Admin SDK, which bypasses the rules entirely, and
 * no file crosses the package boundary. `readCard` is written from the app's
 * `toCard` case for case — a card stored by the app must read identically on
 * both sides — and the bounds below are duplicated bounds, not shared code.
 *
 * Reading is defensive and drops junk, exactly as the app reads; writing is
 * strict, and `validateCard` refuses what `readCard` would have quietly
 * dropped. An agent that believes it filed a condition it did not file is the
 * failure mode the strict half exists to avoid.
 */

/** Where a card is stored — which of the three config surfaces holds it. */
export type CardScope = "global" | "home" | "shared";

export const cardScopes: readonly CardScope[] = ["global", "home", "shared"];

/** What a `dueDate` condition can ask for — the spec's four plain words. */
export type DueFilter = "comingUp" | "late" | "notLate" | "none";

export type CardSort = {
	field: string;
	direction: "asc" | "desc";
};

/** What a card says when it has no rows: gone, or one sentence. */
export type CardEmpty = { mode: "hide" } | { mode: "say"; key: string };

export type CardCondition =
	| { field: "status"; anyOf: string[] }
	| { field: "priority"; anyOf: string[] }
	| { field: "effort"; anyOf: string[] }
	| { field: "dueDate"; is: DueFilter; n?: number }
	| { field: "isRoot"; is: boolean }
	| { field: "hasChildren"; is: boolean }
	| { field: "assigneeIds"; anyOf: string[] }
	| { field: "participantIds"; anyOf: string[] }
	| { field: "blockedBy"; is: "any" | "none" }
	| { field: "locationId"; is: "any" | "none" }
	| { field: "locationId"; anyOf: string[] }
	| { field: "visibility"; is: Visibility }
	| { field: "createdVia"; is: CreatedVia }
	| { field: "notes" | "attachments" | "checklist"; is: boolean };

export interface Card {
	id: string;
	kind: "filter" | "completed";
	/** Set on seeds; a restore re-creates the card from it. */
	seedId: string | null;
	/** `null` on an untouched seed, which the screen titles from i18n instead. */
	title: string | null;
	conditions: CardCondition[];
	sort: CardSort | null;
	/** Rows shown collapsed. */
	shown: number;
	/** Rows held in total; the rest behind `+N more` is dropped, not hidden. */
	max: number;
	empty: CardEmpty;
	/** Fractional, from the same helpers as a node's rank. */
	rank: string;
}

/**
 * One card as the editor draws it: the card, where it is stored, and whether
 * the calling member hid it (shared cards only — a hide rides on the hider's
 * own document and never touches the card itself).
 */
export interface CardRow {
	card: Card;
	scope: CardScope;
	hidden: boolean;
}

/** The ids the seven seeds are stored under, for `readCard` and the contract. */
export const seedIds = new Set([
	"ongoing",
	"comingUp",
	"quickWins",
	"aFewHours",
	"needsSplitting",
	"needsEstimate",
	"recentlyDone",
]);

/** Rows shown collapsed, as the app's composer starts one. */
export const rowsPerSection = 5;

/** Rows held in total — the most the app's own editor lets a card hold. */
export const overviewLimit = 20;

/** The `comingUp` window's ceiling — the editor's stepper tops out here. */
export const maxDueWindow = 30;

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
	"attachments",
	"checklist",
]);

const sortFields = new Set([
	"dueDate",
	"priority",
	"effort",
	"status",
	"completedAt",
]);

const dueFilters = new Set(["comingUp", "late", "notLate", "none"]);

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

/**
 * A stored condition, or `null` when it is not one. Junk is dropped rather
 * than coerced — a half-understood condition hiding rows quietly is worse
 * than a card that says nothing matches. Written from the app's `toCondition`
 * case for case, loose arms included.
 */
function toCondition(value: unknown): CardCondition | null {
	if (typeof value !== "object" || value === null) return null;
	const data = value as Record<string, unknown>;
	if (typeof data.field !== "string" || !conditionFields.has(data.field)) {
		return null;
	}

	switch (data.field) {
		case "status":
		case "priority":
		case "effort":
			return {
				field: data.field,
				anyOf: strings(data.anyOf),
			} as CardCondition;
		case "dueDate": {
			if (typeof data.is !== "string" || !dueFilters.has(data.is)) return null;
			const is = data.is as DueFilter;
			// The window rides only on `comingUp`; `whole`'s `0` fallback drops an
			// absent or junk `n`, which is exactly the default-window case.
			const n = whole(data.n, 0);
			return n > 0 && is === "comingUp"
				? { field: "dueDate", is, n }
				: { field: "dueDate", is };
		}
		case "blockedBy":
			return data.is === "any" || data.is === "none"
				? { field: "blockedBy", is: data.is }
				: null;
		case "locationId": {
			// The picker form travels as an anyOf of ids: junk entries drop, and
			// an empty list falls back to whatever the is-form says.
			if ("anyOf" in data) {
				const anyOf = strings(data.anyOf);
				if (anyOf.length > 0) return { field: "locationId", anyOf };
			}
			return data.is === "any" || data.is === "none"
				? { field: "locationId", is: data.is }
				: null;
		}
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
			// `attachments`, `checklist` — the boolean and people shapes, in the
			// same order the app reads them.
			return typeof data.is === "boolean"
				? ({ field: data.field, is: data.is } as CardCondition)
				: "anyOf" in data
					? ({ field: data.field, anyOf: strings(data.anyOf) } as CardCondition)
					: null;
	}
}

/**
 * A stored document read defensively, the mirror of the app's `toCard`:
 * every field has a fallback, so a card written by another version of the app
 * serializes rather than crashing the route that lists it.
 */
export function readCard(
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
		seedId: typeof data.seedId === "string" ? data.seedId : null,
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
				? {
						field: sortData.field,
						direction: sortData.direction as "asc" | "desc",
					}
				: null,
		shown: whole(data.shown, rowsPerSection),
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

/**
 * The status, priority and effort values one `anyOf` may name. The `"none"`
 * member stands for unset, exactly as a condition against a `null` field
 * reads in the app.
 */
const statusValues: readonly string[] = [...statuses];
const priorityValues: readonly string[] = [...priorities, "none"];
const effortValues: readonly string[] = [...efforts, "none"];

/** One condition's issues, checked against the app's own vocabulary. */
function conditionIssues(condition: unknown): ValidationIssue[] {
	if (typeof condition !== "object" || condition === null) {
		return [
			{
				code: "invalid_condition",
				message: "A condition is an object naming a field.",
			},
		];
	}
	const data = condition as Record<string, unknown>;
	if (typeof data.field !== "string" || !conditionFields.has(data.field)) {
		return [
			{
				code: "invalid_condition",
				message: `condition.field must be one of ${[...conditionFields].join(", ")}.`,
			},
		];
	}

	const anyOfIn = (allowed: readonly string[]): boolean =>
		!Array.isArray(data.anyOf) ||
		data.anyOf.length === 0 ||
		!data.anyOf.every(
			(value) => typeof value === "string" && allowed.includes(value),
		);

	switch (data.field) {
		case "status":
			if (anyOfIn(statusValues)) {
				return [
					{
						code: "invalid_condition",
						message: `status anyOf must be a non-empty list of ${statusValues.join(", ")}.`,
					},
				];
			}
			return [];
		case "priority":
			if (anyOfIn(priorityValues)) {
				return [
					{
						code: "invalid_condition",
						message: `priority anyOf must be a non-empty list of ${priorityValues.join(", ")}.`,
					},
				];
			}
			return [];
		case "effort":
			if (anyOfIn(effortValues)) {
				return [
					{
						code: "invalid_condition",
						message: `effort anyOf must be a non-empty list of ${effortValues.join(", ")}.`,
					},
				];
			}
			return [];
		case "dueDate": {
			if (typeof data.is !== "string" || !dueFilters.has(data.is)) {
				return [
					{
						code: "invalid_condition",
						message: `dueDate is must be one of ${[...dueFilters].join(", ")}.`,
					},
				];
			}
			if (data.n === undefined) return [];
			// The window is the editor's stepper range; a card that asks for
			// "late or within 4000 days" is a card the app could never have made.
			if (
				typeof data.n !== "number" ||
				!Number.isInteger(data.n) ||
				data.n < 1 ||
				data.n > maxDueWindow
			) {
				return [
					{
						code: "invalid_condition",
						message: `dueDate n must be an integer between 1 and ${maxDueWindow}, and rides only on comingUp.`,
					},
				];
			}
			if (data.is !== "comingUp") {
				return [
					{
						code: "invalid_condition",
						message: "dueDate n rides only on comingUp.",
					},
				];
			}
			return [];
		}
		case "isRoot":
		case "hasChildren":
		case "notes":
		case "attachments":
		case "checklist":
			return typeof data.is === "boolean"
				? []
				: [
						{
							code: "invalid_condition",
							message: `${data.field} is must be a boolean.`,
						},
					];
		case "assigneeIds":
		case "participantIds":
			// People are named by uid, with `me` (the reader) reserved — and
			// `none` (unassigned) for assignees only, exactly as the app reads
			// them. A uid the home does not contain decodes fine: it simply
			// matches nothing, the rule member references travel by.
			if (!Array.isArray(data.anyOf) || data.anyOf.length === 0) {
				return [
					{
						code: "invalid_condition",
						message: `${data.field} anyOf must be a non-empty list of uids.`,
					},
				];
			}
			if (!data.anyOf.every((value) => typeof value === "string")) {
				return [
					{
						code: "invalid_condition",
						message: `${data.field} anyOf must be a list of uids.`,
					},
				];
			}
			if (data.field === "participantIds" && data.anyOf.includes("none")) {
				return [
					{
						code: "invalid_condition",
						message:
							"participantIds has no none — every node has at least one participant.",
					},
				];
			}
			return [];
		case "blockedBy":
			return data.is === "any" || data.is === "none"
				? []
				: [
						{
							code: "invalid_condition",
							message: "blockedBy is must be any or none.",
						},
					];
		case "locationId": {
			if ("anyOf" in data) {
				const anyOf = strings(data.anyOf);
				if (
					anyOf.length > 0 &&
					anyOf.length === (data.anyOf as unknown[]).length
				) {
					return [];
				}
			}
			return data.is === "any" || data.is === "none"
				? []
				: [
						{
							code: "invalid_condition",
							message:
								"locationId must be an anyOf of place ids, or is any or none.",
						},
					];
		}
		case "visibility":
			return data.is === "shared" || data.is === "private"
				? []
				: [
						{
							code: "invalid_condition",
							message: "visibility is must be shared or private.",
						},
					];
		case "createdVia":
			return data.is === "app" || data.is === "api"
				? []
				: [
						{
							code: "invalid_condition",
							message: "createdVia is must be app or api.",
						},
					];
		default:
			return [];
	}
}

/** The fields a card on the wire carries, all `unknown` until validated. */
export type CardFields = {
	[k in keyof Omit<Card, "id">]: unknown;
};

/**
 * Every value check one card answers, against the document exactly as it
 * will be written — the same full-document shape `validateNode` costs, so no
 * partial patch can slip past.
 */
export function validateCard(data: CardFields): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const add = (field: string, code: string, message: string) =>
		issues.push({ field, code, message });

	if (data.kind !== "filter" && data.kind !== "completed") {
		add("kind", "invalid_kind", "kind must be filter or completed.");
	}

	if (data.seedId !== null && typeof data.seedId !== "string") {
		add("seedId", "invalid_seed", "seedId must be a string or null.");
	}

	if (typeof data.title !== "string" || data.title.length < 1) {
		// Only a seed may be unnamed — the screen titles it from i18n.
		if (!(typeof data.seedId === "string" && seedIds.has(data.seedId))) {
			add(
				"title",
				"title_required",
				"A card needs a title; only a built-in seed may go unnamed.",
			);
		}
	} else if (data.title.length > maxTitleLength) {
		add(
			"title",
			"title_too_long",
			`A title is at most ${maxTitleLength} characters.`,
		);
	}

	if (Array.isArray(data.conditions)) {
		const seen = new Set<string>();
		data.conditions.forEach((condition) => {
			for (const issue of conditionIssues(condition)) {
				issues.push({ field: "conditions", ...issue });
			}
			const field = (condition as { field?: unknown } | null)?.field;
			if (typeof field === "string") {
				// The editor holds at most one condition per field — two would AND
				// into near-nothing and the chips could not show the state — so a
				// write that would produce one is refused, not stored.
				if (seen.has(field)) {
					add(
						"conditions",
						"duplicate_condition",
						`At most one condition per field; ${field} appears twice.`,
					);
				}
				seen.add(field);
			}
		});
	} else {
		add("conditions", "invalid_type", "conditions must be a list.");
	}

	if (data.sort !== null) {
		const sort = data.sort as Record<string, unknown> | null;
		if (
			typeof sort !== "object" ||
			sort === null ||
			typeof sort.field !== "string" ||
			!sortFields.has(sort.field) ||
			(sort.direction !== "asc" && sort.direction !== "desc")
		) {
			add(
				"sort",
				"invalid_sort",
				`sort must be null or { field, direction } with field one of ${[...sortFields].join(", ")} and direction asc or desc.`,
			);
		}
	}

	const shown = data.shown;
	if (typeof shown !== "number" || !Number.isInteger(shown) || shown < 1) {
		add("shown", "invalid_shown", "shown must be an integer of at least 1.");
	}
	const max = data.max;
	if (
		typeof max !== "number" ||
		!Number.isInteger(max) ||
		max < 1 ||
		max > overviewLimit
	) {
		add(
			"max",
			"invalid_max",
			`max must be an integer between 1 and ${overviewLimit}.`,
		);
	}
	if (
		typeof shown === "number" &&
		typeof max === "number" &&
		Number.isInteger(shown) &&
		Number.isInteger(max) &&
		shown > max
	) {
		add("shown", "invalid_shown", "shown cannot exceed max.");
	}

	const empty = data.empty as Record<string, unknown> | null;
	if (
		typeof empty !== "object" ||
		empty === null ||
		(empty.mode !== "hide" &&
			!(
				empty.mode === "say" &&
				typeof empty.key === "string" &&
				empty.key.length > 0
			))
	) {
		add(
			"empty",
			"invalid_empty",
			'empty must be { mode: "hide" } or { mode: "say", key }.',
		);
	}

	if (typeof data.rank !== "string" || data.rank.length === 0) {
		add("rank", "invalid_rank", "rank must be a non-empty string.");
	}

	return issues;
}

/**
 * Global + home + shared, with each card's scope and hide flag, ordered by
 * `(rank, id)` — the mirror of the app's `editorList`. A later scope wins on
 * an id collision, which is what makes a home copy able to shadow a global
 * card, and what decides which copy a write on an id reaches.
 */
export function mergeCards(
	global: readonly Card[],
	home: readonly Card[],
	shared: readonly Card[],
	hiddenSharedIds: readonly string[],
): CardRow[] {
	const byId = new Map<string, CardRow>();
	for (const card of global)
		byId.set(card.id, { card, scope: "global", hidden: false });
	for (const card of home)
		byId.set(card.id, { card, scope: "home", hidden: false });

	const hidden = new Set(hiddenSharedIds);
	for (const card of shared) {
		byId.set(card.id, { card, scope: "shared", hidden: hidden.has(card.id) });
	}

	return [...byId.values()].sort((a, b) => {
		if (a.card.rank !== b.card.rank) return a.card.rank < b.card.rank ? -1 : 1;
		return a.card.id < b.card.id ? -1 : a.card.id > b.card.id ? 1 : 0;
	});
}

/**
 * A card's `ETag`: a quoted sha-1 over the card's own fields — the same
 * approach the label verbs take, because a card, like a label entry, carries
 * no timestamp of its own. It changes the moment any one of them does, which
 * is the property `If-Match` needs. `scope` and `hidden` are not part of it:
 * the first names the document, the second lives on the hider's own doc.
 */
export function etagForCard(card: Card): string {
	const payload = [
		card.kind,
		String(card.seedId),
		String(card.title),
		JSON.stringify(card.conditions),
		card.sort === null ? "" : `${card.sort.field}\u0001${card.sort.direction}`,
		String(card.shown),
		String(card.max),
		JSON.stringify(card.empty),
		card.rank,
	].join("\u0000");
	const hash = createHash("sha1").update(payload).digest("hex");
	return `"${hash}"`;
}

/** One scope's cards as the map field the two per-user docs store. */
export function cardsMap(cards: readonly Card[]): Record<string, Card> {
	return Object.fromEntries(cards.map((card) => [card.id, card]));
}
