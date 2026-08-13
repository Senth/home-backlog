import { elapsedSince, formatElapsed } from "@/models/relative-time";

const now = new Date("2026-08-13T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

const second = 1000;
const minute = 60 * second;
const hour = 60 * minute;
const day = 24 * hour;

describe("elapsedSince", () => {
	it.each([
		["seconds ago", 30 * second, { value: -0, unit: "minute" }],
		["a minute", minute, { value: -1, unit: "minute" }],
		["just under an hour", hour - second, { value: -59, unit: "minute" }],
		["an hour", hour, { value: -1, unit: "hour" }],
		["just under a day", day - second, { value: -23, unit: "hour" }],
		["a day", day, { value: -1, unit: "day" }],
		["a fortnight", 14 * day, { value: -14, unit: "day" }],
		["two months", 61 * day, { value: -2, unit: "month" }],
		["two years", 730 * day, { value: -2, unit: "year" }],
	])("reports %s", (_label, ms, expected) => {
		expect(elapsedSince(ago(ms), now)).toEqual(expected);
	});

	it("never reports the future", () => {
		// A `serverTimestamp()` written by a device whose clock is behind the
		// server's arrives ahead of `now`, and "in 2 minutes" on an invitation
		// that was just sent reads as a bug.
		expect(elapsedSince(new Date(now.getTime() + hour), now)).toEqual({
			value: -0,
			unit: "minute",
		});
	});
});

describe("formatElapsed", () => {
	it("speaks the app's language", () => {
		expect(formatElapsed(ago(3 * day), now, "en-US")).toBe("3 days ago");
		expect(formatElapsed(ago(3 * day), now, "sv-SE")).toBe("för 3 dagar sedan");
	});

	it("uses the word rather than the number where there is one", () => {
		expect(formatElapsed(ago(day), now, "en-US")).toBe("yesterday");
	});
});
