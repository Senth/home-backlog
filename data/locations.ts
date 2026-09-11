import {
	collection,
	type DocumentData,
	type DocumentReference,
	doc,
	getDocsFromServer,
	type Query,
	type QueryDocumentSnapshot,
	serverTimestamp,
	setDoc,
	updateDoc,
	writeBatch,
} from "firebase/firestore";
import { db } from "@/config/firebase";
import {
	inSubtree,
	type Location,
	type NewLocationInput,
	newLocationData,
	toLocation,
} from "@/models/locations";
import { childAncestorIds, movedAncestorIds } from "@/models/node";

/**
 * Every Firestore read and write that touches a location.
 *
 * Thin, like `data/nodes.ts`: what is valid lives in `models/locations.ts`,
 * what is permitted in `firestore.rules`. What is here is the shape of the
 * query — the read rule is `isMember(homeId)` alone and resource-independent,
 * so the whole-collection query is provably safe: every document it can match
 * is one the caller may read.
 *
 * **Offline.** `createLocation` and `renameLocation` queue optimistically, the
 * acknowledged-promise pattern `createNode` uses — nothing user-facing awaits
 * the promise. `moveLocation` and `deleteLocation` read the subtree from the
 * server first, so offline they fail loudly: the cache holds only the locations
 * that happened to have been opened, and "no children in cache" is not "no
 * children". Locations have no visibility to hide anything, so one
 * whole-collection read is complete as well as safe.
 */

const homesCollection = "homes";
const locationsCollection = "locations";

export function locationRef(
	homeId: string,
	locationId: string,
): DocumentReference<DocumentData> {
	return doc(db, homesCollection, homeId, locationsCollection, locationId);
}

function locationsRef(homeId: string) {
	return collection(db, homesCollection, homeId, locationsCollection);
}

/**
 * The tree screen's one query: the whole collection for the home, sorted
 * client-side. Locations count in tens, so the listener's breadth is bounded
 * by the collection itself, and no composite index is needed.
 */
export function locationsQuery(homeId: string): Query<DocumentData> {
	return locationsRef(homeId);
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

/*
 * ---------------------------------------------------------------------------
 * Writes
 * ---------------------------------------------------------------------------
 */

/**
 * A new location, with its id available immediately.
 *
 * The id is generated on the device rather than by the server, and
 * `acknowledged` resolves when the server has the write — which, in a shed,
 * is when the connection comes back. Nothing user-facing may block on it;
 * the failure is logged here so an ignored rejection is not an unhandled one.
 *
 * It is one `set`, not a batch: locations have no parent counters to keep in
 * step, which is the whole reason the collection carries no `childCount`.
 */
export function createLocation(
	homeId: string,
	uid: string,
	input: NewLocationInput,
): { id: string; acknowledged: Promise<void> } {
	const ref = doc(locationsRef(homeId));
	const written = setDoc(ref, {
		...newLocationData(input),
		createdAt: serverTimestamp(),
		createdBy: uid,
		updatedAt: serverTimestamp(),
	});

	written.catch((reason) => {
		console.error("Could not save the location:", reason);
	});

	return { id: ref.id, acknowledged: written };
}

/**
 * A rename, queued optimistically like any edit.
 *
 * Same acknowledged-promise shape as `createLocation`: the tree row shows the
 * new name from the local cache at once, the promise resolves when the server
 * has it, and a rejection is logged here rather than left unhandled.
 */
export function renameLocation(
	homeId: string,
	locationId: string,
	title: string,
): Promise<void> {
	const written = updateDoc(locationRef(homeId, locationId), {
		title: title.trim(),
		updatedAt: serverTimestamp(),
	});

	written.catch((reason) => {
		console.error("Could not rename the location:", reason);
	});

	return written;
}

/**
 * Every location under `locationId`, read from the server.
 *
 * One `getDocsFromServer` over the tree's own whole-collection query, filtered
 * client-side by `ancestorIds` containing the id — complete, because locations
 * have no visibility to hide anything, and safe for the same
 * resource-independent reason the listener is. From the server, never the
 * cache, for the reason `reparentNode` / `deleteNode` give: offline the cache
 * holds only what happened to have been opened, and "no children in cache" is
 * not "no children". The returned snapshots never include the location itself,
 * which is never in its own `ancestorIds`.
 */
async function subtreeOf(
	homeId: string,
	locationId: string,
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
	const snapshot = await getDocsFromServer(locationsQuery(homeId));
	return snapshot.docs.filter((document) =>
		toLocation(document).ancestorIds.includes(locationId),
	);
}

/**
 * Moving a location somewhere else in the tree, with everything under it.
 *
 * One batch, so the tree is never half-rewritten: the moved document's
 * `parentId` / `ancestorIds` / `rank` and every descendant's `ancestorIds`
 * land together. Descendants keep their own relative path — no descendant's
 * `parentId` changes — so the rewrite is `movedAncestorIds`, the same splice
 * the node reparent runs.
 *
 * Moving a location inside its own subtree throws before any read or write,
 * the same refusal `reparentNode` makes, through the same predicate the
 * destination picker greys rows out with.
 */
export async function moveLocation(
	homeId: string,
	location: Location,
	parent: Location | null,
	rank: string,
): Promise<void> {
	if (parent !== null && inSubtree(parent, location.id)) {
		throw new Error("A location cannot be moved inside its own subtree.");
	}

	const ancestorIds = childAncestorIds(parent);
	const descendants = await subtreeOf(homeId, location.id);

	const batch = writeBatch(db);
	batch.update(locationRef(homeId, location.id), {
		parentId: parent?.id ?? null,
		ancestorIds,
		rank,
		updatedAt: serverTimestamp(),
	});
	for (const snapshot of descendants) {
		batch.update(snapshot.ref, {
			ancestorIds: movedAncestorIds(
				toLocation(snapshot).ancestorIds,
				location.id,
				ancestorIds,
			),
			updatedAt: serverTimestamp(),
		});
	}

	await batch.commit();
}

/**
 * Deleting a location takes its subtree with it, in one batch.
 *
 * Descendants have to go, and they have to go atomically: a location whose
 * parent is gone is unreachable from the tree. There are no counters to
 * repair, on the parent or anywhere else — the one repair a node delete makes
 * has no location equivalent to make.
 */
export async function deleteLocation(
	homeId: string,
	location: Location,
): Promise<void> {
	const descendants = await subtreeOf(homeId, location.id);

	const batch = writeBatch(db);
	for (const snapshot of descendants) batch.delete(snapshot.ref);
	batch.delete(locationRef(homeId, location.id));

	await batch.commit();
}
