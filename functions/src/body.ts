import { cardScopes } from "./card.js";
import { ApiError } from "./errors.js";
import {
	type Effort,
	efforts,
	type Priority,
	priorities,
	type Status,
	statuses,
	type Visibility,
	visibilities,
} from "./node.js";

/**
 * What a request body is allowed to say, and what it is refused for saying.
 *
 * An **allow-list**, not a deny-list. Most of a node document is the server's:
 * `ancestorIds` is derived from `parentId`, `columns` is frozen by depth at
 * creation, `rank` is computed from the target column's neighbours, the counters
 * move with `increment()`, and `completedAt` follows `status`. A caller that
 * could set any of them could write a document that is internally inconsistent
 * and pass every field check while doing it. So an unknown field is a refusal
 * rather than something quietly dropped — an agent that believes it filed work
 * it did not file is the failure mode this whole file exists to avoid.
 *
 * Four fields are refused **by name**, because each deserves its own answer:
 *
 * - `locationAncestorIds` on a **node** — a denormalized path the server
 *   derives from the `locationId` the body names, so a caller-supplied one
 *   could disagree with the place and make "everything in the Basement"
 *   return the wrong set permanently, with no screen anywhere showing a
 *   discrepancy. `locationId` itself is taken (#246): the places have verbs
 *   (`parseLocationBody` below), and now the filing of work in them does too.
 * - `visibility` and `participantIds` on an **existing** node — the same
 *   restriction stated twice. A bearer token in an env file must not be able to
 *   change who can see a household's work, and on a private node
 *   `participantIds` *is* the access list. Both are also top-down resumable
 *   writes rather than single ones, which is why the flip stays in the app.
 *   `participantIds` **is** taken on a create, where it sets the initial list
 *   rather than changing one — a shared root left unset takes every current
 *   member, since #102 (see `createNode`).
 *
 * `assigneeIds` is deliberately unrestricted. No rule reads it, so assigning
 * somebody is not a permission change — which is exactly what lets a key assign
 * without being able to revoke.
 */

export interface NodeBody {
	title?: string;
	status?: Status;
	notes?: string;
	dueDate?: string | null;
	priority?: Priority | null;
	effort?: Effort | null;
	assigneeIds?: string[];
	blockedBy?: string[];
	checklist?: unknown[];
	parentId?: string | null;
	/**
	 * The id of one of the home's locations the card is filed in (#246). The
	 * stored path is derived from the place, never sent. On a create with no
	 * `locationId` at all, the card takes its parent's place — the same
	 * semantics the app's `newNodeData` gives; `null` unfiles it.
	 */
	locationId?: string | null;
	/** Honoured on a create at the root, and refused everywhere else. */
	visibility?: Visibility;
	/**
	 * Honoured only on create. Absent on a shared root, it defaults to every
	 * current member rather than `[]` — #102 refuses an empty one. Refused on
	 * every update, for the same reason `visibility` is: an API key must not be
	 * able to change who can see a household's work.
	 */
	participantIds?: string[];
	/**
	 * The ids of the home's label definitions the card carries. The
	 * definitions behind those ids are the label verbs' (`labels.ts`); a
	 * node body carries ids only, and a gone id renders as nothing.
	 */
	labelIds?: string[];
}

/** Fields a caller may send when creating a node. */
const createFields = [
	"title",
	"status",
	"notes",
	"dueDate",
	"priority",
	"effort",
	"assigneeIds",
	"blockedBy",
	"checklist",
	"parentId",
	"locationId",
	"visibility",
	"participantIds",
	"labelIds",
] as const;

/**
 * Fields a caller may send when changing one. `visibility` is gone, and so is
 * `archived`.
 *
 * Archiving looks like an ordinary edit and is not one *yet*. `archived`
 * constrains every board query, so an archived node vanishes from every screen —
 * and nothing in the app writes or reads the field today: no archive list, no
 * unarchive control, nothing that shows an archived card at all. A key that
 * could set it could hide a household's work somewhere only another API call
 * could reach. It also moves no counters, so a project whose only step was
 * archived would keep its chevron and open an empty board, which is exactly what
 * "a card is a board only once it has steps" was built against. It becomes
 * writable when there is a surface that can undo it.
 */
