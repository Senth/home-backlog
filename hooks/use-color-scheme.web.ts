import { useEffect, useState } from "react";
import { useColorScheme as useRNColorScheme } from "react-native";

/**
 * The web build is statically rendered, so the server has no color scheme to
 * read. Report light until the client has hydrated, then switch to the real
 * one — otherwise React tears down the tree over a hydration mismatch.
 */
export function useColorScheme() {
	const [hasHydrated, setHasHydrated] = useState(false);

	useEffect(() => {
		setHasHydrated(true);
	}, []);

	const colorScheme = useRNColorScheme();

	return hasHydrated ? colorScheme : "light";
}
