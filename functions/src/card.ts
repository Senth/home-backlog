import { createHash } from "node:crypto";
import {
	efforts,
	maxTitleLength,
	priorities,
	rankSequence,
	statuses,
} from "./node.js";
import type { ValidationIssue } from "./validate.js";

/**
 * An Overview card, server-side.
 *
 * The app's `models/overview-cards.ts` is the original; this is the API's own
 * reading of the same documents, mirrored rather than imported for the same
 * reason `node.ts` is — no file crosses the package boundary. What the API
 * needs of the model is narrower than what the screen needs: the wire shape,
 * the one hash `If-Match` checks, the bounds a written card must satisfy, and
 * the three-scope merge the editor renders. Matching the *rows* — running a
 * card's conditions against nodes — stays the app's business; the API arranges
 * sections, it does not evaluate them.
 *
 * The three scopes are the three config surfaces:
 *
 * - `global` — `users/{uid}/dashboard/config`, the member's cross-home cards.
 *   A key is its owner, so only the caller's own doc is ever touched.
 * - `home` — `homes/{homeId}/dashboards/{uid}`, this member's cards for this
 *   home. Own document only.
 * - `shared` — `homes/{homeId}/dashboardCards/{cardId}`, one doc per shared
 *   card, so two members editing different shared cards never clobber.
 */

export type CardScope = "global" | "home" | "shared";

export const scopes: readonly CardScope[] = ["global", "home", "shared"];

/**
 * The two row budgets the seeds are written against, stated here because the
 * create verb defaults to them — a duplicated bound, not duplicated code, the
 * way `maxKeyNameLength` is stated on both sides.
 */
export const rowsPerSection = 5;
export const overviewLimit = 20;

export type SortField =
	| "dueDate"
	| "priority"
	| "effort"
	| "status"
	| "completedAt";

export const sortFields: readonly SortField[] = [
	"dueDate",
	"priority",
	"effort",
	"status",
	"completedAt",
];

export const dueFilters = ["comingUp", "late", "notLate", "none"] as const;

/**
 * One condition as it travels: the stored shape, echoed read-only and
 * checked field-by-field by `validateCard`. All conditions on a card AND
 * together; within one condition the `anyOf` values are ORs.
 */
export interface ApiCardCondition {
	field: string;
	anyOf?: string[];
	is?: string | boolean;
	/** The comingUp window, in days — only ever on a `comingUp` condition. */
	n?: number;
}

export interface ApiCard {
	id: string;
	/** `"completed"` is only ever the app's Recently done seed. */
	kind: "filter" | "completed";
	seedId: string | null;
	title: string | null;
	conditions: ApiCardCondition[];
	sort: { field: SortField; direction: "asc" | "desc" } | null;
	shown: number;
	max: number;
	empty: { mode: "hide" } | { mode: "say"; key: string };
	rank: string;
}

/** The one empty-mode message a card written over the API can carry. */
export const genericEmptyKey = "overview.cards.empty.generic";

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function whole(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? Math.trunc(value)
		: fallback;
}

/**
 * A stored card read defensively — a map entry or a document, from this
 * version or an older one. Junk conditions and sorts drop to the fallback
 * rather than throwing: a card written by another version renders rather
 * than takes the Overview tab down, the same argument `toCard` makes.
 */
export function apiCard(id: string, data: unknown): ApiCard {
	const raw = (typeof data === "object" && data !== null ? data : {}) as Record<
		string,
		unknown
	>;
	const sort =
		typeof raw.sort === "object" && raw.sort !== null
			? (raw.sort as Record<string, unknown>)
			: {};
	const empty =
		typeof raw.empty === "object" && raw.empty !== null
			? (raw.empty as Record<string, unknown>)
			: {};

	return {
		id,
		kind: raw.kind === "completed" ? "completed" : "filter",
		seedId: stringOrNull(raw.seedId),
		title: stringOrNull(raw.title),
		conditions: Array.isArray(raw.conditions)
			? raw.conditions.filter(
					(condition): condition is ApiCardCondition =>
						typeof condition === "object" && condition !== null,
				)
			: [],
		sort:
			typeof sort.field === "string" &&
			(sortFields as readonly string[]).includes(sort.field) &&
			(sort.direction === "asc" || sort.direction === "desc")
				? { field: sort.field as SortField, direction: sort.direction }
				: null,
		shown: whole(raw.shown, rowsPerSection),
		max: whole(raw.max, overviewLimit),
		empty:
			empty.mode === "say" && typeof empty.key === "string"
				? { mode: "say", key: empty.key }
				: { mode: "hide" },
		rank: stringOrNull(raw.rank) ?? "",
	};
}

