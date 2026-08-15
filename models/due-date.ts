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
 * survive 200% text and colour blindness, which colour alone does not.
 *
 * `Intl.RelativeTimeFormat` and `Intl.NumberFormat`'s unit style are both absent
 * from some Hermes builds, so a runtime check decides rather than a platform
 * check — the fallback is the stored date, which is worse but never blank.
 */
export function formatDueElapsed(
	dueDate: string,
	now: Date,
	locale: string,
): string {
	const days = dayDifference(dueDate, now);
	if (days === null) return dueDate;

	if (days < 0) {
		if (typeof Intl.NumberFormat !== "function") return dueDate;
		return new Intl.NumberFormat(locale, {
			style: "unit",
			unit: "day",
			unitDisplay: "short",
		}).format(-days);
	}

	if (typeof Intl.RelativeTimeFormat !== "function") return dueDate;
	return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
		days,
		"day",
	);
}
