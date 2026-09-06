import { clampLabelColor } from "@/models/label-color";
import { type LabelHueName, labelHues, useAppTheme } from "@/theme";

/**
 * The fill and on-colour to draw one label dot in, in the scheme in force.
 *
 * A preset hue reads its own pair from the theme — both schemes explicit —
 * and anything else is a custom colour, clamped at draw time so a change to
 * `boardCard` or to a floor re-derives it rather than letting the stored value
 * go stale. `LabelDot`, the picker rows and the details field all draw the
 * same dot, so they all resolve it here.
 */
export function useLabelColors(color: string): { fill: string; on: string } {
	const theme = useAppTheme();
	const scheme = theme.dark ? "dark" : "light";
	const hue = color in labelHues ? labelHues[color as LabelHueName] : undefined;
	return (
		hue?.[scheme] ?? clampLabelColor(color, scheme, theme.colors.boardCard)
	);
}
