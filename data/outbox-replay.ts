import { getDocFromServer } from "firebase/firestore";
import {
	deleteLocation,
	locationRef,
	moveLocation,
	reorderLocation,
} from "@/data/locations";
import {
	deleteNode,
	flipVisibility,
	nodeRef,
	reparentNode,
} from "@/data/nodes";
import { toLocation } from "@/models/locations";
import { toNode } from "@/models/node";
import type { Intent } from "@/models/outbox";

export async function replayIntent(intent: Intent, uid: string): Promise<void> {
	const { homeId } = intent;
	if ("locationId" in intent) {
		const snapshot = await getDocFromServer(
			locationRef(homeId, intent.locationId),
		);
		if (!snapshot.exists()) return;
		const subject = toLocation(snapshot);
		if (intent.kind === "deleteLocation")
			return deleteLocation(homeId, subject);
		const target =
			intent.parentId === null
				? null
				: await getDocFromServer(locationRef(homeId, intent.parentId));
		if (target && !target.exists())
			throw Object.assign(new Error("The destination no longer exists."), {
				code: "target-gone",
			});
		const parent = target?.exists() ? toLocation(target) : null;
		if (subject.parentId === intent.parentId) {
			if (
				intent.sourceParentId === intent.parentId &&
				subject.rank !== intent.rank
			)
				return reorderLocation(homeId, subject.id, intent.rank);
			return;
		}
		return moveLocation(homeId, subject, parent, intent.rank);
	}
	const snapshot = await getDocFromServer(nodeRef(homeId, intent.nodeId));
	if (!snapshot.exists()) return;
	const subject = toNode(snapshot);
	if (intent.kind === "deleteNode") return deleteNode(homeId, subject, uid);
	if (intent.kind === "flipVisibility")
		return flipVisibility(homeId, subject, intent.target, uid, {
			participantIds: intent.participantIds,
		});
	const target =
		intent.parentId === null
			? null
			: await getDocFromServer(nodeRef(homeId, intent.parentId));
	if (target && !target.exists())
		throw Object.assign(new Error("The destination no longer exists."), {
			code: "target-gone",
		});
	const parent = target?.exists() ? toNode(target) : null;
	if (subject.parentId === intent.parentId) return;
	return reparentNode(homeId, subject, parent, intent.rank, uid);
}
