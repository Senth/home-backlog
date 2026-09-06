/**
 * How far away a due date is, in **local calendar days**.
 *
 * `dueDate` is `'YYYY-MM-DD'` and stays so: "clean the gutters by Sep 30" is the
 * same day in every timezone. Deciding whether it is overdue therefore compares
 * days, never instants — an instant comparison makes a card late for six hours
 * in the evening and not late in the morning, in one of the two timezones the
 * app ships strings for.
 *
 * Split from the formatting the way `relative-time.ts` is, so the arithmetic —
 * the part that is wrong at exactly one boundary — is testable without a locale.
 */

const dayInMs = 24 * 60 * 60 * 1000;

/** The same shape `firestore.rules` matches, so neither side is stricter. */
const calendarDay = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Inclusive. A date beyond this is not asking for anything yet. */
export const soonInDays = 7;

/**
 * Days from today until `dueDate` — negative in the past, `0` today — or `null`
 * when the string is not a calendar day at all.
 *
 * Both sides go through `Date.UTC`, which is what makes this DST-proof: a local
 * day is 23 or 25 hours long twice a year, so subtracting two local instants and
 * dividing by 24 hours is off by one across a change. Reducing each date to its
 * year, month and day first and comparing those in UTC removes the question.
 * The difference is an exact multiple of a day, so the division is exact.
 *
 * An impossible day like `2026-02-30` rolls over rather than being refused,
 * which is the same latitude the rules' regex gives it.
 */
export function dayDifference(dueDate: string, now: Date): number | null {
	const parts = calendarDay.exec(dueDate);
	if (parts === null) return null;

	const due = Date.UTC(
		Number(parts[1]),
		Number(parts[2]) - 1,
		Number(parts[3]),
	);
	const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

	return (due - today) / dayInMs;
}

/**
 * A picked day as the string that is stored.
 *
 * The date's **local** components, never `toISOString()`: that converts to UTC
 * first, so a day picked anywhere east of Greenwich in the evening is stored as
 * the day before. A calendar day has no timezone, and this is the seam where one
 * would be introduced.
 */
export function toCalendarDay(date: Date): string {
	const month = `${date.getMonth() + 1}`.padStart(2, "0");
	const day = `${date.getDate()}`.padStart(2, "0");

	return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The stored day as a local `Date`, which is what a date picker takes — midnight
 * in the reader's own zone, for the same reason.
 */
export function fromCalendarDay(dueDate: string): Date | null {
	const parts = calendarDay.exec(dueDate);
	if (parts === null) return null;

	return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
}

/**
 * The stored day written out, for a control that has to show which date is set.
 *
 * `Intl.DateTimeFormat` is what puts the parts in the order the reader expects —
 * "30 September 2026" against "September 30, 2026" — and the guard is the same
 * one the other two formatters carry. The fallback is the stored string, which
 * is already a date a human can read.
 */
export function formatCalendarDay(dueDate: string, locale: string): string {
	const date = fromCalendarDay(dueDate);
	if (date === null) return dueDate;

	try {
		return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(date);
	} catch {
		return dueDate;
	}
}

/**
 * Which of the three things a due date is, or `null` when there is none.
 *
 * Only `'late'` and `'soon'` put a chip on a card face. A date three months out
 * is not asking for anything, and a board where every card carries a date
 * teaches people to stop reading dates.
 */
export type DueState = "late" | "soon" | "later";

export function dueState(dueDate: string | null, now: Date): DueState | null {
	if (dueDate === null) return null;

	const days = dayDifference(dueDate, now);
	if (days === null) return null;
	if (days < 0) return "late";

	return days <= soonInDays ? "soon" : "later";
}

/**
 * The distance as a phrase, in the app's language — what `board.dueLate` and
 * `board.dueSoon` interpolate.
 *
 * Two formatters, because the two states are asking different questions. A date
 * still ahead wants a *relative time*: "today", "tomorrow", "in 3 days". One
 * that has passed wants a *duration*, because the string it lands in already
 * says which side of the date it is on — "3 days late" / "3 d sen". Running the
 * relative formatter there would produce "3 days ago late".
 *
 * Overdue is carried by that word rather than by a red card. Nothing in the app
 * acts on a due date yet — no reminder, no notification — so a red chip would be
 * pure guilt for a deadline nothing will ever remind anyone about, and words
 * survive 200% text and color blindness, which color alone does not.
 *
 * Both formatters are **tried**, not feature-detected. `Intl.RelativeTimeFormat`
 * is missing entirely from some Hermes builds, which a `typeof` check would
 * catch — but `Intl.NumberFormat` can be present and still throw `RangeError`
 * on `style: 'unit'`, and that one lands inside a card's render, so an overdue
 * card would take the whole board down. This runs on the one state the string
 * exists for, so it fails to the stored date rather than to a blank screen.
 */
export function formatDueElapsed(
	dueDate: string,
	now: Date,
	locale: string,
): string {
	const days = dayDifference(dueDate, now);
	if (days === null) return dueDate;

	try {
		if (days < 0) {
			// `narrow`, not `short`. Short is locale-asymmetric here — "14 days" in
			// `en-US` against "14 d" in `sv-SE` — so the same fact came out wordier
			// and wider in one language than the other, on a chip that has to fit a
			// card face beside a title. Narrow is "14d" in both.
			return new Intl.NumberFormat(locale, {
				style: "unit",
				unit: "day",
				unitDisplay: "narrow",
			}).format(-days);
		}

		return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
			days,
			"day",
		);
	} catch {
		return dueDate;
	}
}
