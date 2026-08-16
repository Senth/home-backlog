import {
	type Effort,
	efforts,
	type Priority,
	priorities,
	type Status,
	statuses,
	type Visibility,
} from "./node.js";

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
	notes: string;
	checklist: unknown[];
	photos: unknown[];
	archived: boolean;
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
		// Read but never written: the location verbs arrive with #50 and #51, and
		// until then the API refuses both of these in a request body.
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
		notes: stringOr(data.notes, ""),
		checklist: Array.isArray(data.checklist) ? data.checklist : [],
		photos: Array.isArray(data.photos) ? data.photos : [],
		archived: data.archived === true,
		completedAt: isoTime(data.completedAt),
		createdAt: isoTime(data.createdAt),
		createdBy: stringOr(data.createdBy, ""),
		updatedAt: isoTime(data.updatedAt),
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
