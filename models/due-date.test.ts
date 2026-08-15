import {
	dayDifference,
	dueState,
	formatDueElapsed,
	fromCalendarDay,
	soonInDays,
	toCalendarDay,
} from "@/models/due-date";

/**
 * Pinned rather than left to the machine, because the whole point of comparing
 * calendar days is that the answer does not depend on where the reader is — and
 * a test that only proves that in UTC proves nothing. Stockholm is one of the
 * two timezones the app ships strings for, and it observes DST.
 */
const originalTz = process.env.TZ;

beforeAll(() => {
	process.env.TZ = "Europe/Stockholm";
});

afterAll(() => {
	process.env.TZ = originalTz;
});

/** A local instant, whatever offset the pinned zone happens to be on. */
function at(
	year: number,
	month: number,
	day: number,
	hour = 12,
	minute = 0,
): Date {
	return new Date(year, month - 1, day, hour, minute);
}

describe("dayDifference", () => {
	it.each([
		["today", "2026-08-15", 0],
		["yesterday", "2026-08-14", -1],
		["tomorrow", "2026-08-16", 1],
		["exactly a week out", "2026-08-22", 7],
		["a day past a week", "2026-08-23", 8],
		["a month late", "2026-07-16", -30],
	])("is %s", (_label, dueDate, expected) => {
		expect(dayDifference(dueDate, at(2026, 8, 15))).toBe(expected);
	});

	/**
	 * The reason this is not `(due - now) / 24h`. A due date is a *day*, so a
	 * card must not become late at 18:00 and stop being late at 09:00 — which is
	 * exactly what comparing instants does.
	 */
	it("does not change during the day", () => {
		const dueDate = "2026-08-16";

		expect(dayDifference(dueDate, at(2026, 8, 15, 0, 1))).toBe(1);
		expect(dayDifference(dueDate, at(2026, 8, 15, 23, 59))).toBe(1);
	});

	/**
	 * A local day is 23 hours long on the spring-forward Sunday and 25 on the
	 * autumn one, so dividing an instant difference by 24 hours lands a day out.
	 * Reducing both sides to a calendar day first is what removes the question.
	 */
	it("counts a day across a DST change as one day", () => {
		// Europe/Stockholm springs forward on 2026-03-29 and falls back on
		// 2026-10-25, both at local 02:00 — the two nights that are not 24 hours.
		expect(dayDifference("2026-03-29", at(2026, 3, 28))).toBe(1);
		expect(dayDifference("2026-03-30", at(2026, 3, 29))).toBe(1);
		expect(dayDifference("2026-10-25", at(2026, 10, 24))).toBe(1);
		expect(dayDifference("2026-10-26", at(2026, 10, 25))).toBe(1);
	});

	it("counts a week that straddles a DST change as seven days", () => {
		expect(dayDifference("2026-04-01", at(2026, 3, 25))).toBe(7);
		expect(dayDifference("2026-10-28", at(2026, 10, 21))).toBe(7);
	});

	it("counts across a month and a year end", () => {
		expect(dayDifference("2026-09-01", at(2026, 8, 31))).toBe(1);
		expect(dayDifference("2027-01-01", at(2026, 12, 31))).toBe(1);
		// 2028 is a leap year, so February has a 29th to cross.
		expect(dayDifference("2028-03-01", at(2028, 2, 28))).toBe(2);
	});

	it("has no answer for something that is not a calendar day", () => {
		const now = at(2026, 8, 15);

		expect(dayDifference("2026-8-15", now)).toBeNull();
		expect(dayDifference("15/08/2026", now)).toBeNull();
		expect(dayDifference("2026-08-15T00:00:00Z", now)).toBeNull();
		expect(dayDifference("", now)).toBeNull();
	});
});

