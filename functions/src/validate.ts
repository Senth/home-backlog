import { ApiError } from "./errors.js";
import { iconNames } from "./icon-names.js";
import { isLabelColor, type Label, maxLabelTitleLength } from "./label.js";
import {
	defaultColumns,
	dueDatePattern,
	type Effort,
	efforts,
	maxChecklistItems,
	maxLabelsPerNode,
	maxNotesLength,
	maxPhotos,
	maxTitleLength,
	type Priority,
	priorities,
	type Status,
	statuses,
	type Visibility,
	visibilities,
} from "./node.js";

/**
 * Every invariant `firestore.rules` states about a node, re-stated in
 * TypeScript.
 *
 * The API writes with the Admin SDK, which is not subject to the rules, so on
 * this one path the rules that state these invariants do not enforce them.
 * Nothing here is new policy: every check below has a counterpart in
 * `validNode()`, `structure()` or `inherits()`, and the test file is written
 * from the same case list as `tests/rules/firestore.test.ts`. Two
 * implementations of one truth can drift; that is the accepted cost of an
 * atomic subtree write, and this file plus its tests are the mitigation.
 *
 * Two checks are **stricter than the rules**, on purpose:
 *
 * - `status` must be one of the parent's frozen `columns`. The rules permit any
 *   of the seven because #63 will edit column sets, but a card in a column the
 *   board does not show has a one-way exit — the move sheet only offers frozen
 *   destinations — and an agent has no eyes on the board it is writing to.
 * - `locationAncestorIds` is a denormalized path the server derives from the
 *   `locationId` a body may name (#246), never one the body supplies; an
 *   invented path makes "everything in the Basement" return the wrong set
 *   permanently.
 *
 * Pure, with no I/O: a bulk request is validated in **full** before anything is
 * written, so the caller gets per-index errors it can fix and resend, and a
 * half-written tree never exists.
 */

export interface ValidationIssue {
	/** The offending field, where one field is to blame. */
	field?: string;
	code: string;
	message: string;
}

/**
 * What a prospective child needs to know about its parent. Read once by the
 * handler and passed in, so that validation itself stays free of I/O.
 */
export interface ParentFacts {
	id: string;
	visibility: Visibility;
	participantIds: readonly string[];
	/** The frozen column set of the board this node's children form. */
	columns: readonly Status[];
	/** The parent's own path, from which a child's `ancestorIds` is derived. */
	ancestorIds: readonly string[];
}

export interface NodeContext {
	/**
	 * The id the document will have. A node is never in its own `ancestorIds`,
	 * and a bulk payload that said otherwise would write a cycle no screen could
	 * ever escape.
	 */
	nodeId: string;
	/** `null` for a node at the root board. */
	parent: ParentFacts | null;
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function isStringList(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(isString);
}

function isList(value: unknown): value is unknown[] {
	return Array.isArray(value);
}

function isInt(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value);
}

function oneOf<T extends string>(
	value: unknown,
	allowed: readonly T[],
): boolean {
	return isString(value) && (allowed as readonly string[]).includes(value);
}

/** The columns a node's `status` may take, given the board it sits on. */
export function allowedColumns(parent: ParentFacts | null): readonly Status[] {
	return parent === null ? defaultColumns : parent.columns;
}

/**
 * The rule's `validNode()`, field for field and bound for bound.
 *
 * `data` is the document exactly as it will be written, so this costs the same
 * on an update as on a create and no partial patch can slip past it — the same
 * property `request.resource.data` gives the rules.
 */
