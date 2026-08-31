import type { DocumentReference } from "firebase-admin/firestore";
import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import {
	apiClientsCollection,
	db,
	maxBatchWrites,
	runsCollection,
} from "./firestore.js";
import { region } from "./options.js";

/**
 * Revoking a key takes its trace out of every home it wrote into.
 *
 * `homes/{homeId}/apiClients/{keyId}` is what a household can actually see about
 * automations — there are no grants to list, because a key reaches every home
 * its owner is a member of, so "who could write here" is just "every member".
 * What a home wants to know is what **has** written here.
 *
 * A row for a key that no longer exists is worse than no row at all: it tells
 * Ingrid something has access when nothing does, on the one screen she would
 * consult to find out. So the rows go with the key, and they go from every home
 * at once — which is a collection-group query, and the only index this feature
 * adds.
 *
 * The key's **run history** goes too. Deleting a Firestore document does not
 * delete its subcollections, so `apiKeys/{keyId}/runs/*` would outlive the key
 * it belongs to — and the whole reason a bulk create records its
 * `Idempotency-Key` under the key rather than on the node is that revoking the
 * key takes the history with it. A TTL policy would eventually reach them, but
 * that policy is a manual step and "eventually" is not what the rules and the
 * spec promise.
 *
 * Revocation itself is already complete when this runs: the key document is
 * gone, so verification's `get()` misses and every request with that token is a
 * 401. This is bookkeeping catching up, which is why a failure here is logged
 * rather than retried into a loop.
 */
export const onApiKeyDeleted = onDocumentDeleted(
	{ region, document: "users/{uid}/apiKeys/{keyId}" },
	async (event) => {
		const { uid, keyId } = event.params;

		const rows = await db
			.collectionGroup(apiClientsCollection)
			.where("keyId", "==", keyId)
			.get();

		// A Firestore auto-id is not scoped to a user, so filter on the owner as
		// well. It cannot be a second `where` without a composite index for a
		// query that returns one row in practice, and it is free here.
		const mine = rows.docs.filter((row) => row.get("ownerUid") === uid);

		await deleteAll(mine.map((row) => row.ref));

		// The subcollection Firestore leaves behind. `listDocuments()` rather than
		// a query, because it returns the ids that exist under the path without
		// caring what is in them.
		const runs = await event.data?.ref
			.collection(runsCollection)
			.listDocuments();
		await deleteAll(runs ?? []);
	},
);

/** Delete a list of documents, in commits the batch limit can hold. */
async function deleteAll(refs: readonly DocumentReference[]): Promise<void> {
	for (let from = 0; from < refs.length; from += maxBatchWrites) {
		const batch = db.batch();
		for (const ref of refs.slice(from, from + maxBatchWrites)) {
			batch.delete(ref);
		}
		await batch.commit();
	}
}
