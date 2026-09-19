import type {
	DocumentReference,
	DocumentSnapshot,
	Query,
	QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import {
	db,
	homesCollection,
	maxBatchWrites,
	nodesCollection,
} from "./firestore.js";
import { movedAncestorIds } from "./node.js";
import { region } from "./options.js";

/**
 * Keeps every anchored node's `locationId` / `locationAncestorIds` true when a
 * *location* moves or is deleted (`homes/{homeId}/locations/{locationId}`).
 *
 * The two fields are denormalized onto nodes at write time and inherited from a
 * node's parent, so they are already correct for every write that happens under
 * a node. What they cannot survive on their own is the location itself moving:
 * a node filed at `Garden › Shed` carries `Garden › Shed` in its path, and when
 * the Shed re-homes under Basement that stored path is a lie. The rewrite needs
 * two queries — `locationId == movedId` for the nodes filed *at* the location,
 * and `array-contains` over `locationAncestorIds` for the nodes filed under it
 * — which from a *client* could match a private node and have the whole query
 * denied, so the only rule-respecting writer is the Admin SDK, here.
 *
 * The branch per event:
 *
 * - **Create** — nothing anchored yet, nothing to maintain.
 * - **Update where `ancestorIds` changed** — a move. A node filed *under* the
 *   moved location gets the prefix up to and including it rewritten
 *   (`movedAncestorIds`), the tail after it kept. A node filed *at* it keeps
 *   its `locationId` and takes the moved location's new `ancestorIds` whole —
 *   the stored crumb is exclusive of the location itself, so that path is
 *   exactly what picking the place fresh would write. A node's own
 *   `locationId` never changes: the Shed is still the Shed, it just sits
 *   elsewhere.
 * - **Update where only `title` (or `rank`) changed** — no-op. A rename must
 *   not pay for a subtree read.
 * - **Delete** — every node anchored to the deleted id is unfiled:
 *   `locationId: null`, `locationAncestorIds: []`. Filed *at* it and filed
 *   under it are the two queries above — a crumb excludes its own location,
 *   so the crumb alone misses the node filed at the location. Unfiled, not
 *   re-homed: re-homing silently moves somebody's work, and a deleted root has
 *   no parent to re-home to.
 *
 * Convergence: a cascade delete fires this once per deleted document, and a
 * move with descendants fires it per rewritten path — each firing is
 * idempotent and they all end in the same place. Offline, a queued location
 * move lands late and the nodes catch up when it does: consistent, not
 * immediate. Only `locationId`, `locationAncestorIds` and `updatedAt` are
 * written, so a node's `createdBy` / `createdVia` app-written mark stays true.
 */
export const onLocationWritten = onDocumentWritten(
	{ region, document: "homes/{homeId}/locations/{locationId}" },
	async (event) => {
		const change = event.data;
		if (!change) return;

		const { homeId } = event.params;
		const movedId = event.params.locationId;
		const nodes = db
			.collection(homesCollection)
			.doc(homeId)
			.collection(nodesCollection);

		if (!change.before.exists) return; // create

		if (!change.after.exists) {
			const anchored = await anchoredNodes(nodes, movedId);
			await writeAll(
				anchored.map((node) => ({
					ref: node.ref,
					data: { ...unfiledNode, updatedAt: FieldValue.serverTimestamp() },
				})),
			);
			return;
		}

		const beforeAncestorIds = ancestorPath(change.before);
		const afterAncestorIds = ancestorPath(change.after);
		if (!pathChanged(beforeAncestorIds, afterAncestorIds)) return; // rename, rank

		const anchored = await anchoredNodes(nodes, movedId);
		await writeAll(
			anchored.flatMap((node) => {
				const update =
					filedUpdate(node.get("locationId"), movedId, afterAncestorIds) ??
					moveUpdate(
						node.get("locationAncestorIds") ?? [],
						movedId,
						afterAncestorIds,
					);
				return update === null
					? []
					: [
							{
								ref: node.ref,
								data: {
									...update,
									updatedAt: FieldValue.serverTimestamp(),
								},
							},
						];
			}),
		);
	},
);

/**
 * Whether a location write changed the path nodes are anchored by.
 *
 * `ancestorIds` is the only field a maintenance-earning write touches; a
 * rename moves the same place to the same place, and so does a rank change.
 */
export function pathChanged(
	before: readonly string[],
	after: readonly string[],
): boolean {
	return (
		before.length !== after.length ||
		before.some((id, index) => id !== after[index])
	);
}

/**
 * The update one node filed *under* the moved location gets, or `null` when
 * the moved id does not appear in its crumb — the state the crumb arm of the
 * query should have already excluded, and a document with no
 * `locationAncestorIds` at all.
 */
export function moveUpdate(
	locationAncestorIds: readonly string[],
	movedId: string,
	newLocationAncestors: readonly string[],
): { locationAncestorIds: string[] } | null {
	if (!locationAncestorIds.includes(movedId)) return null;
	return {
		locationAncestorIds: movedAncestorIds(
			locationAncestorIds,
			movedId,
			newLocationAncestors,
		),
	};
}

/**
 * The update one node filed *at* the moved location gets, or `null` when its
 * place is a different one. The crumb is exclusive of the location itself, so
 * the moved location's new `ancestorIds` is the whole crumb — the state
 * picking that place fresh would write — and the `array-contains` query that
 * finds the nodes under the location structurally never reaches these.
 */
export function filedUpdate(
	locationId: string | null,
	movedId: string,
	newLocationAncestors: readonly string[],
): { locationAncestorIds: string[] } | null {
	return locationId === movedId
		? { locationAncestorIds: [...newLocationAncestors] }
		: null;
}

/** What a node anchored to a deleted location ends up as: unfiled. */
export const unfiledNode: {
	locationId: null;
	locationAncestorIds: string[];
} = {
	locationId: null,
	locationAncestorIds: [],
};

/** The `ancestorIds` of a location snapshot, read defensively. */
function ancestorPath(snapshot: DocumentSnapshot): string[] {
	const ancestorIds = snapshot.data()?.ancestorIds;
	return Array.isArray(ancestorIds)
		? ancestorIds.filter((id): id is string => typeof id === "string")
		: [];
}

/**
 * Every node anchored to the location, from both arms the anchor lives on:
 * filed *at* it (`locationId`) and filed *under* it (its id inside the crumb).
 * Neither arm alone sees the other — a crumb excludes its own location — and
 * a document can only appear in both when a stale crumb still carries the id
 * of the place it is filed at, so the union is deduplicated by id and the
 * filed-at answer wins.
 */
async function anchoredNodes(
	nodes: Query,
	movedId: string,
): Promise<QueryDocumentSnapshot[]> {
	const [direct, under] = await Promise.all([
		nodes.where("locationId", "==", movedId).get(),
		nodes.where("locationAncestorIds", "array-contains", movedId).get(),
	]);
	const byId = new Map(under.docs.map((doc) => [doc.id, doc]));
	for (const doc of direct.docs) byId.set(doc.id, doc);
	return [...byId.values()];
}

/** Apply a list of node updates, in commits the batch limit can hold. */
async function writeAll(
	updates: readonly { ref: DocumentReference; data: object }[],
): Promise<void> {
	for (let from = 0; from < updates.length; from += maxBatchWrites) {
		const batch = db.batch();
		for (const { ref, data } of updates.slice(from, from + maxBatchWrites)) {
			batch.update(ref, data);
		}
		await batch.commit();
	}
}