function fieldIssues(data: Record<string, unknown>): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const add = (field: string, code: string, message: string) =>
		issues.push({ field, code, message });

	if (!isString(data.title) || data.title.length < 1) {
		add("title", "title_required", "A node needs a title.");
	} else if (data.title.length > maxTitleLength) {
		add(
			"title",
			"title_too_long",
			`A title is at most ${maxTitleLength} characters.`,
		);
	}

	if (!oneOf<Status>(data.status, statuses)) {
		add(
			"status",
			"invalid_status",
			`status must be one of ${statuses.join(", ")}.`,
		);
	}

	if (
		!isList(data.columns) ||
		data.columns.length < 1 ||
		data.columns.length > statuses.length ||
		!data.columns.every((column) => oneOf<Status>(column, statuses))
	) {
		add(
			"columns",
			"invalid_columns",
			`columns must be a non-empty list of ${statuses.join(", ")}.`,
		);
	}

	// `is int` and nothing more, exactly as the rules have it. A lower bound
	// looks correct and is a trap: one device offline marking a step done while
	// another deletes that step can drive the transformed value below zero, which
	// would reject the whole batch and fail a *delete*. The app clamps on read.
	if (!isInt(data.childCount)) {
		add("childCount", "invalid_counter", "childCount must be an integer.");
	}
	if (!isInt(data.doneCount)) {
		add("doneCount", "invalid_counter", "doneCount must be an integer.");
	}

	if (!isString(data.rank) || data.rank.length === 0) {
		add("rank", "invalid_rank", "rank must be a non-empty string.");
	}

	if (data.parentId !== null && !isString(data.parentId)) {
		add("parentId", "invalid_parent", "parentId must be a string or null.");
	}

	if (!isStringList(data.ancestorIds)) {
		add(
			"ancestorIds",
			"invalid_ancestors",
			"ancestorIds must be a list of ids.",
		);
	}

	if (data.locationId !== null && !isString(data.locationId)) {
		add(
			"locationId",
			"invalid_location",
			"locationId must be a string or null.",
		);
	}
	if (!isStringList(data.locationAncestorIds)) {
		add(
			"locationAncestorIds",
			"invalid_location",
			"locationAncestorIds must be a list of ids.",
		);
	}

	if (!isStringList(data.participantIds)) {
		add(
			"participantIds",
			"invalid_participants",
			"participantIds must be a list of uids.",
		);
	}

	// Who is doing *this* node. Read by no rule anywhere, which is what keeps an
	// assignment from being a permission change — a key may write this and can
	// still never revoke anybody's access.
	if (!isStringList(data.assigneeIds)) {
		add(
			"assigneeIds",
			"invalid_assignees",
			"assigneeIds must be a list of uids.",
		);
	}

	if (!isStringList(data.blockedBy)) {
		add(
			"blockedBy",
			"invalid_blocked_by",
			"blockedBy must be a list of node ids.",
		);
	}

	// The labels a card carries directly (#100). Present-only, exactly as the
	// rules have it: every node written before #100 lacks the key, and this
	// validates the full post-write document, so requiring it would deny every
	// update to them. The ids are not checked against the home's `labels` map —
	// that would cost a read per node and buy nothing a stale id does not
	// already survive in the app, where a deleted definition resolves to
	// nothing and renders nothing.
	if ("labelIds" in data) {
		if (!isStringList(data.labelIds)) {
			add("labelIds", "invalid_labels", "labelIds must be a list of ids.");
		} else if (data.labelIds.length > maxLabelsPerNode) {
			add(
				"labelIds",
				"too_many_labels",
				`A card carries at most ${maxLabelsPerNode} labels.`,
			);
		}
	}

	if (!oneOf<Visibility>(data.visibility, visibilities)) {
		add(
			"visibility",
			"invalid_visibility",
			`visibility must be one of ${visibilities.join(", ")}.`,
		);
	}

	if (
		data.dueDate !== null &&
		!(isString(data.dueDate) && dueDatePattern.test(data.dueDate))
	) {
		add("dueDate", "invalid_due_date", "dueDate must be YYYY-MM-DD or null.");
	}

	if (data.priority !== null && !oneOf<Priority>(data.priority, priorities)) {
		add(
			"priority",
			"invalid_priority",
			`priority must be one of ${priorities.join(", ")}, or null.`,
		);
	}

	if (data.effort !== null && !oneOf<Effort>(data.effort, efforts)) {
		add(
			"effort",
			"invalid_effort",
			`effort must be one of ${efforts.join(", ")}, or null.`,
		);
	}

	if (!isString(data.notes)) {
		add("notes", "invalid_notes", "notes must be a string.");
	} else if (data.notes.length > maxNotesLength) {
		add(
			"notes",
			"notes_too_long",
			`notes are at most ${maxNotesLength} characters.`,
		);
	}

	if (!isList(data.checklist)) {
		add("checklist", "invalid_checklist", "checklist must be a list.");
	} else if (data.checklist.length > maxChecklistItems) {
		add(
			"checklist",
			"too_many_checklist_items",
			`A checklist holds at most ${maxChecklistItems} items.`,
		);
	}

	if (!isList(data.photos)) {
		add("photos", "invalid_photos", "photos must be a list.");
	} else if (data.photos.length > maxPhotos) {
		add(
			"photos",
			"too_many_photos",
			`A node holds at most ${maxPhotos} photos.`,
		);
	}

	if (typeof data.archived !== "boolean") {
		add("archived", "invalid_archived", "archived must be a boolean.");
	}

	// A completion date is not reconstructible after the fact, and deriving it
	// from `updatedAt` is wrong the moment anyone edits a finished node. So the
	// two agree, in both directions. The value itself is a server timestamp the
	// handler writes, so what is checkable here is the agreement.
	if ((data.status === "done") !== (data.completedAt != null)) {
		add(
			"completedAt",
			"completed_at_mismatch",
			"completedAt is set if and only if status is done.",
		);
	}

	if (!isString(data.createdBy) || data.createdBy.length === 0) {
		add("createdBy", "invalid_created_by", "createdBy must be a uid.");
	}
	// Required so that the rules' `immutable()` has something to compare against.
	// A document created without them could never be updated again.
	if (data.createdAt == null) {
		add("createdAt", "invalid_timestamp", "createdAt must be written.");
	}
	if (data.updatedAt == null) {
		add("updatedAt", "invalid_timestamp", "updatedAt must be written.");
	}

	return issues;
}

