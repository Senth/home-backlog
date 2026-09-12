import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Native variant of use-reduced-motion.web.ts, resolved by Metro: the OS
 * setting arrives as an accessibility API, not a media query.
 */
export function useReducedMotion(): boolean {
	const [reduced, setReduced] = useState(false);

	useEffect(() => {
		let live = true;
		AccessibilityInfo.isReduceMotionEnabled().then((value) => {
			if (live) setReduced(value);
		});
		const subscription = AccessibilityInfo.addEventListener(
			"reduceMotionChanged",
			setReduced,
		);
		return () => {
			live = false;
			subscription.remove();
		};
	}, []);

	return reduced;
}