const updateFields = [
	"title",
	"status",
	"notes",
	"dueDate",
	"priority",
	"effort",
	"assigneeIds",
	"blockedBy",
	"checklist",
	"parentId",
	"locationId",
	"labelIds",
] as const;

function refuse(code: string, message: string, field: string): never {
	throw new ApiError(400, code, message, [{ field, code, message }]);
}

/** A request body, or the one 400 that says it has to be an object. */
export function asObject(body: unknown): Record<string, unknown> {
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		throw new ApiError(
			400,
			"invalid_body",
			"The request body must be a JSON object.",
		);
	}
	return body as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
	if (typeof value !== "string") {
		refuse("invalid_type", `${field} must be a string.`, field);
	}
	return value;
}

function asStringOrNull(value: unknown, field: string): string | null {
	if (value === null) return null;
	return asString(value, field);
}

function asStringList(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		refuse("invalid_type", `${field} must be a list of strings.`, field);
	}
	return value as string[];
}

function asEnum<T extends string>(
	value: unknown,
	allowed: readonly T[],
	field: string,
): T {
	if (
		typeof value !== "string" ||
		!(allowed as readonly string[]).includes(value)
	) {
		refuse(
			`invalid_${field.toLowerCase()}`,
			`${field} must be one of ${allowed.join(", ")}.`,
			field,
		);
	}
	return value as T;
}

/**
 * Read a request body against the allow-list for this verb.
 *
 * Only the fields that drive a *read* before the write — `status` picks the
 * column a rank is computed from, `parentId` picks the parent to resolve,
 * `visibility` decides a root's participants — are type-checked here. Everything
 * else is checked by `validateNode` against the assembled document, so that one
 * function states every bound and the two cannot disagree.
 *
 * `alsoAllow` is for a caller that owns fields of its own on the same object: a
 * bulk payload's nodes carry `ref` and `parentRef`, which mean nothing to a node
 * document and everything to the request they arrive in. They are permitted here
 * and read by the bulk planner, rather than making the allow-list a lie.
 */
export function parseNodeBody(
	body: unknown,
	mode: "create" | "update",
	alsoAllow: readonly string[] = [],
): NodeBody {
	const raw = asObject(body);
	const allowed: readonly string[] = [
		...(mode === "create" ? createFields : updateFields),
		...alsoAllow,
	];

	for (const field of Object.keys(raw)) {
		if (allowed.includes(field)) continue;

		if (field === "locationAncestorIds") {
			refuse(
				"locations_unavailable",
				"locationAncestorIds is derived from the location that locationId names, so it cannot be sent. Send locationId alone.",
				field,
			);
		}
		if (field === "participantIds") {
			refuse(
				"participants_immutable",
				"An API key cannot change participantIds. On a private node it is the access list, and editing it is the same top-down write as a visibility flip.",
				field,
			);
		}
		if (field === "visibility") {
			refuse(
				"visibility_immutable",
				"An API key cannot change visibility on an existing node. The flip is the most dangerous write in the app, and it belongs to a person.",
				field,
			);
		}
		refuse(
			"unknown_field",
			`${field} is not a field this endpoint writes. Allowed: ${allowed.join(", ")}.`,
			field,
		);
	}

	const parsed: NodeBody = {};

	if ("title" in raw) parsed.title = asString(raw.title, "title");
	if ("status" in raw) parsed.status = asEnum(raw.status, statuses, "status");
	if ("notes" in raw) parsed.notes = asString(raw.notes, "notes");
	if ("dueDate" in raw) parsed.dueDate = asStringOrNull(raw.dueDate, "dueDate");
	if ("priority" in raw) {
		parsed.priority =
			raw.priority === null
				? null
				: asEnum(raw.priority, priorities, "priority");
	}
	if ("effort" in raw) {
		parsed.effort =
			raw.effort === null ? null : asEnum(raw.effort, efforts, "effort");
	}
	if ("assigneeIds" in raw) {
		parsed.assigneeIds = asStringList(raw.assigneeIds, "assigneeIds");
	}
	if ("blockedBy" in raw) {
		parsed.blockedBy = asStringList(raw.blockedBy, "blockedBy");
	}
	if ("checklist" in raw) {
		if (!Array.isArray(raw.checklist)) {
			refuse("invalid_type", "checklist must be a list.", "checklist");
		}
		parsed.checklist = raw.checklist;
	}
	if ("parentId" in raw) {
		parsed.parentId = asStringOrNull(raw.parentId, "parentId");
	}
	if ("locationId" in raw) {
		parsed.locationId = asStringOrNull(raw.locationId, "locationId");
	}
	if ("visibility" in raw) {
		parsed.visibility = asEnum(raw.visibility, visibilities, "visibility");
	}
	if ("participantIds" in raw) {
		parsed.participantIds = asStringList(raw.participantIds, "participantIds");
	}
	if ("labelIds" in raw) {
		parsed.labelIds = asStringList(raw.labelIds, "labelIds");
	}

	return parsed;
}