/**
 * The rule's `structure()`: `ancestorIds` ends at `parentId`, is empty exactly
 * when there is no parent, and never contains the node itself.
 *
 * Structural rather than a full path walk, the same as the rules — `parentId` is
 * the source of truth and `ancestorIds` is derived from it, so a wrong
 * *grandparent* is always recomputable, while a cycle or a mismatched tail is
 * not.
 */
function structureIssues(
	data: Record<string, unknown>,
	context: NodeContext,
): ValidationIssue[] {
	const parentId = data.parentId;
	const ancestorIds = data.ancestorIds;
	if (!isStringList(ancestorIds)) return [];
	if (parentId !== null && !isString(parentId)) return [];

	const issues: ValidationIssue[] = [];

	if (parentId === null) {
		if (ancestorIds.length !== 0) {
			issues.push({
				field: "ancestorIds",
				code: "invalid_ancestors",
				message: "A node with no parent has no ancestors.",
			});
		}
	} else if (ancestorIds[ancestorIds.length - 1] !== parentId) {
		issues.push({
			field: "ancestorIds",
			code: "invalid_ancestors",
			message: "The last ancestor must be the parent.",
		});
	}

	if (ancestorIds.includes(context.nodeId)) {
		issues.push({
			field: "ancestorIds",
			code: "cycle",
			message: "A node cannot be its own ancestor.",
		});
	}

	if (context.parent !== null && parentId !== context.parent.id) {
		issues.push({
			field: "parentId",
			code: "invalid_parent",
			message: "parentId does not match the parent that was resolved.",
		});
	}

	return issues;
}

/**
 * The rule's `inherits()` — the invariant that makes privacy *queryable*.
 *
 * A node's visibility equals its parent's, and a private node carries all of its
 * parent's participants. Without it no client query can see another member's
 * private descendant, so a reparent leaves it with stale `ancestorIds` and a
 * delete orphans it permanently, with no error anywhere and no way to find it
 * afterwards. The cost is a product restriction that is stated in the app and
 * has to be stated here: a private card cannot live inside a shared project.
 */
function inheritanceIssues(
	data: Record<string, unknown>,
	context: NodeContext,
): ValidationIssue[] {
	const parent = context.parent;
	if (parent === null) return [];

	const issues: ValidationIssue[] = [];

	if (data.visibility !== parent.visibility) {
		issues.push({
			field: "visibility",
			code: "visibility_mismatch",
			message: `A child of a ${parent.visibility} node is ${parent.visibility}.`,
		});
		return issues;
	}

	if (parent.visibility === "private") {
		const participantIds = isStringList(data.participantIds)
			? data.participantIds
			: [];
		const missing = parent.participantIds.filter(
			(uid) => !participantIds.includes(uid),
		);
		if (missing.length > 0) {
			issues.push({
				field: "participantIds",
				code: "participants_not_inherited",
				message: `A private node carries all of its parent's participants; missing ${missing.join(", ")}.`,
			});
		}
	}

	return issues;
}

