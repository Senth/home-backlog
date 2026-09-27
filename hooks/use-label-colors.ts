import { drawCustom } from "@/models/label-color";
import {
	customColorBands,
	type LabelHueName,
	labelHues,
	useAppTheme,
} from "@/theme";

/**
 * The fill and on-color to draw one label dot in, in the scheme in force.
 *
 * A preset hue reads its own pair from the theme — both schemes explicit —
 * and anything else is a custom color, derived at draw time in the scheme's
 * band. `LabelDot`, the picker rows and the details field all draw the
 * same dot, so they all resolve it here.
 */
export function useLabelColors(color: string): { fill: string; on: string } {
	const theme = useAppTheme();
	const scheme = theme.dark ? "dark" : "light";
	const hue = color in labelHues ? labelHues[color as LabelHueName] : undefined;
	return (
		hue?.[scheme] ??
		drawCustom(color, "fill", scheme, customColorBands, theme.colors.background)
	);
}
