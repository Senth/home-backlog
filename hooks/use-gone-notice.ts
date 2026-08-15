import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { goneFlag } from "@/components/board/board-href";

/**
 * "That card is gone." — shown by the board somebody was *sent* to, not by the
 * board that disappeared under them.
 *
 * The flag is cleared from the route the moment it is read: the message belongs
 * to the navigation that carried it, and reloading the same URL an hour later
 * must not announce a deletion again.
 */
export function useGoneNotice(): { showing: boolean; dismiss: () => void } {
	const { gone } = useLocalSearchParams<{ gone?: string }>();
	const [showing, setShowing] = useState(false);

	useEffect(() => {
		if (gone !== goneFlag) return;
		setShowing(true);
		router.setParams({ gone: undefined });
	}, [gone]);

	return { showing, dismiss: () => setShowing(false) };
}
