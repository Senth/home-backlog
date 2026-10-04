import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import type { Intent } from "@/models/outbox";

export type OutboxIntent = Intent & { targetTitle?: string };

const pending = new Map<string, Promise<unknown>>();

export async function withOutboxLock<T>(
	key: string,
	work: () => Promise<T>,
): Promise<T> {
	if (
		Platform.OS === "web" &&
		typeof navigator !== "undefined" &&
		navigator.locks?.request
	)
		return navigator.locks.request(key, work);
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