/**
 * A card's `ETag`: a hash over the card's own fields, the same construction
 * `etagForLabel` uses for the same reason — the app writes card config
 * without an `updatedAt`, so there is no timestamp to quote. It changes the
 * moment any field does, which is the property `If-Match` needs. The id is
 * excluded: the hash is of the content the write would clobber.
 */
export function etagForCard(card: ApiCard): string {
	const { id: _id, ...content } = card;
	const hash = createHash("sha1").update(JSON.stringify(content)).digest("hex");
	return `"${hash}"`;
}

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
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

const anyOfVocab: Record<string, readonly string[]> = {
	status: statuses,
	priority: [...priorities, "none"],
	effort: [...efforts, "none"],
};

/**
 * One condition, checked against the vocabulary the app matches with. Uids,
 * location ids and label ids inside an `anyOf` are **not** existence-checked:
 * an id the home does not have simply matches nothing, the same rule member
 * references travel by everywhere else in the API.
 */
function conditionIssues(
	condition: ApiCardCondition,
	label: string,
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const add = (code: string, message: string) =>
		issues.push({ field: label, code, message });

	if (!conditionFields.has(condition.field)) {
		add(
			"unknown_condition_field",
			`A condition's field must be one of ${[...conditionFields].join(", ")}.`,
		);
		return issues;
	}

	if (condition.field in anyOfVocab) {
		const allowed = anyOfVocab[condition.field];
		const anyOf = strings(condition.anyOf);
		if (anyOf.length === 0) {
			add(
				"empty_any_of",
				`A ${condition.field} condition needs at least one value; send no condition instead of an empty one.`,
			);
		} else if (
			anyOf.some((value) => !(allowed as readonly string[]).includes(value))
		) {
			add(
				"invalid_condition_value",
				`A ${condition.field} condition takes: ${allowed.join(", ")}.`,
			);
		}
		return issues;
	}

	switch (condition.field) {
		case "dueDate": {
			if (
				typeof condition.is !== "string" ||
				!(dueFilters as readonly string[]).includes(condition.is)
			) {
				add(
					"invalid_condition_value",
					`A dueDate condition takes is: ${dueFilters.join(", ")}.`,
				);
				return issues;
			}
			if (condition.n === undefined) return issues;
			if (
				condition.is !== "comingUp" ||
				!Number.isInteger(condition.n) ||
				condition.n < 1 ||
				condition.n > 30
			) {
				add(
					"invalid_condition_value",
					"Only a comingUp condition carries a window, a whole number of days from 1 to 30.",
				);
			}
			return issues;
		}
		case "isRoot":
		case "hasChildren":
		case "notes":
		case "photos":
		case "checklist":
			if (typeof condition.is !== "boolean") {
				add(
					"invalid_condition_value",
					`A ${condition.field} condition takes is: true or false.`,
				);
			}
			return issues;
		case "assigneeIds":
		case "participantIds": {
			// Uids, with `me` reserved on both; `none` means unassigned on
			// assigneeIds. No existence check — an unknown uid matches nobody.
			if (strings(condition.anyOf).length === 0) {
				add(
					"empty_any_of",
					`A ${condition.field} condition needs at least one uid; send no condition instead of an empty one.`,
				);
			}
			return issues;
		}
		case "blockedBy":
			if (condition.is !== "any" && condition.is !== "none") {
				add(
					"invalid_condition_value",
					"A blockedBy condition takes is: any or none.",
				);
			}
			return issues;
		case "locationId": {
			const anyOf = strings(condition.anyOf);
			if (anyOf.length > 0) return issues;
			if (condition.is !== "any" && condition.is !== "none") {
				add(
					"invalid_condition_value",
					"A locationId condition takes anyOf: location ids, or is: any or none.",
				);
			}
			return issues;
		}
		case "visibility":
			if (condition.is !== "shared" && condition.is !== "private") {
				add(
					"invalid_condition_value",
					"A visibility condition takes is: shared or private.",
				);
			}
			return issues;
		case "createdVia":
			if (condition.is !== "app" && condition.is !== "api") {
				add(
					"invalid_condition_value",
					"A createdVia condition takes is: app or api.",
				);
			}
			return issues;
		default:
			return issues;
	}
}

