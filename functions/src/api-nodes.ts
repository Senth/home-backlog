import { createHash } from "node:crypto";
import { type CardRow, type CardScope, etagForCard } from "./card.js";
import {
	type CreatedVia,
	type Effort,
	efforts,
	type Priority,
	priorities,
	type Status,
	statuses,
	type Visibility,
} from "./node.js";
import { defaultLocationColor, defaultLocationIcon } from "./validate.js";

/**
 * What a node looks like on the wire, and who is allowed to see it.
 *
 * Pure, and tested as such. The visibility predicate below is the single most
 * dangerous function in this package: the client cannot express
 * `visibility == 'shared' || participantIds array-contains me` as one query —
 * Firestore rejects a whole query if any matching document could be denied, so a
 * board runs two queries and merges — but the Admin SDK is subject to no rules
 * at all, so the function reads *every* matching document and has to apply the
 * predicate itself. Forget it, and another member's private project comes back
 * over the API.
 */

/**
 * The rule's `visibleToMe()`, in TypeScript.
 *
 * Strict about `'shared'`: anything that is not exactly that string falls
 * through to the participant test, so a document with a missing or corrupt
 * `visibility` is treated as private rather than as public. That is the safe
 * direction to be wrong in, and it is the direction the rules are wrong in too —
 * reading an absent field there is an evaluation error, which denies.
 */
export function visibleTo(data: Record<string, unknown>, uid: string): boolean {
	if (data.visibility === "shared") return true;
	const participantIds = data.participantIds;
	return Array.isArray(participantIds) && participantIds.includes(uid);
}

/** A Firestore timestamp as ISO 8601, or null. Anything unreadable is null. */
function isoTime(value: unknown): string | null {
	const stamp = value as { toDate?: () => Date } | null;
	if (stamp == null || typeof stamp.toDate !== "function") return null;
	return stamp.toDate().toISOString();
}

/**
 * A node's `ETag`: its `updatedAt`, quoted.
 *
 * The API's only concurrency control. An agent that read a card, thought about
 * it, and comes back to write can send it as `If-Match` and be told that
 * somebody edited it in between, rather than silently overwriting them. A node
 * with no readable `updatedAt` gets `""`, which matches nothing — the safe
 * direction, because it refuses the precondition rather than passing it.
 */
export function etagFor(updatedAt: unknown): string {
	const iso = isoTime(updatedAt);
	return iso === null ? '""' : `"${iso}"`;
}

