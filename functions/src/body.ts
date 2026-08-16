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
 * - `locationId` and `locationAncestorIds` — the `locations` collection has no
 *   verbs and no screens (#50, #51), so nothing can hand an agent a valid
 *   location id, and `locationAncestorIds` is a denormalized path that is
 *   unverifiable from outside. An invented one makes "everything in the
 *   Basement" return the wrong set permanently, with no screen anywhere showing
 *   a discrepancy.
 * - `visibility` and `participantIds` on an **existing** node — the same
 *   restriction stated twice. A bearer token in an env file must not be able to
 *   change who can see a household's work, and on a private node
 *   `participantIds` *is* the access list. Both are also top-down resumable
 *   writes rather than single ones, which is why the flip stays in the app.
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
	archived?: boolean;
	parentId?: string | null;
	/** Honoured on a create at the root, and refused everywhere else. */
	visibility?: Visibility;
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
	"visibility",
] as const;

/**
 * Fields a caller may send when changing one. `visibility` is gone; `archived`
 * appears, because archiving is an ordinary edit and unarchiving is the way back.
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
	"archived",
	"parentId",
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

		if (field === "locationId" || field === "locationAncestorIds") {
			refuse(
				"locations_unavailable",
				"Locations have no API yet, so work created here is unfiled. Sending a location id would file it somewhere that cannot be checked.",
				field,
			);
		}
		if (field === "participantIds") {
			refuse(
				"participants_immutable",
				mode === "create"
					? "A private node is created with the key's owner as its participant, or inherits its parent's. Add anyone else in the app."
					: "An API key cannot change participantIds. On a private node it is the access list, and editing it is the same top-down write as a visibility flip.",
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
	if ("archived" in raw) {
		if (typeof raw.archived !== "boolean") {
			refuse("invalid_type", "archived must be a boolean.", "archived");
		}
		parsed.archived = raw.archived;
	}
	if ("parentId" in raw) {
		parsed.parentId = asStringOrNull(raw.parentId, "parentId");
	}
	if ("visibility" in raw) {
		parsed.visibility = asEnum(raw.visibility, visibilities, "visibility");
	}

	return parsed;
}
