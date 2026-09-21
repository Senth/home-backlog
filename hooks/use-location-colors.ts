import { clampLabelColor } from "@/models/label-color";
import { type LabelHueName, labelHues, useAppTheme } from "@/theme";

/**
 * The fill and on-color to draw one place's glyph in, in the scheme in force
 * (#205).
 *
 * A location is a bare colored glyph, no fill behind it — not a label dot — so
 * a preset hue resolves to its `ink` tone rather than its fill, with the hue's
 * `fill` tone as the on-color (the check mark a selected swatch draws in, and
 * the only tone that reads against an ink). A custom color is clamped by the
 * same `clampLabelColor` the labels use, against the page instead of
 * `boardCard`, since that is what the glyph is drawn on. The sibling of
 * `useLabelColors`, which resolves the same two kinds of stored color for a
 * filled dot — and, since #328, the resolver behind the location dialog's
 * palette row and icon preview, so both show what the tree will draw.
 */
export function useLocationColors(color: string): { fill: string; on: string } {
	const theme = useAppTheme();
	const scheme = theme.dark ? "dark" : "light";
	const hue = color in labelHues ? labelHues[color as LabelHueName] : undefined;
	if (hue !== undefined) return { fill: hue[scheme].ink, on: hue[scheme].fill };
	return clampLabelColor(color, scheme, theme.colors.background);
}
