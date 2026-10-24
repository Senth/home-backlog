/** @timezone Asia/Kathmandu */

import { act, renderHook } from "@testing-library/react-native";
import { useCalendarDay } from "@/hooks/use-calendar-day";
import { toCalendarDay } from "@/models/due-date";

beforeAll(() => {
	expect(new Date("2026-01-15T12:00:00Z").getTimezoneOffset()).toBe(-345);
	expect(new Date("2026-07-15T12:00:00Z").getTimezoneOffset()).toBe(-345);
});

beforeEach(() => {
	jest.useFakeTimers();
});

afterEach(() => {
	jest.useRealTimers();
});

/** A hook mounted on the frozen fake clock, and the ms to its next midnight. */
async function mounted() {
	const start = new Date();
	const view = await renderHook(() => useCalendarDay());
	const midnight = new Date(
		start.getFullYear(),
		start.getMonth(),
		start.getDate() + 1,
	).getTime();

	return { view, start, untilMidnight: midnight - start.getTime() };
}

describe("useCalendarDay", () => {
	it("turns over exactly once at the next local midnight, and re-arms", async () => {
		const { view, start, untilMidnight } = await mounted();
		expect(view.result.current).toBe(toCalendarDay(start));

		// The last ms of the day is still today.
		await act(() => {
			jest.advanceTimersByTime(untilMidnight - 1);
		});
		expect(view.result.current).toBe(toCalendarDay(start));

		await act(() => {
			jest.advanceTimersByTime(1);
		});
		const firstFire = new Date();
		expect(view.result.current).toBe(toCalendarDay(firstFire));
		expect(view.result.current).not.toBe(toCalendarDay(start));

		// The screen sits through the whole next day without a second fire —
		// midnights are 24h apart in a zone with no DST.
		await act(() => {
			jest.advanceTimersByTime(24 * 60 * 60 * 1000 - 1);
		});
		expect(view.result.current).toBe(toCalendarDay(firstFire));

		// The re-arm lands on the following midnight, exactly once more.
		await act(() => {
			jest.advanceTimersByTime(1);
		});
		expect(view.result.current).toBe(toCalendarDay(new Date()));
		expect(toCalendarDay(new Date())).not.toBe(toCalendarDay(firstFire));
	});

	/**
	 * Kathmandu is +05:45: its midnight is 18:15 UTC the previous day, so a
	 * turnover that waited for 00:00 UTC would still read yesterday 5h15m
	 * later.
	 */
	it("lands on local midnight under a non-hour offset, not on UTC's", async () => {
		jest.setSystemTime(new Date(2026, 7, 1, 23, 30));
		const turnover = await renderHook(() => useCalendarDay());
		expect(turnover.result.current).toBe("2026-08-01");

		await act(() => {
			jest.advanceTimersByTime(30 * 60 * 1000);
		});

		expect(turnover.result.current).toBe("2026-08-02");
	});

	it("leaves no timer running after unmount", async () => {
		const view = await renderHook(() => useCalendarDay());
		jest.runAllTicks();
		expect(jest.getTimerCount()).toBe(1);

		await view.unmount();
		jest.runAllTicks();

		expect(jest.getTimerCount()).toBe(0);
	});
});
