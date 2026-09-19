import { getStorage } from "firebase-admin/storage";
import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { bucket, region } from "./options.js";

/**
 * Nothing outlives the card it belonged to (#298).
 *
 * A Firestore batch cannot contain a Storage delete, so the client's card
 * delete and the objects' deletes can never be one atomic write — and the
 * delete paths that matter do not even go through one component: a project
 * delete cascades a whole subtree, a delete made offline syncs up whenever
 * the device reconnects, and the REST API deletes documents the app never
 * saw. One `onDocumentDeleted` trigger per document is the only point where
 * every one of those paths crosses, so that is where the objects are removed.
 *
 * The prefix covers both objects an attachment owns — the original and the
 * `_thumb.jpg` beside it — because they live under the node they belong to,
 * `homes/{homeId}/nodes/{nodeId}/{attachmentId}`, the shape `storage.rules`
 * allows and nothing else does.
 *
 * The counters are not touched here. Every object deleted fires the
 * `onObjectDeleted` Storage trigger (`on-object-written.ts`), which moves
 * `attachmentBytes` and the uploader's entry by real metadata — one arithmetic
 * home, not two.
 *
 * A node with no attachments lists no files and deletes none: a no-op, not a
 * throw, because the cascade fires this for every node in a deleted project
 * and almost none of them hold anything.
 */

/**
 * Every object under one prefix, gone.
 *
 * Deletions ignore missing objects: a delete racing an upload's own cleanup
 * must not fail the whole trigger. The count answers to tests and logs.
 */
export async function deleteObjectsUnder(prefix: string): Promise<number> {
	const [files] = await getStorage().bucket(bucket).getFiles({ prefix });
	if (files.length === 0) return 0;
	await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })));
	return files.length;
}

export const onNodeDeleted = onDocumentDeleted(
	{ region, document: "homes/{homeId}/nodes/{nodeId}" },
	async (event) => {
		const { homeId, nodeId } = event.params;
		await deleteObjectsUnder(`homes/${homeId}/nodes/${nodeId}/`);
	},
);

export const onHomeDeleted = onDocumentDeleted(
	{ region, document: "homes/{homeId}" },
	async (event) => {
		const { homeId } = event.params;
		await deleteObjectsUnder(`homes/${homeId}/`);
	},
);