/**
 * The card exactly as it will be written, checked whole — the same property
 * `validateNode` gives the node verbs: no partial patch can slip past.
 */
export function validateCard(card: ApiCard): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const add = (field: string, code: string, message: string) =>
		issues.push({ field, code, message });

	if (card.title === null) {
		if (card.seedId === null) {
			add("title", "title_required", "A card without a seed needs a title.");
		}
	} else {
		const title = card.title.trim();
		if (title.length === 0) {
			add(
				"title",
				"title_required",
				"A card without a seed needs a title; a seed reverts to its default name with null.",
			);
		} else if (title.length > maxTitleLength) {
			add(
				"title",
				"title_too_long",
				`A title is at most ${maxTitleLength} characters.`,
			);
		}
	}

	const seen = new Set<string>();
	card.conditions.forEach((condition, index) => {
		const label = `conditions.${index}`;
		if (seen.has(condition.field)) {
			add(
				label,
				"duplicate_condition",
				`A card carries at most one ${condition.field} condition — two would AND into near-nothing.`,
			);
			return;
		}
		seen.add(condition.field);
		issues.push(...conditionIssues(condition, label));
	});

	if (
		card.sort !== null &&
		!(sortFields as readonly string[]).includes(card.sort.field)
	) {
		add(
			"sort",
			"invalid_sort",
			`A sort's field must be one of ${sortFields.join(", ")}.`,
		);
	}
	if (!Number.isInteger(card.max) || card.max < 1 || card.max > overviewLimit) {
		add(
			"max",
			"invalid_max",
			`max is a whole number from 1 to ${overviewLimit}.`,
		);
	} else if (
		!Number.isInteger(card.shown) ||
		card.shown < 1 ||
		card.shown > card.max
	) {
		add("shown", "invalid_shown", `shown is a whole number from 1 to max.`);
	}
	if (
		card.empty.mode !== "hide" &&
		!(card.empty.mode === "say" && card.empty.key === genericEmptyKey)
	) {
		add(
			"empty",
			"invalid_empty",
			`An empty mode is hide, or say with the app's own key ${genericEmptyKey} — a custom message is not writable over the API.`,
		);
	}

	return issues;
}

/** One card as the editor draws it: the card, its scope and its hide flag. */
export interface ApiCardRow extends ApiCard {
	scope: CardScope;
	hidden: boolean;
	/** The value a later `PATCH` or `DELETE` sends back as `If-Match`. */
	etag: string;
}

/** The merged list's order: `(rank, id)`, the board's own order. */
function byRankAndId(a: ApiCard, b: ApiCard): number {
	if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Global + home + shared, with each card's scope and hide flag, ordered by
 * `(rank, id)` — the same merge `editorList` runs, and the same rule: a
 * later scope wins on an id collision, and hidden shared cards stay listed.
 */
export function editorRows(
	global: readonly ApiCard[],
	home: readonly ApiCard[],
	shared: readonly ApiCard[],
	hiddenSharedIds: readonly string[],
): ApiCardRow[] {
	const row = (
		card: ApiCard,
		scope: CardScope,
		hidden: boolean,
	): ApiCardRow => ({
		...card,
		scope,
		hidden,
		etag: etagForCard(card),
	});

	const byId = new Map<string, ApiCardRow>();
	for (const card of global) byId.set(card.id, row(card, "global", false));
	for (const card of home) byId.set(card.id, row(card, "home", false));
	const hidden = new Set(hiddenSharedIds);
	for (const card of shared) {
		byId.set(card.id, row(card, "shared", hidden.has(card.id)));
	}

	return [...byId.values()].sort((a, b) => byRankAndId(a, b));
}

/**
 * `count` fresh ranks for a scope re-ordered as one block between its
 * current neighbours. A stored rank this library did not produce would throw
 * inside the generator — the failure `rankAfter` guards nodes against — so
 * each bound is validated first and a junk one falls back to "no bound",
 * which puts the block at an end rather than failing the request.
 */
export function blockRanks(
	before: string | null,
	after: string | null,
	count: number,
): string[] {
	const usable = (key: string | null): string | null => {
		if (key === null) return null;
		try {
			rankSequence(key, null, 1);
			return key;
		} catch {
			return null;
		}
	};
	return rankSequence(usable(before), usable(after), count);
}
