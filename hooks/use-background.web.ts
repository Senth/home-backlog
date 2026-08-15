import { useEffect, useRef } from "react";

/**
 * The tab being hidden — switched away from, minimised, or the phone locked.
 *
 * `visibilitychange` rather than `AppState` or `beforeunload`. A backgrounded
 * PWA can be discarded by the browser without any further event, and this is the
 * last one that is guaranteed to be delivered; `beforeunload` is not fired at
 * all on mobile Safari and Chrome for Android in that path.
 */
export function useBackgrounded(onBackground: () => void): void {
	const latest = useRef(onBackground);

	useEffect(() => {
		latest.current = onBackground;
	});

	useEffect(() => {
		const hidden = () => {
			if (document.visibilityState === "hidden") latest.current();
		};

		document.addEventListener("visibilitychange", hidden);
		return () => document.removeEventListener("visibilitychange", hidden);
	}, []);
}
