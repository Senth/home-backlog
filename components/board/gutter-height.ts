import { border, size, space } from "@/theme/tokens";

/**
 * The height a card gutter needs for `markCount` marks — the priority dot and
 * the label dots, each `size.labelDot` — derived from the tokens so a full
 * gutter cannot overflow the card by construction (#100).
 *
 * `CardGutter` stacks `space.sm` of padding at each end and `space.xs` of gap
 * between its children. From two marks up, a priority sits beside labels and
 * the hairline separator is drawn too — one more child, one more gap — so the
 * function assumes it there. That makes the floor exact for the shape the cap
 * produces (a priority and six labels) and never under it for any other: the
 * hairline can only add height, so a labels-only card with the same mark
 * count simply gains a few pixels of bottom air.
 */
export function gutterMinHeight(markCount: number): number {
	if (markCount <= 0) return space.sm + space.sm;
	if (markCount === 1) return space.sm + space.sm + size.labelDot;
	return (
		space.sm +
		space.sm +
		markCount * size.labelDot +
		border.hairline +
		markCount * space.xs
	);
}
