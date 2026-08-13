/**
 * Turning a Firebase `User` into something an app bar can show.
 *
 * The account surfaces read straight from the SDK's in-memory `User` — there is
 * no `users/{uid}` profile document, deliberately (see the spec). That means
 * every field here is optional in practice: a Google account can have no photo,
 * and although it always has an email, the display name is not guaranteed.
 */

/** The parts of a Firebase `User` these helpers need. */
export interface NamedUser {
	displayName?: string | null;
	email?: string | null;
}

/** The local part of an email address, or an empty string. */
function emailLocalPart(email: string | null | undefined): string {
	const at = email?.indexOf("@") ?? -1;
	return at > 0 ? (email as string).slice(0, at) : "";
}

/**
 * What to show wherever the person is named: the Google display name, falling
 * back to the local part of their email, then to the whole address. Never
 * empty for a real account, because Firebase always carries one of the two.
 */
export function displayLabel(user: NamedUser | null | undefined): string {
	const name = user?.displayName?.trim();
	if (name) return name;
	return emailLocalPart(user?.email) || user?.email?.trim() || "";
}

/**
 * One or two letters for the avatar fallback — first and last word of the
 * display name, or a single letter from the email. Splitting on whitespace and
 * taking the ends is what keeps "Anna Maria Berg" as AB rather than AM.
 *
 * Returns "?" when there is nothing at all to work with, so the avatar is never
 * a blank circle.
 */
export function initials(user: NamedUser | null | undefined): string {
	const source = displayLabel(user);
	const words = source.split(/\s+/).filter(Boolean);
	if (words.length === 0) return "?";

	const first = firstLetter(words[0]);
	const last = words.length > 1 ? firstLetter(words[words.length - 1]) : "";
	return (first + last).toUpperCase() || "?";
}

/** First *character*, not first code unit — a name may start outside the BMP. */
function firstLetter(word: string): string {
	return [...word][0] ?? "";
}
