import type {
	DocumentReference,
	DocumentSnapshot,
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
 * an `array-contains` query over `locationAncestorIds`, which from a *client*
 * could match a private node and have the whole query denied — so the only
 * rule-respecting writer is the Admin SDK, here.
 *
 * The branch per event:
 *
 * - **Create** — nothing anchored yet, nothing to maintain.
 * - **Update where `ancestorIds` changed** — a move. Every node whose path
 *   contains the moved id gets the prefix up to and including it rewritten
 *   (`movedAncestorIds`), the tail after it kept. A node's own `locationId`
 *   never changes: the Shed is still the Shed, it just sits elsewhere.
 * - **Update where only `title` (or `rank`) changed** — no-op. A rename must
 *   not pay for a subtree read.
 * - **Delete** — every node whose path contains the deleted id is unfiled:
 *   `locationId: null`, `locationAncestorIds: []`. A node's own location is
 *   the last element of its path, so one `array-contains` catches both nodes
 *   filed *at* the location and nodes filed anywhere under it. Unfiled, not
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
			const anchored = await nodes
				.where("locationAncestorIds", "array-contains", movedId)
				.get();
			await writeAll(
				anchored.docs.map((node) => ({
					ref: node.ref,
					data: { ...unfiledNode, updatedAt: FieldValue.serverTimestamp() },
				})),
			);
			return;
		}

		const beforeAncestorIds = ancestorPath(change.before);
		const afterAncestorIds = ancestorPath(change.after);
		if (!pathChanged(beforeAncestorIds, afterAncestorIds)) return; // rename, rank

		const anchored = await nodes
			.where("locationAncestorIds", "array-contains", movedId)
			.get();
		await writeAll(
			anchored.docs.flatMap((node) => {
				const update = moveUpdate(
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
 * The update one anchored node gets when its location moves, or `null` when
 * the moved location does not appear in its path — the state the
 * `array-contains` query should have already excluded, and a document with no
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
