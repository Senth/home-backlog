/**
 * The label vocabulary, mirrored on the server side.
 *
 * This is a **deliberate second copy** of what `models/label.ts` and
 * `models/label-color.ts` state for the app, for the same reason `node.ts` is
 * one: the API writes with the Admin SDK, which bypasses the rules entirely, so
 * `validLabels()` enforces nothing on this path. No file crosses the package
 * boundary — the cap, the title bound, the twelve hue names and the hex grammar
 * are duplicated bounds, not duplicated code, and the tests are written from the
 * same case list as the app's.
 */

export const maxLabelsPerHome = 300;

export const maxLabelTitleLength = 60;

/**
 * The twelve `labelHues` a label's color may be named by. Anything else that is
 * not a hex color is refused — `models/label-color.ts`'s clamp renders whatever
 * ends up stored, but it cannot turn `"reddish"` into the color somebody chose.
 */
export const labelHueNames = [
	"red",
	"orange",
	"amber",
	"lime",
	"green",
	"teal",
	"cyan",
	"blue",
	"indigo",
	"purple",
	"pink",
	"stone",
] as const;

const HEX_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * A label color: one of the twelve hue names, or `#rgb` / `#rrggbb` — the same
 * grammar `models/label-color.ts`'s `isHexColor` accepts.
 */
export function isLabelColor(color: unknown): color is string {
	if (typeof color !== "string") return false;
	return (
		(labelHueNames as readonly string[]).includes(color) ||
		HEX_PATTERN.test(color.trim())
	);
}

/** A title's comparison key — trim and lowercase, so " Kitchen " equals "kitchen". */
export function normalizedTitle(title: string): string {
	return title.trim().toLowerCase();
}

export interface Label {
	title: string;
	icon: string;
	color: string;
	/** Fractional index, ordered within the home's set. */
	rank: string;
}

/** One row of the labels map — the definition joined back with its key. */
export interface LabelWithId extends Label {
	id: string;
}

/**
 * The home's labels, read defensively — the mirror of `models/label.ts`'s
 * `toLabels()`.
 *
 * The map is a free-form object in Firestore and the rules cannot iterate its
 * values, so a malformed entry is dropped here rather than crashing the route
 * that serializes it. The result is in the home's order: rank, then key, the
 * tie-break a board uses.
 */
export function readLabels(
	data: Record<string, unknown> | null | undefined,
): LabelWithId[] {
	const stored = data?.labels;
	if (stored === null || typeof stored !== "object" || Array.isArray(stored)) {
		return [];
	}

	const labels: LabelWithId[] = [];
	for (const [id, value] of Object.entries(stored as Record<string, unknown>)) {
		const entry = value as Partial<Record<keyof Label, unknown>> | null;
		if (
			typeof entry?.title !== "string" ||
			typeof entry.icon !== "string" ||
			typeof entry.color !== "string" ||
			typeof entry.rank !== "string"
		) {
			continue;
		}
		labels.push({
			id,
			title: entry.title,
			icon: entry.icon,
			color: entry.color,
			rank: entry.rank,
		});
	}

	return labels.sort(
		(a, b) =>
			(a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0) ||
			a.id.localeCompare(b.id),
	);
}
