import {
	arrayRemove,
	arrayUnion,
	increment,
	serverTimestamp,
	Timestamp,
	updateDoc,
} from "firebase/firestore";
import { deleteObject, ref, uploadBytes } from "firebase/storage";
import { storage } from "@/config/firebase";
import { nodeRef } from "@/data/nodes";
import {
	attachmentPath,
	attachmentRefusal,
	isImageType,
	maxImageEdge,
	thumbnailEdge,
	thumbnailPathFor,
} from "@/models/attachment";
import type { Attachment } from "@/models/node";
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
 * One file, in: refused on type and size before anything is sent, images
 * downscaled and re-encoded (which is what makes an iPhone's HEIC viewable by
 * everyone), the stored object uploaded before its thumbnail — a failure
 * halfway leaves at most a missing preview, never an orphan the counter counts
 * — under an id the client mints, and only then the node entry written with
 * the count bumped, so a card never shows a picture whose bytes are not there
 * yet.
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

	const id = crypto.randomUUID();
	const path = attachmentPath(homeId, nodeId, id);
	const metadata = { customMetadata: { uploadedBy: uid } };

	let blob = file.blob;
	let contentType = file.contentType;
	const image = isImageType(contentType);
	if (image) {
		blob = await downscaleImage(file.blob, maxImageEdge);
		contentType = "image/jpeg";
	}

	await uploadBytes(ref(storage, path), blob, { ...metadata, contentType });
	if (image) {
		const thumbnail = await downscaleImage(file.blob, thumbnailEdge);
		await uploadBytes(ref(storage, thumbnailPathFor(path)), thumbnail, {
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
	await updateDoc(nodeRef(homeId, nodeId), {
		attachments: arrayUnion(entry),
		attachmentCount: increment(1),
		updatedAt: serverTimestamp(),
	});
	return entry;
}

/**
 * One attachment, out: the node entry first — the count and the list are what
 * every other surface reads — then both objects. An object already gone (the
 * card was deleted mid-flight, or this is a retry) is not an error; the
 * not-found is the outcome it wanted. Any other Storage failure is rethrown,
 * because an entry removed but bytes left behind is a quota leak the next
 * reader should hear about.
 */
export async function deleteAttachment(
	homeId: string,
	nodeId: string,
	attachment: Attachment,
): Promise<void> {
	await updateDoc(nodeRef(homeId, nodeId), {
		attachments: arrayRemove(attachment),
		attachmentCount: increment(-1),
		updatedAt: serverTimestamp(),
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
