import { useEffect, useState } from "react";
import { Platform } from "react-native";

/**
 * `navigator.onLine` where it exists; anything else is assumed connected.
 *
 * Exported as well as hooked because it is read *inside* a Firestore snapshot
 * handler, where a value captured when the listener was opened would be stale
 * by exactly the transition that matters — see `isQueryAnswer`.
 */
export function isOnline(): boolean {
	if (Platform.OS !== "web") return true;
	if (typeof navigator === "undefined") return true;
	if (typeof navigator.onLine !== "boolean") return true;
	return navigator.onLine;
}

/**
 * Whether the browser thinks it has a connection.
 *
 * Only ever used to *tell* the user, and to decide how long to wait before
 * telling them. **No write is ever gated on it** — Firestore queues its own and
 * would lose them.
 */
export function useOnlineStatus(): boolean {
	const [online, setOnline] = useState(isOnline);

	useEffect(() => {
		if (Platform.OS !== "web" || typeof window === "undefined") return;

		const goOnline = () => setOnline(true);
		const goOffline = () => setOnline(false);
		window.addEventListener("online", goOnline);
		window.addEventListener("offline", goOffline);
		// The static export renders without a browser, where the seed is always
		// `true` — re-read once mounted in case we booted offline.
		setOnline(isOnline());

		return () => {
			window.removeEventListener("online", goOnline);
			window.removeEventListener("offline", goOffline);
		};
	}, []);

	return online;
}
