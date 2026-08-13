/**
 * How long ago something happened, as an amount and a unit.
 *
 * Split from the formatting so the *choice* of unit — the part with edge cases —
 * is testable without a locale. `Intl.RelativeTimeFormat` then turns it into
 * "3 days ago" or "för 3 dagar sedan" without a string of our own per unit.
 */

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const month = 30 * day;
const year = 365 * day;

export interface Elapsed {
	/** Negative — the past, which is the only direction this is used in. */
	value: number;
	unit: Intl.RelativeTimeFormatUnit;
}

export function elapsedSince(from: Date, now: Date): Elapsed {
	// Clamped at zero: a `serverTimestamp()` written by a device whose clock is
	// behind the server's arrives in the future, and "in 2 minutes" on an
	// invitation that was just sent reads as a bug.
	const ms = Math.max(0, now.getTime() - from.getTime());

	if (ms < hour) return { value: -Math.floor(ms / minute), unit: "minute" };
	if (ms < day) return { value: -Math.floor(ms / hour), unit: "hour" };
	if (ms < month) return { value: -Math.floor(ms / day), unit: "day" };
	if (ms < year) return { value: -Math.floor(ms / month), unit: "month" };
	return { value: -Math.floor(ms / year), unit: "year" };
}

/**
 * The same thing as a string, in the app's language.
 *
 * `Intl.RelativeTimeFormat` is absent from some Hermes builds, so a runtime
 * check decides rather than a platform check — the fallback is a plain date,
 * which is worse but never blank.
 */
export function formatElapsed(from: Date, now: Date, locale: string): string {
	const { value, unit } = elapsedSince(from, now);

	if (typeof Intl.RelativeTimeFormat !== "function") {
		return from.toLocaleDateString(locale);
	}

	return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
		value,
		unit,
	);
}
