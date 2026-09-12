import { useEffect, useState } from "react";

/**
 * Web variant of use-reduced-motion.ts, resolved by Expo on web:
 * `AccessibilityInfo` cannot read the browser's media query, so read it
 * directly. `false` until mounted, the way use-color-scheme.web.ts reports
 * light until hydration — the statically rendered build has no query to ask.
 */
export function useReducedMotion(): boolean {
	const [reduced, setReduced] = useState(false);

	useEffect(() => {
		const query = window.matchMedia("(prefers-reduced-motion: reduce)");
		setReduced(query.matches);

		const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, []);

	return reduced;
}
