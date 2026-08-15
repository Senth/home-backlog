import { useEffect, useRef } from "react";
import { AppState } from "react-native";

/**
 * The app leaving the foreground — the fourth trigger an autosaving field needs.
 *
 * On native this is `AppState`: a backgrounded app can be killed without blur or
 * unmount ever firing, so this is the last moment anything can be written. The
 * web build has its own version of this file, because `visibilitychange` is the
 * signal a browser actually gives.
 */
export function useBackgrounded(onBackground: () => void): void {
	const latest = useRef(onBackground);

	useEffect(() => {
		latest.current = onBackground;
	});

	useEffect(() => {
		const subscription = AppState.addEventListener("change", (state) => {
			if (state !== "active") latest.current();
		});

		return () => subscription.remove();
	}, []);
}