function stringOr(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function oneOf<T extends string>(
	value: unknown,
	allowed: readonly T[],
	fallback: T,
): T {
	return (allowed as readonly string[]).includes(value as string)
		? (value as T)
		: fallback;
}

function oneOfOrNull<T extends string>(
	value: unknown,
	allowed: readonly T[],
): T | null {
	return (allowed as readonly string[]).includes(value as string)
		? (value as T)
		: null;
}

/**
 * A counter, clamped on read exactly as `toNode` clamps it in the app.
 *
 * The rules bound neither counter — a lower bound would fail a *delete* on an
 * offline race, because `increment()` commutes and can dip below zero on its way
 * to the right answer — so the clamp lives on the read side, where the worst a
 * wrong value can do is mislead about how many steps a card has.
 */
function counter(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 0;
	return Math.max(0, Math.trunc(value));
}

export interface ApiNode {
	id: string;
	title: string;
	status: Status;
	rank: string;
	parentId: string | null;
	ancestorIds: string[];
	locationId: string | null;
	locationAncestorIds: string[];
	participantIds: string[];
	assigneeIds: string[];
	visibility: Visibility;
	columns: Status[];
	childCount: number;
	doneCount: number;
	dueDate: string | null;
	priority: Priority | null;
	effort: Effort | null;
	blockedBy: string[];
	/** The ids of the home's label definitions this card carries (#100). */
	labelIds: string[];
	notes: string;
	checklist: unknown[];
	attachments: unknown[];
	/** Denormalized from `attachments.length`, for queries that cannot ask. */
	attachmentCount: number;
	attachmentDisplay: "count" | "thumbnails" | "hero";
	heroAttachmentId: string | null;
	archived: boolean;
	createdVia: CreatedVia;
	completedAt: string | null;
	createdAt: string | null;
	createdBy: string;
	updatedAt: string | null;
}

/**
 * A stored document as JSON, read defensively.
 *
 * Every field is written on create, so in practice nothing here is missing — but
 * a document from a seeded fixture or from a version of the app that predates a
 * field still has to serialize rather than throw, the same argument `toNode`
 * makes on the client. Timestamps become ISO 8601 strings: an agent has no
 * Firestore SDK, and `{"_seconds":...}` is not a date anything can parse.
 */
export function apiNode(id: string, data: Record<string, unknown>): ApiNode {
	return {
		id,
		title: stringOr(data.title, ""),
		status: oneOf<Status>(data.status, statuses, "backlog"),
		rank: stringOr(data.rank, ""),
		parentId: stringOrNull(data.parentId),
		ancestorIds: strings(data.ancestorIds),
		// Read but never written: filing work in a place is #51's, and until
		// then the API refuses both of these in a node request body.
		locationId: stringOrNull(data.locationId),
		locationAncestorIds: strings(data.locationAncestorIds),
		participantIds: strings(data.participantIds),
		assigneeIds: strings(data.assigneeIds),
		visibility: data.visibility === "private" ? "private" : "shared",
		columns: strings(data.columns).filter((column): column is Status =>
			(statuses as readonly string[]).includes(column),
		),
		childCount: counter(data.childCount),
		doneCount: counter(data.doneCount),
		dueDate: stringOrNull(data.dueDate),
		priority: oneOfOrNull<Priority>(data.priority, priorities),
		effort: oneOfOrNull<Effort>(data.effort, efforts),
		blockedBy: strings(data.blockedBy),
		labelIds: strings(data.labelIds),
		notes: stringOr(data.notes, ""),
		checklist: Array.isArray(data.checklist) ? data.checklist : [],
		attachments: Array.isArray(data.attachments) ? data.attachments : [],
		attachmentCount: counter(data.attachmentCount),
		attachmentDisplay: oneOf(
			data.attachmentDisplay,
			["count", "thumbnails", "hero"],
			"count",
		),
		heroAttachmentId: stringOrNull(data.heroAttachmentId),
		archived: data.archived === true,
		// Absent means `'app'`, which is true of every node written before the API
		// existed. Nothing queries this field, so nothing needed backfilling.
		createdVia: data.createdVia === "api" ? "api" : "app",
		completedAt: isoTime(data.completedAt),
		createdAt: isoTime(data.createdAt),
		createdBy: stringOr(data.createdBy, ""),
		updatedAt: isoTime(data.updatedAt),
	};
}

export interface ApiLocation {
	id: string;
	title: string;
	parentId: string | null;
	ancestorIds: string[];
	rank: string;
	/** What the place is recognisable by (#205); defaulted when not stored. */
	icon: string;
	color: string;
	createdAt: string | null;
	createdBy: string;
	updatedAt: string | null;
}

/**
 * A stored location as JSON, read defensively — the same argument `apiNode`
 * makes. Smaller than a node, because a location is household furniture: no
 * visibility, no participants, no counters. The id fields are read but never
 * taken from a request body; `ancestorIds` is derived from `parentId`. A
 * document written before #205 reads as the defaults, not as holes.
 */
export function apiLocation(
	id: string,
	data: Record<string, unknown>,
): ApiLocation {
	return {
		id,
		title: stringOr(data.title, ""),
		parentId: stringOrNull(data.parentId),
		ancestorIds: strings(data.ancestorIds),
		rank: stringOr(data.rank, ""),
		icon: stringOr(data.icon, defaultLocationIcon),
		color: stringOr(data.color, defaultLocationColor),
		createdAt: isoTime(data.createdAt),
		createdBy: stringOr(data.createdBy, ""),
		updatedAt: isoTime(data.updatedAt),
	};
}

export interface ApiLabel {
	id: string;
	title: string;
	icon: string;
	color: string;
	rank: string;
	/**
	 * A quoted sha-1 over the entry's four fields — the same value the write
	 * verbs check against `If-Match`, so one read tells a caller what to send.
	 */
	etag: string;
}

/**
 * A stored label entry as JSON, read defensively — the same argument
 * `apiLocation` makes.
 *
 * There is no `updatedAt` to build an ETag from: the map lives on the home
 * document and every write is a field-path update, so the hash below is over
 * the entry's own fields instead. It changes the moment any one of them does,
 * which is the property `If-Match` needs.
 */
export function etagForLabel(label: {
	title: unknown;
	icon: unknown;
	color: unknown;
	rank: unknown;
}): string {
	// NUL cannot appear in a glyph name, a hue name, a hex or a rank, so the
	// four values cannot collide across a field boundary.
	const hash = createHash("sha1")
		.update(
			`${String(label.title)}\u0000${String(label.icon)}\u0000${String(label.color)}\u0000${String(label.rank)}`,
		)
		.digest("hex");
	return `"${hash}"`;
}

export function apiLabel(id: string, data: Record<string, unknown>): ApiLabel {
	const entry = {
		title: stringOr(data.title, ""),
		icon: stringOr(data.icon, ""),
		color: stringOr(data.color, ""),
		rank: stringOr(data.rank, ""),
	};
	return { id, ...entry, etag: etagForLabel(entry) };
}

export interface ApiCardRow {
	id: string;
	kind: "filter" | "completed";
	seedId: string | null;
	title: string | null;
	conditions: unknown[];
	sort: { field: string; direction: "asc" | "desc" } | null;
	shown: number;
	max: number;
	empty: { mode: "hide" } | { mode: "say"; key: string };
	rank: string;
	/** Which surface holds this card — what a write on the id reaches. */
	scope: CardScope;
	/** A shared card the calling member hid, and the read screen drops. */
	hidden: boolean;
	/** A quoted sha-1 over the card's own fields, for `If-Match`. */
	etag: string;
}

/**
 * One merged card row as JSON. The card itself arrives through `readCard`,
 * which has already read it defensively — this only flattens the editor's
 * view onto the wire, scope and hide flag included.
 */
export function apiCardRow(row: CardRow): ApiCardRow {
	const { card } = row;
	return {
		id: card.id,
		kind: card.kind,
		seedId: card.seedId,
		title: card.title,
		conditions: card.conditions,
		sort: card.sort,
		shown: card.shown,
		max: card.max,
		empty: card.empty,
		rank: card.rank,
		scope: row.scope,
		hidden: row.hidden,
		etag: etagForCard(card),
	};
}

export interface ApiHomeMember {
	uid: string;
	role: string;
	displayName: string;
}

export interface ApiHome {
	id: string;
	name: string;
	/** The caller's own role, which is what decides what they may do here. */
	role: string;
	members: ApiHomeMember[];
}

/**
 * A home as JSON, including its members.
 *
 * The member list is not decoration: `assigneeIds` takes uids, and an agent that
 * could not resolve a name to a uid could never assign anybody anything. Every
 * uid here is already visible to every member through `participantIds` and
 * `memberProfiles`.
 */
export function apiHome(
	id: string,
	data: Record<string, unknown>,
	uid: string,
): ApiHome {
	const members = (data.members ?? {}) as Record<string, unknown>;
	const profiles = (data.memberProfiles ?? {}) as Record<string, unknown>;

	return {
		id,
		name: stringOr(data.name, ""),
		role: stringOr(members[uid], ""),
		members: Object.entries(members).map(([memberUid, role]) => ({
			uid: memberUid,
			role: stringOr(role, ""),
			displayName: stringOr(
				(profiles[memberUid] as { displayName?: unknown } | undefined)
					?.displayName,
				"",
			),
		})),
	};
}
