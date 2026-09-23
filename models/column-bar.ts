export type Rung = "labelled" | "icons" | "stacked";

/**
 * The column bar's shape, first that fits: labelled buttons, then icon-only,
 * then stacked, which always fits. The widths arrive measured, so this holds
 * no constant for Paper's chrome or a font.
 */
export function pickRung(
	widths: { labelled: number; icons: number },
	available: number,
): Rung {
	if (available <= 0) return "stacked";
	if (widths.labelled <= available) return "labelled";
	if (widths.icons <= available) return "icons";
	return "stacked";
}
