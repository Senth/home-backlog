import type { DocumentData, Query } from "firebase/firestore";
import {
	arrayUnion,
	doc,
	getDoc,
	increment,
	query,
	runTransaction,
	serverTimestamp,
	Timestamp,
	updateDoc,
	where,
} from "firebase/firestore";
import { deleteObject, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "@/config/firebase";
import { nodeRef, nodesRef } from "@/data/nodes";
import {
	attachmentPath,
	attachmentRefusal,
	homeAttachmentCeiling,
	isImageType,
	maxImageEdge,
	thumbnailEdge,
	thumbnailPathFor,
} from "@/models/attachment";
import type { Attachment } from "@/models/node";
import { toNode } from "@/models/node";
import { downscaleImage } from "@/utils/downscale";

/**
 * Every Storage write and the node write that records it (#298).
 *
 * Thin on purpose, like `nodes.ts`: the type and size bound lives in
 * `models/attachment.ts`, the permission in `storage.rules`. The path an
 * object is uploaded to is the exact shape `storage.rules` allows — anything
 * else matches no rule, and would also inflate the home's byte counter with
 * an object nothing can list or clean up.
 *
 * **Storage has no offline queue** — unlike Firestore, an upload does not wait
 * for the shed to find signal, it fails. The caller disables the control
 * offline rather than letting a photo die in a stalled request; a half-working
 * queue is a follow-up of its own.
 */

/** The one reason a refused upload carries, mapped to a sentence by the screen. */
function refused(code: string): Error {
	const error = new Error(`The attachment was refused: ${code}.`);
	(error as { code?: string }).code = code;
	return error;
}

/**
 * One file, in: refused on type and size before anything is sent, then on the
 * home's byte ceiling — read from the home document, the number only the
 * Storage counter writes, so a refusal is a sentence before the rules become
 * a bare `unauthorized`. Images are downscaled and re-encoded (which is what
 * makes an iPhone's HEIC viewable by everyone), the stored object uploaded
 * before its thumbnail — a failure halfway leaves at most a missing preview,
 * never an orphan the counter counts — under an id the client mints, and only
 * then the node entry written with the count bumped, so a card never shows a
 * picture whose bytes are not there yet.
 *
 * Returns the entry as written; the node's own listener delivers it to the
 * screen.
 */
export async function uploadAttachment(
	homeId: string,
	nodeId: string,
	uid: string,
	file: { name: string; contentType: string; size: number; blob: Blob },
): Promise<Attachment> {
	const reason = attachmentRefusal(file.contentType, file.size);
	if (reason !== null) throw refused(reason);

	const home = await getDoc(doc(db, "homes", homeId));
	const bytes = home.get("attachmentBytes");
	if (typeof bytes === "number" && bytes >= homeAttachmentCeiling) {
		throw refused("attachment-quota");
	}

	const id = crypto.randomUUID();
	const path = attachmentPath(homeId, nodeId, id);
	const metadata = { customMetadata: { uploadedBy: uid } };

	let blob = file.blob;
	let contentType = file.contentType;
	const image = isImageType(contentType);
	// Whether the canvas re-encoded it — a decode the browser cannot do leaves
	// the original bytes on the card, and no thumbnail beside them.
	let encoded = false;
	if (image) {
		try {
			blob = await downscaleImage(file.blob, maxImageEdge);
			contentType = "image/jpeg";
			encoded = true;
		} catch (reason) {
			// A desktop browser handed an iPhone's HEIC cannot decode it to
			// re-encode — refusing the upload would lose the photo outright,
			// where keeping the original keeps it for every browser that can.
			if ((reason as { code?: string } | null)?.code !== "image-decode") {
				throw reason;
			}
		}
	}

	const objects: string[] = [path];
	await uploadBytes(ref(storage, path), blob, { ...metadata, contentType });
	if (encoded) {
		const thumbnail = await downscaleImage(file.blob, thumbnailEdge);
		const thumbPath = thumbnailPathFor(path);
		objects.push(thumbPath);
		await uploadBytes(ref(storage, thumbPath), thumbnail, {
			...metadata,
			contentType,
		});
	}

	// `uploadedAt` cannot be a server timestamp inside an array element, so it
	// is the device's clock — it orders a list, it does not vouch for anything.
	const entry: Attachment = {
		id,
		path,
		name: file.name,
		contentType,
		size: blob.size,
		uploadedAt: Timestamp.fromDate(new Date()),
		uploadedBy: uid,
	};
	try {
		await updateDoc(nodeRef(homeId, nodeId), {
			attachments: arrayUnion(entry),
			attachmentCount: increment(1),
			updatedAt: serverTimestamp(),
		});
	} catch (reason) {
		// The bytes landed but the entry did not — a card deleted under the
		// upload, most likely. Left alone they are counted bytes nothing can
		// ever list, which is the orphan the path shape exists to prevent, so
		// the upload puts them back off the counter. Best effort: the original
		// refusal is what the caller hears either way.
		await Promise.allSettled(
			objects.map((objectPath) => deleteObject(ref(storage, objectPath))),
		);
		throw reason;
	}
	return entry;
}

/**
 * One attachment, out: the node entry first — the count and the list are what
 * every other surface reads — then both objects. The entry write is a
 * transaction that recomputes `attachmentCount` from the array it just read,
 * so deleting the same attachment twice, or from two devices, decrements
 * nothing — a counter that had drifted is repaired to the array's truth
 * rather than marched one further from it, and the `attachmentCount > 0`
 * inventory queries cannot lose a card to that drift. A card already gone
 * counts nothing to remove; its bytes still drop, and the not-found is the
 * outcome wanted. Any other Storage failure is rethrown, because an entry
 * removed but bytes left behind is a quota leak the next reader should hear
 * about.
 */
export async function deleteAttachment(
	homeId: string,
	nodeId: string,
	attachment: Attachment,
): Promise<void> {
	await runTransaction(db, async (transaction) => {
		const snapshot = await transaction.get(nodeRef(homeId, nodeId));
		if (!snapshot.exists()) return;
		const node = toNode(snapshot);
		const remaining = node.attachments.filter(
			(entry) => entry.id !== attachment.id,
		);
		if (remaining.length === node.attachments.length) return;
		transaction.update(nodeRef(homeId, nodeId), {
			attachments: remaining,
			attachmentCount: remaining.length,
			updatedAt: serverTimestamp(),
		});
	});

	const drop = (path: string) =>
		deleteObject(ref(storage, path)).catch((reason) => {
			if (
				(reason as { code?: string } | null)?.code !==
				"storage/object-not-found"
			)
				throw reason;
		});

	await drop(attachment.path);
	if (isImageType(attachment.contentType)) {
		await drop(thumbnailPathFor(attachment.path));
	}
}

/*
 * ---------------------------------------------------------------------------
 * The inventory's query pair (#298)
 * ---------------------------------------------------------------------------
 *
 * One question, two listeners, the same shape every board is read with: the
 * read rule's two disjuncts, one query each. `attachmentCount > 0` is the
 * only way to ask for cards that carry attachments — Firestore cannot ask
 * whether an array is non-empty — and it is what keeps a household of a few
 * thousand cards from being read whole to find its handful of attached ones.
 *
 * No `orderBy`: the screen sorts client-side (largest, or newest), which
 * keeps the composite indexes to the two the pair needs. The home's true
 * total is the counter on the home document, which includes the private
 * cards neither query can see — the gap is stated on the screen rather than
 * hidden.
 */

/** Q-1 — every shared card that carries attachments. */
export function sharedInventoryQuery(homeId: string): Query<DocumentData> {
	return query(
		nodesRef(homeId),
		where("attachmentCount", ">", 0),
		where("visibility", "==", "shared"),
	);
}

/** Q-2 — the same, through the read rule's second disjunct. */
export function participatingInventoryQuery(
	homeId: string,
	uid: string,
): Query<DocumentData> {
	return query(
		nodesRef(homeId),
		where("attachmentCount", ">", 0),
		where("participantIds", "array-contains", uid),
	);
}