export interface LocationBody {
	title?: string;
	parentId?: string | null;
	/**
	 * Honoured on a create, where it places a new sibling directly; on an
	 * update it is an unknown field, because sibling reorder is #182's.
	 */
	rank?: string;
	/** What the place is recognisable by (#205); defaulted when omitted. */
	icon?: string;
	color?: string;
}

/** Fields a caller may send when creating a location. */
const locationCreateFields = [
	"title",
	"parentId",
	"rank",
	"icon",
	"color",
] as const;

/** Fields a caller may send when changing one. Reorder is #182's. */
const locationUpdateFields = ["title", "parentId", "icon", "color"] as const;

/**
 * Read a location body against the allow-list for this verb.
 *
 * `ancestorIds` is derived server-side from `parentId` and never read from the
 * body — the same rule the node verbs follow, for the same reason: a
 * caller-supplied path is exactly what cannot be verified from outside. What
 * *is* allowed is what a person can do from the tree screen: name a place,
 * nest it, give it a glyph and a color (#205) and — on a create only — place
 * it among its siblings.
 */
export function parseLocationBody(
	body: unknown,
	mode: "create" | "update",
): LocationBody {
	const raw = asObject(body);
	const allowed: readonly string[] =
		mode === "create" ? locationCreateFields : locationUpdateFields;

	for (const field of Object.keys(raw)) {
		if (allowed.includes(field)) continue;
		refuse(
			"unknown_field",
			`${field} is not a field this endpoint writes. Allowed: ${allowed.join(", ")}.`,
			field,
		);
	}

	const parsed: LocationBody = {};
	if ("title" in raw) parsed.title = asString(raw.title, "title");
	if ("parentId" in raw) {
		parsed.parentId = asStringOrNull(raw.parentId, "parentId");
	}
	if ("rank" in raw) parsed.rank = asString(raw.rank, "rank");
	if ("icon" in raw) parsed.icon = asString(raw.icon, "icon");
	if ("color" in raw) parsed.color = asString(raw.color, "color");

	return parsed;
}

export interface LabelBody {
	title?: string;
	icon?: string;
	color?: string;
	/**
	 * Honoured on a create, where it places a new label directly; on an update
	 * it is an unknown field, because reorder stays a person's drag handle.
	 */
	rank?: string;
}

/** Fields a caller may send when creating a label. */
const labelCreateFields = ["title", "icon", "color", "rank"] as const;

/** Fields a caller may send when changing one. Reorder is the app's. */
const labelUpdateFields = ["title", "icon", "color"] as const;

/**
 * Read a label body against the allow-list for this verb — the same shape
 * `parseLocationBody` has.
 *
 * The stored id and the definition's identity fields the server owns are
 * refused by name of the allow-list: a body that could write `id` would plant
 * a definition under a key no card names. `title`, `icon` and `color` are
 * required on a create — six agent-made blue stars defeat what labels are for
 * — and that requirement is the route's, which answers 400 before anything is
 * written.
 */
export function parseLabelBody(
	body: unknown,
	mode: "create" | "update",
): LabelBody {
	const raw = asObject(body);
	const allowed: readonly string[] =
		mode === "create" ? labelCreateFields : labelUpdateFields;

	for (const field of Object.keys(raw)) {
		if (allowed.includes(field)) continue;
		refuse(
			"unknown_field",
			`${field} is not a field this endpoint writes. Allowed: ${allowed.join(", ")}.`,
			field,
		);
	}

	const parsed: LabelBody = {};
	if ("title" in raw) parsed.title = asString(raw.title, "title");
	if ("icon" in raw) parsed.icon = asString(raw.icon, "icon");
	if ("color" in raw) parsed.color = asString(raw.color, "color");
	if ("rank" in raw) parsed.rank = asString(raw.rank, "rank");

	return parsed;
}

