/**
 * A list of names written the way the language writes one — "Marcus, Nadia and
 * Ingrid", "Marcus, Nadia och Ingrid".
 *
 * `Intl.ListFormat` is **tried, not feature-detected**, the same discipline
 * `models/due-date.ts` documents: it is missing entirely from some Hermes
 * builds, which a `typeof` check would catch, but a present implementation can
 * still throw on an unsupported option — and this sentence sits inside a privacy
 * confirmation, where a thrown error would take the dialog down instead of the
 * comma.
 *
 * The fallback is a comma join, which is a list a human can read.
 */
export function formatList(items: readonly string[], locale: string): string {
	if (items.length === 0) return "";
	if (items.length === 1) return items[0] ?? "";

	try {
		return new Intl.ListFormat(locale, {
			style: "long",
			type: "conjunction",
		}).format(items);
	} catch {
		return items.join(", ");
	}
}
