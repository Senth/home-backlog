import { FieldValue } from "firebase-admin/firestore";
import type { StorageEvent } from "firebase-functions/v2/storage";
import {
	onObjectDeleted as onObjectDeletedTrigger,
	onObjectFinalized as onObjectFinalizedTrigger,
} from "firebase-functions/v2/storage";
import { db, homesCollection } from "./firestore.js";
import { bucket, region } from "./options.js";

/**
 * The per-home attachment byte counters (#298), kept true by the only writer
 * that sees real object metadata: the Storage trigger.
 *
 * `attachmentBytes` on the home document is what `storage.rules` gates the
 * next upload against, and `attachmentBytesByUid` is the per-person breakdown
 * the inventory screen shows. Neither may be written by a client —
 * firestore.rules refuses both, because a quota a client can increment is
 * decoration — so these two handlers are the whole write path: one per object
 * event, moving the counters by the size the platform itself reports.
 *
 * The path is parsed strictly against the shape `storage.rules` allows,
 * `homes/{homeId}/nodes/{nodeId}/{attachmentId}`, and anything else is
 * ignored: with the counters summing by increment rather than by enumeration,
 * a stray object counted once is a lie that never corrects itself.
 *
 * A home deleted between an upload and its finalize event (or between an
 * object and its delete event) has no document to update; the handler answers
 * that with a no-op rather than a throw, because phase 3's cleanup cascade
 * deletes whole prefixes at once and the events arrive unordered.
 */

/** The homeId of an object under `homes/{homeId}/nodes/{nodeId}/{file}`, or `null`. */
export function homeIdOf(objectPath: string | undefined): string | null {
	if (objectPath === undefined) return null;
	const segments = objectPath.split("/");
	if (segments.length !== 5) return null;
	const [homes, homeId, nodes] = segments;
	return homes === "homes" && nodes === "nodes" && homeId.length > 0
		? homeId
		: null;
}

/** The update one object event moves the home's counters by. */
export function counterUpdate(
	delta: number,
	uploadedBy: string | undefined,
): Record<string, unknown> {
	const update: Record<string, unknown> = {
		attachmentBytes: FieldValue.increment(delta),
	};
	if (uploadedBy !== undefined) {
		update[`attachmentBytesByUid.${uploadedBy}`] = FieldValue.increment(delta);
	}
	return update;
}

async function applyBytes(
	homeId: string,
	delta: number,
	uploadedBy: string | undefined,
): Promise<void> {
	const home = db.collection(homesCollection).doc(homeId);
	const snapshot = await home.get();
	if (!snapshot.exists) return;
	await home.update(counterUpdate(delta, uploadedBy));
}

type ObjectEvent = StorageEvent;

export const onObjectFinalized = onObjectFinalizedTrigger(
	{ region, bucket },
	async (event: ObjectEvent) => {
		const homeId = homeIdOf(event.data?.name);
		if (homeId === null) return;
		await applyBytes(
			homeId,
			Number(event.data?.size ?? 0),
			event.data?.metadata?.uploadedBy,
		);
	},
);

export const onObjectDeleted = onObjectDeletedTrigger(
	{ region, bucket },
	async (event: ObjectEvent) => {
		const homeId = homeIdOf(event.data?.name);
		if (homeId === null) return;
		await applyBytes(
			homeId,
			-Number(event.data?.size ?? 0),
			event.data?.metadata?.uploadedBy,
		);
	},
);
