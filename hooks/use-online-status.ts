import { useEffect, useState } from "react";
import { Platform } from "react-native";

/** `navigator.onLine` where it exists; anything else is assumed connected. */
function readOnline(): boolean {
	if (Platform.OS !== "web") return true;
	if (typeof navigator === "undefined") return true;
	if (typeof navigator.onLine !== "boolean") return true;
	return navigator.onLine;
}

/**
 * Whether the browser thinks it has a connection. Only ever used to *tell* the
 * user — Firestore queues its own writes and must not be gated on this.
 */
export function useOnlineStatus(): boolean {
	const [online, setOnline] = useState(readOnline);

	useEffect(() => {
		if (Platform.OS !== "web" || typeof window === "undefined") return;

		const goOnline = () => setOnline(true);
		const goOffline = () => setOnline(false);
		window.addEventListener("online", goOnline);
		window.addEventListener("offline", goOffline);
		// The static export renders without a browser, where the seed is always
		// `true` — re-read once mounted in case we booted offline.
		setOnline(readOnline());

		return () => {
			window.removeEventListener("online", goOnline);
			window.removeEventListener("offline", goOffline);
		};
	}, []);

	return online;
}
