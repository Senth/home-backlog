import type { DocumentData, QuerySnapshot } from "firebase/firestore";
import { onSnapshot } from "firebase/firestore";
import { useCallback, useEffect, useState } from "react";
import { isQueryAnswer, subscribeWithRetry } from "@/data/live-query";
import { locationsQuery } from "@/data/locations";
import { isOnline } from "@/hooks/use-online-status";
import {
	compareLocations,
	type Location,
	toLocation,
} from "@/models/locations";

/**
 * The whole location tree for the home, in one listener.
 *
 * One listener over the whole collection, not one per subtree: locations count
 * in tens, the read rule is `isMember(homeId)` alone and resource-independent,
 * so the query is provably safe and its breadth is bounded by the collection
 * itself. The sort happens client-side, `(parentId, rank)` — Firestore's
 * document order is arrival order, and the tree needs siblings together with
 * the roots first.
 *
 * The lifecycle is the homes query's (`HomeContext`): a cache-only empty
 * snapshot is held rather than answered, a failure re-opens the listener
 * rather than reporting it, and `failed` means the retries are spent — the
 * way a cold PWA start reads as "nothing here yet" rather than broken (#101).
 */
export function useLocations(homeId: string | null): {
	locations: Location[];
	loading: boolean;
	failed: boolean;
	retry: () => void;
} {
	const [locations, setLocations] = useState<Location[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);

	// Cleared *during render*, the same way `useNodes` clears a board it is
	// being re-pointed at: an effect runs after the commit, so a different
	// home's locations would be on screen for a frame.
	const [rendered, setRendered] = useState(homeId);
	if (rendered !== homeId) {
		setRendered(homeId);
		setLocations([]);
		setLoaded(false);
		setFailed(false);
		setAttempt(0);
	}

	useEffect(() => {
		if (homeId === null) {
			// No home is an *answer*, not a wait: `/homes` is where the
			// active-home ladder sends you.
			setLocations([]);
			setLoaded(true);
			setFailed(false);
			return;
		}

		setLoaded(false);
		setFailed(false);

		// `includeMetadataChanges` is what makes the cache-only hold in
		// `isQueryAnswer` releasable — same reason, and the same comment, as
		// `HomeContext`.
		return subscribeWithRetry<QuerySnapshot<DocumentData>>(
			(next, error) =>
				onSnapshot(
					locationsQuery(homeId),
					{ includeMetadataChanges: true },
					next,
					error,
				),
			(snapshot) => {
				setLocations(snapshot.docs.map(toLocation).sort(compareLocations));
				setFailed(false);
				setLoaded(true);
			},
			(reason) => {
				console.error(
					`Could not load the locations, attempt ${attempt + 1}:`,
					reason,
				);
				setLocations([]);
				setFailed(true);
				setLoaded(true);
			},
			{ isAnswer: (snapshot) => isQueryAnswer(snapshot, isOnline()) },
		);
	}, [homeId, attempt]);

	const retry = useCallback(() => setAttempt((count) => count + 1), []);

	return {
		locations,
		loading: !loaded,
		failed: loaded && failed,
		retry,
	};
}
