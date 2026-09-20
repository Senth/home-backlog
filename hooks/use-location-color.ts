import { clampLabelColor } from "@/models/label-color";
import { type LabelHueName, labelHues, useAppTheme } from "@/theme";

/**
 * The color to draw a location glyph in, in the scheme in force (#205).
 *
 * A location is a bare colored glyph, no fill behind it — not a label dot — so
 * a preset hue resolves to its `ink` tone rather than its fill, and a custom
 * color is clamped by the same `clampLabelColor` the labels use, against the
 * page instead of `boardCard`, since that is what the glyph is drawn on. The
 * sibling of `useLabelColors`, which resolves the same two kinds of stored
 * color for a filled dot.
 */
export function useLocationColor(color: string): string {
	const theme = useAppTheme();
	const scheme = theme.dark ? "dark" : "light";
	const hue = color in labelHues ? labelHues[color as LabelHueName] : undefined;
	return (
		hue?.[scheme].ink ??
		clampLabelColor(color, scheme, theme.colors.background).fill
	);
}
