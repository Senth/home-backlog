import { useEffect, useState } from "react";
import { toCalendarDay } from "@/models/due-date";

/**
 * Today's calendar day, turned over by a timeout to the next local midnight.
 *
 * Nothing in the app re-renders daily on its own, so a screen left open over
 * the night would keep asking yesterday's question — `doneSince(now)` is the
 * one that lies hardest. The arm recomputes midnight from the moment it fires,
 * so a device that slept through more than one of them lands on today at the
 * first fire, and a DST shift moves the next arm with the wall clock.
 */
export function useCalendarDay(): string {
	const [day, setDay] = useState(() => toCalendarDay(new Date()));

	useEffect(() => {
		let timer: ReturnType<typeof setTimeout>;

		const arm = () => {
			const now = new Date();
			const midnight = new Date(
				now.getFullYear(),
				now.getMonth(),
				now.getDate() + 1,
			);
			timer = setTimeout(() => {
				setDay(toCalendarDay(new Date()));
				arm();
			}, midnight.getTime() - now.getTime());
		};
		arm();

		return () => clearTimeout(timer);
	}, []);

	return day;
}
