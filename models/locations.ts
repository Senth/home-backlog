import type {
	DocumentData,
	QueryDocumentSnapshot,
	Timestamp,
} from "firebase/firestore";
import { childAncestorIds, maxTitleLength } from "@/models/node";

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
 * every field from the first one. `icon` and `color` (#205) joined after the
 * first documents were written, but they are written outright, not
 * present-only: new documents always carry them, and `toLocation` defaults a
 * document that predates them.
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
	/**
	 * An `@expo/vector-icons` MaterialCommunityIcons glyph name — what the place
	 * is recognisable by at a glance.
	 */
	icon: string;
	/**
	 * The color exactly as picked — one of `theme`'s twelve `labelHues` or a
	 * custom hex, the same grammar a label's color has. Never rendered raw:
	 * `hooks/use-location-colors.ts` resolves the ink (or clamps) at draw time.
	 */
	color: string;
	createdAt: Timestamp | null;
	createdBy: string;
	updatedAt: Timestamp | null;
}

/**
 * The icon and color a place carries when nobody chose one (#205). The
 * defaults, not optional fields: a glyph column where one row is blank reads
 * as a bug, so every document is written whole. `stone` is the neutral the
 * twelve hues end on — a default from the middle of the set reads as a
 * choice; the first swatch would read as one nobody made.
 */
export const defaultLocationIcon = "crosshairs-gps";
export const defaultLocationColor = "stone";

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
	/** The glyph and hue the dialog picks; the defaults when omitted (#205). */
	icon?: string;
	color?: string;
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
		icon: input.icon ?? defaultLocationIcon,
		color: input.color ?? defaultLocationColor,
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

/** The children of one place, in no order — the tree sort orders the level. */
export function childLocations(
	locations: readonly Location[],
	parentId: string | null,
): Location[] {
	return locations.filter((location) => location.parentId === parentId);
}

/**
 * The tree sort: by parent, then rank, then id.
 *
 * A location's document order is Firestore's, which is arrival order — the
 * tree screen needs siblings together and in rank order, with the roots
 * first so the tree reads top-down. The id breaks rank ties the way
 * `compareNodes` does: two devices offline can produce the same rank between
 * the same neighbours, and a tie that resolves by arrival order renders
 * differently on every device.
 */
export function compareLocations(a: Location, b: Location): number {
	if (a.parentId !== b.parentId) {
		if (a.parentId === null) return -1;
		if (b.parentId === null) return 1;
		return a.parentId < b.parentId ? -1 : 1;
	}
	if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Why a typed place name cannot be saved, as the key that says so (#205). */
export type LocationTitleError =
	| "locations.titleRequired"
	| "locations.titleTooLong";

/**
 * The one validation a place name has, checked here rather than in the dialog
 * so the rules are not the first thing to say no — the shape `titleError`
 * makes for nodes. Unlike a label's name, a place's need not be unique: two
 * rooms can honestly share one.
 */
export function locationTitleError(title: string): LocationTitleError | null {
	const trimmed = title.trim();
	if (trimmed.length === 0) return "locations.titleRequired";
	if (trimmed.length > maxTitleLength) return "locations.titleTooLong";
	return null;
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
		icon:
			typeof data.icon === "string" && data.icon.length > 0
				? data.icon
				: defaultLocationIcon,
		color:
			typeof data.color === "string" && data.color.length > 0
				? data.color
				: defaultLocationColor,
		createdAt: data.createdAt ?? null,
		createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
		updatedAt: data.updatedAt ?? null,
	};
}
