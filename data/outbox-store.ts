import AsyncStorage from "@react-native-async-storage/async-storage";
import { collection, doc } from "firebase/firestore";
import { Platform } from "react-native";
import { db } from "@/config/firebase";
import type { Intent } from "@/models/outbox";

export type OutboxIntent = Intent & { targetTitle?: string };

export function intentMetadata(
	homeId: string,
	subject: {
		title: string;
		parentId: string | null;
		ancestorIds: readonly string[];
	},
) {
	return {
		id: doc(collection(db, "outbox")).id,
		homeId,
		queuedAt: Date.now(),
		title: subject.title,
		sourceParentId: subject.parentId,
		sourceAncestorIds: [...subject.ancestorIds],
	};
}

const pending = new Map<string, Promise<unknown>>();

export async function withOutboxLock<T>(
	key: string,
	work: () => Promise<T>,
	whenBusy?: () => Promise<T>,
): Promise<T> {
	if (
		Platform.OS === "web" &&
		typeof navigator !== "undefined" &&
		navigator.locks?.request
	) {
		if (whenBusy)
			return navigator.locks.request(key, { ifAvailable: true }, (lock) =>
				lock ? work() : whenBusy(),
			);
		return navigator.locks.request(key, work);
	}
	if (whenBusy && pending.has(key)) return whenBusy();
	const next = (pending.get(key) ?? Promise.resolve()).then(work);
	const settled = next.catch(() => {});
	pending.set(key, settled);
	void settled.then(() => {
		if (pending.get(key) === settled) pending.delete(key);
	});
	return next;
}

export async function readOutbox(uid: string): Promise<OutboxIntent[]> {
	const stored = await AsyncStorage.getItem(`outbox:${uid}`);
	return stored === null ? [] : JSON.parse(stored);
}

export function updateOutbox(
	uid: string,
	change: (intents: OutboxIntent[]) => OutboxIntent[],
): Promise<OutboxIntent[]> {
	return withOutboxLock(`outbox:${uid}:store`, async () => {
		const next = change(await readOutbox(uid));
		await AsyncStorage.setItem(`outbox:${uid}`, JSON.stringify(next));
		return next;
	});
}
