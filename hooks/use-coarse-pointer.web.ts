import { useEffect, useState } from "react";

function useMediaQuery(media: string): boolean {
	const [matches, setMatches] = useState(false);

	useEffect(() => {
		const query = window.matchMedia(media);
		setMatches(query.matches);
		const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, [media]);

	return matches;
}

export function useCoarsePointer(): boolean {
	return useMediaQuery("(pointer: coarse)");
}

export function useFinePointer(): boolean {
	return useMediaQuery("(hover: hover) and (pointer: fine)");
}
