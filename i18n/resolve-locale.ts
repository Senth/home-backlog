export const locales = ["en-US", "sv-SE"] as const;

export type Locale = (typeof locales)[number];

export const fallbackLocale: Locale = "en-US";

/**
 * Resolve a device locale tag to one of the locales we actually ship.
 *
 * Matching on the full tag is not enough: a device set to `sv` (no region),
 * `sv-FI`, or `en-GB` would match no resource and silently fall back to
 * English — including for the Swedish speakers this app is partly for. Match on
 * the language subtag instead, and treat every other language as English.
 *
 * Kept free of `expo-localization` so it is testable in plain Node.
 */
export function resolveLocale(tag: string | undefined | null): Locale {
	const language = (tag ?? "").split("-")[0]?.toLowerCase();
	return language === "sv" ? "sv-SE" : fallbackLocale;
}