export interface CardBody {
	/**
	 * Where the card lives. Required on a create; on an update it is the one
	 * field that moves the card between surfaces, in the same one-atomic-write
	 * move `moveScopeCard` makes in the app.
	 */
	scope?: "global" | "home" | "shared";
	title?: string;
	/**
	 * Conditions AND together; within one, the values are ORs. The items are
	 * checked against the app's vocabulary by `validateCard` on the assembled
	 * card, so they travel raw out of here.
	 */
	conditions?: unknown;
	sort?: unknown;
	shown?: number;
	max?: number;
	empty?: unknown;
	/**
	 * Update-only. Hiding rides on the caller's own document — the one member
	 * whose overview loses the card is the key's owner — and a card that does
	 * not end on the shared surface has nothing to hide.
	 */
	hidden?: boolean;
}

/** Fields a caller may send when creating a card. */
const cardCreateFields = [
	"scope",
	"title",
	"conditions",
	"sort",
	"shown",
	"max",
	"empty",
] as const;

/** Fields a caller may send when changing one. `hidden` is update-only. */
const cardUpdateFields = [
	"scope",
	"title",
	"conditions",
	"sort",
	"shown",
	"max",
	"empty",
	"hidden",
] as const;

/**
 * Read a card body against the allow-list for this verb.
 *
 * `rank` and `seedId` are refused **by name**, because each deserves its own
 * answer: a rank is fractional and computed — order is sent to the reorder
 * verb, the way a node's rank is computed from its column — and a `seedId`
 * names a built-in card, which only a person restores, in the app.
 */
export function parseCardBody(
	body: unknown,
	mode: "create" | "update",
): CardBody {
	const raw = asObject(body);
	const allowed: readonly string[] =
		mode === "create" ? cardCreateFields : cardUpdateFields;

	for (const field of Object.keys(raw)) {
		if (allowed.includes(field)) continue;

		if (field === "rank") {
			refuse(
				"rank_computed",
				"rank is fractional and computed. Send the whole order to POST /v1/homes/{homeId}/cards:reorder instead.",
				field,
			);
		}
		if (field === "seedId") {
			refuse(
				"seed_immutable",
				"seedId names a built-in card. A seed the household removed stays removed; recreate the card without one, or restore it in the app.",
				field,
			);
		}
		refuse(
			"unknown_field",
			`${field} is not a field this endpoint writes. Allowed: ${allowed.join(", ")}.`,
			field,
		);
	}

	const parsed: CardBody = {};

	if ("scope" in raw) {
		const scope = raw.scope;
		if (
			typeof scope !== "string" ||
			!(cardScopes as readonly string[]).includes(scope)
		) {
			refuse(
				"invalid_scope",
				"scope must be one of global, home, shared.",
				"scope",
			);
		}
		parsed.scope = scope as CardBody["scope"];
	}
	if ("title" in raw) {
		if (raw.title === null) {
			refuse(
				"title_required",
				"A card needs a title; only a built-in seed may go unnamed.",
				"title",
			);
		}
		parsed.title = asString(raw.title, "title");
	}
	if ("conditions" in raw) {
		if (!Array.isArray(raw.conditions)) {
			refuse("invalid_type", "conditions must be a list.", "conditions");
		}
		parsed.conditions = raw.conditions;
	}
	if ("sort" in raw) parsed.sort = raw.sort;
	if ("shown" in raw) {
		if (typeof raw.shown !== "number" || !Number.isInteger(raw.shown)) {
			refuse("invalid_type", "shown must be an integer.", "shown");
		}
		parsed.shown = raw.shown;
	}
	if ("max" in raw) {
		if (typeof raw.max !== "number" || !Number.isInteger(raw.max)) {
			refuse("invalid_type", "max must be an integer.", "max");
		}
		parsed.max = raw.max;
	}
	if ("empty" in raw) parsed.empty = raw.empty;
	if ("hidden" in raw) {
		if (typeof raw.hidden !== "boolean") {
			refuse("invalid_type", "hidden must be a boolean.", "hidden");
		}
		parsed.hidden = raw.hidden;
	}

	return parsed;
}