/**
 * Stricter than the rules, and stated separately so it reads as the deliberate
 * choice it is: an agent cannot see the board it is writing to, and a card
 * parked in a column that board does not draw can be moved out and never back.
 */
function statusIssues(
	data: Record<string, unknown>,
	context: NodeContext,
): ValidationIssue[] {
	const allowed = allowedColumns(context.parent);
	if (!oneOf<Status>(data.status, statuses)) return [];
	if ((allowed as readonly string[]).includes(data.status as string)) return [];

	return [
		{
			field: "status",
			code: "status_not_in_columns",
			message: `This board shows ${allowed.join(", ")}.`,
		},
	];
}

/**
 * Every issue with one prospective node document, in one pass.
 *
 * All of them, never the first: a caller that gets one error per round trip
 * fixes one thing per round trip, and the whole point of validating a bulk
 * payload before writing it is that the caller can fix everything and resend.
 */
export function validateNode(
	data: Record<string, unknown>,
	context: NodeContext,
): ValidationIssue[] {
	return [
		...fieldIssues(data),
		...structureIssues(data, context),
		...inheritanceIssues(data, context),
		...statusIssues(data, context),
	];
}

/**
 * Whether a uid is a member of a home, from the home document's `members` map.
 *
 * The one authorization question the API asks, and it is asked per home rather
 * than per key: a key is its owner, so it reaches every home that person is a
 * member of and gains a new one the moment they join it.
 */
export function isMember(
	members: unknown,
	uid: string,
): members is Record<string, string> {
	if (members === null || typeof members !== "object") return false;
	const role = (members as Record<string, unknown>)[uid];
	return role === "owner" || role === "member";
}

/**
 * `participantIds` is honoured on a shared root and nowhere else — a child takes
 * its parent's list by the inheritance rule and a private root takes its
 * creator. A body that names one anywhere else is refused rather than silently
 * dropped, the same way a mismatched `visibility` is.
 *
 * A named uid that is not a member is a typo or a stale id, and storing it means
 * a participant list naming somebody who can never see the project — a row on
 * the details screen that no member can untick and no member matches.
 */
export function refuseUnusableParticipants(
	participantIds: readonly string[] | undefined,
	isRoot: boolean,
	visibility: Visibility,
	memberUids: readonly string[],
): void {
	if (participantIds === undefined) return;
	if (!isRoot || visibility === "private") {
		throw new ApiError(
			400,
			"participants_immutable",
			isRoot
				? "A private root is on its creator. Omit participantIds."
				: "A child takes its parent's participants. Omit participantIds.",
		);
	}
	const strangers = participantIds.filter((uid) => !memberUids.includes(uid));
	if (strangers.length > 0) {
		throw new ApiError(
			400,
			"participants_invalid",
			`Not a member of this home: ${strangers.join(", ")}.`,
		);
	}
}

/**
 * The rules' `rootHasParticipants()`, mirrored: the Admin SDK bypasses
 * `firestore.rules` entirely, so a shared root with nobody on it is refused
 * here or it is refused nowhere. Fires on a create that names an empty list
 * outright, and on a promotion out of a root the #102 backfill has not reached
 * — the same refusal every *other* update to such a root already gets.
 */
export function refuseEmptyRootParticipants(
	visibility: Visibility,
	isRoot: boolean,
	participantIds: readonly string[],
): void {
	if (!isRoot || visibility !== "shared" || participantIds.length > 0) return;
	throw new ApiError(
		400,
		"participants_required",
		"A shared root needs at least one participant. Omit participantIds to include every member, or send at least one uid.",
	);
}

export interface LocationContext {
	/**
	 * The id the document will have. A location is never in its own
	 * `ancestorIds`, and a body that said otherwise would write a cycle no
	 * screen could ever escape.
	 */
	locationId: string;
	/** `null` for a root place. */
	parent: { id: string; ancestorIds: readonly string[] } | null;
}

