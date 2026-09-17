import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import {
	type BoardFilter,
	boardFilterKey,
	decodeBoardFilter,
	encodeBoardFilter,
} from "@/models/board-filter";

/**
 * The board's filter, remembered per home across launches (#62) and expired
 * by sliding 24 hours after the last time the app opened a board.
 *
 * Mounting this hook **is** a board open: every mount reads the home's one
 * key and, when a filter is still fresh, writes it back stamped with now —
 * the touch that keeps a filter alive while the household keeps using the
 * app, and lets it quietly die a day after the last visit. With no filter
 * there is nothing to slide, so an ordinary open writes nothing.
 *
 * The decode is the model's (`decodeBoardFilter`), so a blob this version
 * cannot read is no filter rather than a crash, and an expired or unreadable
 * blob is removed on the way past — gone is gone, not resurrected by its own
 * expiry being re-read.
 */
export function useBoardFilter(homeId: string | null): {
	/** The home's filter, or `null` when there is none or it is not read yet. */
	filter: BoardFilter | null;
	/** True until the stored filter has been read or found absent. */
	loading: boolean;
	/** Sets the filter, or clears it entirely with `null`. */
	setFilter: (filter: BoardFilter | null) => void;
} {
	const [filter, setFilterState] = useState<BoardFilter | null>(null);
	const [loading, setLoading] = useState(true);

	// Cleared *during render*, the same way `HomeContext` re-points on a uid
	// change: an effect runs after the commit, so switching homes would show
	// the old home's filter on the new home's board for a frame.
	const [renderedHomeId, setRenderedHomeId] = useState(homeId);
	if (renderedHomeId !== homeId) {
		setRenderedHomeId(homeId);
		setFilterState(null);
		setLoading(true);
	}

	useEffect(() => {
		if (homeId === null) {
			setLoading(false);
			return;
		}
		let live = true;
		const key = boardFilterKey(homeId);

		AsyncStorage.getItem(key)
			.catch((reason) => {
				// Handled: a device that cannot remember the filter still works,
				// it just shows everything until the filter is set again.
				console.warn("Could not read the board filter:", reason);
				return null;
			})
			.then((raw) => {
				if (!live) return;
				const now = Date.now();
				const decoded = decodeBoardFilter(raw, new Date(now));
				if (decoded !== null) {
					setFilterState(decoded);
					// The slide: this mount is a board open, so the expiry moves
					// out from now — written even when the filter never changes.
					AsyncStorage.setItem(key, encodeBoardFilter(decoded, now)).catch(
						(reason) => {
							// Handled: the filter still works this session; only this
							// open's slide of the expiry is lost.
							console.warn("Could not touch the board filter:", reason);
						},
					);
				} else if (raw !== null) {
					AsyncStorage.removeItem(key).catch((reason) => {
						// Handled: a blob that cannot be shown should not linger to
						// be half-understood by a later version either.
						console.warn("Could not drop the expired board filter:", reason);
					});
				}
				setLoading(false);
			});

		return () => {
			live = false;
		};
	}, [homeId]);

	const setFilter = useCallback(
		(next: BoardFilter | null) => {
			setFilterState(next);
			if (homeId === null) return;
			const key = boardFilterKey(homeId);
			const write =
				next === null
					? AsyncStorage.removeItem(key)
					: AsyncStorage.setItem(key, encodeBoardFilter(next, Date.now()));
			write.catch((reason) => {
				// Handled: the filter has already changed in memory; only the
				// memory of it across launches is lost.
				console.warn("Could not save the board filter:", reason);
			});
		},
		[homeId],
	);

	return { filter, loading, setFilter };
}
