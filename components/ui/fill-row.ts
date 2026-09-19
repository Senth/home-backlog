import type { TextStyle, ViewStyle } from "react-native";
import { radius, space, touchTarget } from "@/theme/tokens";

/**
 * The selected fill row's paint, defined once and consumed by both
 * `ChoiceField`'s rows and `CheckRow`'s `fill` mode: a full-width
 * `secondaryContainer` fill at `radius.sm` with `space.md` side padding, and
 * the selected row's words in `onSecondaryContainer` at weight 500. Two
 * surfaces reading like the same control must not be able to drift —
 * restyling a copy is a defect, even when it looks identical
 * (docs/DESIGN.md, "Components").
 *
 * The paint is shared; the semantics are not. `ChoiceField` keeps
 * `accessibilityRole="button"` / `aria-pressed`, `CheckRow` keeps
 * `accessibilityRole="checkbox"` / `aria-checked`.
 */

/** The fill row's container: corner, side padding, and the fill when selected. */
export function fillRowContainer(
	selected: boolean,
	fillColor: string,
): ViewStyle {
	return {
		minHeight: touchTarget,
		borderRadius: radius.sm,
		paddingHorizontal: space.md,
		backgroundColor: selected ? fillColor : undefined,
	};
}

/** The selected row's words: `onSecondaryContainer` at weight 500. */
export function fillRowLabel(selectedColor: string): TextStyle {
	return {
		color: selectedColor,
		fontWeight: "500",
	};
}