/**
 * The rules' `validLocation()` and their locations `structure()`, re-stated in
 * TypeScript — the mirror the location verbs write through, exactly as
 * `validateNode` is the one the node verbs write through.
 *
 * A location carries no inheritance invariant beyond structure — no visibility,
 * no participants — so unlike a node's parent, resolving its parent costs no
 * `get()` on anybody's behalf and a batched subtree move never approaches the
 * twenty-document-access budget. The rules need no `get()` either, and the two
 * check the same fields: title 1–200, `parentId` null or a string, `ancestorIds`
 * a list ending at `parentId` (empty at the root) and never containing the
 * location's own id, a non-empty `rank`, and the three timestamps present.
 */
export function validateLocation(
	data: Record<string, unknown>,
	context: LocationContext,
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const add = (field: string, code: string, message: string) =>
		issues.push({ field, code, message });

	if (!isString(data.title) || data.title.length < 1) {
		add("title", "title_required", "A location needs a title.");
	} else if (data.title.length > maxTitleLength) {
		add(
			"title",
			"title_too_long",
			`A title is at most ${maxTitleLength} characters.`,
		);
	}

	if (data.parentId !== null && !isString(data.parentId)) {
		add("parentId", "invalid_parent", "parentId must be a string or null.");
	}

	if (!isStringList(data.ancestorIds)) {
		add(
			"ancestorIds",
			"invalid_ancestors",
			"ancestorIds must be a list of ids.",
		);
	}

	if (!isString(data.rank) || data.rank.length === 0) {
		add("rank", "invalid_rank", "rank must be a non-empty string.");
	}

	if (!isString(data.createdBy) || data.createdBy.length === 0) {
		add("createdBy", "invalid_created_by", "createdBy must be a uid.");
	}
	if (data.createdAt == null) {
		add("createdAt", "invalid_timestamp", "createdAt must be written.");
	}
	if (data.updatedAt == null) {
		add("updatedAt", "invalid_timestamp", "updatedAt must be written.");
	}

	const parentId = data.parentId;
	const ancestorIds = data.ancestorIds;
	if (isStringList(ancestorIds) && (parentId === null || isString(parentId))) {
		if (parentId === null) {
			if (ancestorIds.length !== 0) {
				add(
					"ancestorIds",
					"invalid_ancestors",
					"A location with no parent has no ancestors.",
				);
			}
		} else if (ancestorIds[ancestorIds.length - 1] !== parentId) {
			add(
				"ancestorIds",
				"invalid_ancestors",
				"The last ancestor must be the parent.",
			);
		}

		if (ancestorIds.includes(context.locationId)) {
			add("ancestorIds", "cycle", "A location cannot be its own ancestor.");
		}

		if (context.parent !== null && parentId !== context.parent.id) {
			add(
				"parentId",
				"invalid_parent",
				"parentId does not match the parent that was resolved.",
			);
		}
	}

	return issues;
}

/**
 * Every value check one label entry answers, against the stored entry as it
 * will be written — the same full-document shape `validateNode` costs.
 *
 * Two conflicts are deliberately **not** here: a home at 300 labels and a
 * title another definition already carries are state conflicts, read against
 * the home document at write time, and the route answers them with 409 inside
 * the transaction that writes — a 400 would call a refusal a typo when what it
 * names is a race.
 */
export function validateLabel(
	data: Partial<Record<keyof Label, unknown>>,
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const add = (field: string, code: string, message: string) =>
		issues.push({ field, code, message });

	if (!isString(data.title) || data.title.length < 1) {
		add("title", "title_required", "A label needs a title.");
	} else if (data.title.length > maxLabelTitleLength) {
		add(
			"title",
			"title_too_long",
			`A title is at most ${maxLabelTitleLength} characters.`,
		);
	}

	// The caller is an LLM; a hallucinated glyph is a label with no identity, so
	// the name is checked against the generated set the picker draws from.
	if (
		!isString(data.icon) ||
		!(iconNames as ReadonlySet<string>).has(data.icon)
	) {
		add(
			"icon",
			"unknown_icon",
			"icon must be a MaterialCommunityIcons glyph name, such as wrench.",
		);
	}

	if (!isLabelColor(data.color)) {
		add(
			"color",
			"invalid_color",
			"color must be one of red, orange, amber, lime, green, teal, cyan, blue, indigo, purple, pink, stone, or a #rgb / #rrggbb hex.",
		);
	}

	if (!isString(data.rank) || data.rank.length === 0) {
		add("rank", "invalid_rank", "rank must be a non-empty string.");
	}

	return issues;
}