describe("toCalendarDay", () => {
	it("pads a single-digit month and day", () => {
		expect(toCalendarDay(at(2026, 9, 5))).toBe("2026-09-05");
		expect(toCalendarDay(at(2026, 12, 31))).toBe("2026-12-31");
	});

	/**
	 * The reason this is not `toISOString().slice(0, 10)`. That converts to UTC
	 * first, so a day picked in Stockholm at any time before 02:00 — or at all,
	 * in summer, before 02:00 — comes back as the day before.
	 */
	it("stores the day the reader picked, not the UTC one", () => {
		// Midnight local on the 1st is 22:00 UTC on the 31st, in summer.
		expect(toCalendarDay(at(2026, 8, 1, 0, 30))).toBe("2026-08-01");
		expect(toCalendarDay(at(2026, 8, 1, 23, 30))).toBe("2026-08-01");
	});

	it("round-trips a stored day", () => {
		const stored = "2026-03-29";
		const parsed = fromCalendarDay(stored);

		expect(parsed).not.toBeNull();
		expect(parsed && toCalendarDay(parsed)).toBe(stored);
	});
});

describe("fromCalendarDay", () => {
	it("is local midnight, which is what a date picker takes", () => {
		const parsed = fromCalendarDay("2026-09-30");

		expect(parsed?.getFullYear()).toBe(2026);
		expect(parsed?.getMonth()).toBe(8);
		expect(parsed?.getDate()).toBe(30);
		expect(parsed?.getHours()).toBe(0);
	});

	it("has no answer for something that is not a calendar day", () => {
		expect(fromCalendarDay("2026-09")).toBeNull();
		expect(fromCalendarDay("")).toBeNull();
	});
});

describe("dueState", () => {
	const now = at(2026, 8, 15);

	it.each([
		["yesterday", "2026-08-14", "late"],
		["today", "2026-08-15", "soon"],
		["tomorrow", "2026-08-16", "soon"],
		// The two sides of the one boundary this is worth testing at all for.
		["exactly seven days out", "2026-08-22", "soon"],
		["eight days out", "2026-08-23", "later"],
		["three months out", "2026-11-15", "later"],
	])("reads %s as %s", (_label, dueDate, expected) => {
		expect(dueState(dueDate, now)).toBe(expected);
	});

	it("agrees with the window it is written against", () => {
		const lastSoonDay = "2026-08-22";

		expect(dayDifference(lastSoonDay, now)).toBe(soonInDays);
		expect(dueState(lastSoonDay, now)).toBe("soon");
	});

	it("is nothing at all for a card with no date, or a broken one", () => {
		expect(dueState(null, now)).toBeNull();
		expect(dueState("not a date", now)).toBeNull();
	});
});

describe("formatDueElapsed", () => {
	const now = at(2026, 8, 15);

	/**
	 * A date that has passed lands in "{{elapsed}} late" / "{{elapsed}} sen", so
	 * it needs a *duration* — the string already says which side of the date it
	 * is on, and a relative time there would read "3 days ago late".
	 */
	it("says how long a card has been late, without saying 'ago'", () => {
		expect(formatDueElapsed("2026-08-12", now, "en-US")).toBe("3 days");
		expect(formatDueElapsed("2026-08-12", now, "sv-SE")).toBe("3 d");
	});

	it("speaks the app's language about a date still ahead", () => {
		expect(formatDueElapsed("2026-08-18", now, "en-US")).toBe("in 3 days");
		expect(formatDueElapsed("2026-08-18", now, "sv-SE")).toBe("om 3 dagar");
	});

	it("uses the word rather than the number where there is one", () => {
		expect(formatDueElapsed("2026-08-15", now, "en-US")).toBe("today");
		expect(formatDueElapsed("2026-08-16", now, "en-US")).toBe("tomorrow");
		expect(formatDueElapsed("2026-08-15", now, "sv-SE")).toBe("i dag");
	});

	it("falls back to the stored date rather than to nothing", () => {
		expect(formatDueElapsed("not a date", now, "en-US")).toBe("not a date");
	});
});
