import type {
	DocumentData,
	QueryDocumentSnapshot,
	Timestamp,
} from "firebase/firestore";
import { childAncestorIds } from "@/models/node";

/**
 * One place in the location tree (#50) — the second hierarchy, of rooms,
 * buildings and the garden, that work will be filed under once #51 lands.
 *
 * A location is household furniture: member-only, uniform, with no visibility,
 * participants or archived flag — the grant `recurring` already has. The path
 * invariant is the same one nodes carry and `structure()` in `firestore.rules`
 * checks: a root's `ancestorIds` is empty, a child's ends in its `parentId`,
 * and a location is never its own ancestor. Unlike the node fields, nothing
 * here is present-only — the collection is new, so every document carries
 * every field from the first one.
 */
export interface Location {
	id: string;
	title: string;
	/** `null` is a root place. */
	parentId: string | null;
	/** Root → parent. The last element equals `parentId`. */
	ancestorIds: string[];
	/** Fractional index, ordered among siblings. Manual reorder is #182. */
	rank: string;
	createdAt: Timestamp | null;
	createdBy: string;
	updatedAt: Timestamp | null;
}

/**
 * What a create writes, minus the fields only the server can fill:
 * `createdAt`, `createdBy` and `updatedAt` are `data/locations.ts`'s, because
 * they are `serverTimestamp()` sentinels and the uid of the caller.
 */
export type LocationData = Omit<
	Location,
	"id" | "createdAt" | "createdBy" | "updatedAt"
>;

export interface NewLocationInput {
	title: string;
	/** From `rankAtEnd()`, against the target parent's existing children. */
	rank: string;
	parent?: Location | null;
}

/**
 * A new location, with its path derived rather than passed in.
 *
 * `ancestorIds` is never trusted from a caller — the same rule the REST API
 * follows for nodes — because a caller-supplied path that disagreed with
 * `parentId` is exactly the state `structure()` refuses and a batched write
 * would then land half of. Trimming happens here, so every writer of the field
 * trims, not just the dialog.
 */
export function newLocationData(input: NewLocationInput): LocationData {
	return {
		title: input.title.trim(),
		rank: input.rank,
		parentId: input.parent?.id ?? null,
		ancestorIds: childAncestorIds(input.parent ?? null),
	};
}

/**
 * The location itself and everything under it: what a move may not land
 * inside, and what a delete takes with it. One predicate for both, so the
 * write-time refusal and the destination picker's disabled rows cannot disagree.
 */
export function inSubtree(location: Location, id: string): boolean {
	return location.id === id || location.ancestorIds.includes(id);
}

/**
 * A stored document, read defensively.
 *
 * Every field is written on create, so in practice nothing here is missing —
 * but a document from a seeded fixture or from a version of the app that
 * predates a field still has to render rather than crash the tree screen.
 */
export function toLocation(
	snapshot: QueryDocumentSnapshot<DocumentData>,
): Location {
	const data = snapshot.data();
	return {
		id: snapshot.id,
		title: typeof data.title === "string" ? data.title : "",
		parentId: typeof data.parentId === "string" ? data.parentId : null,
		ancestorIds: Array.isArray(data.ancestorIds)
			? data.ancestorIds.filter((id): id is string => typeof id === "string")
			: [],
		rank: typeof data.rank === "string" ? data.rank : "",
		createdAt: data.createdAt ?? null,
		createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
		updatedAt: data.updatedAt ?? null,
	};
}
