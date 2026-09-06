import { describe, expect, it } from "@jest/globals";
import { gutterMinHeight } from "@/components/board/gutter-height";
import { border, size, space } from "@/theme/tokens";

/**
 * The gutter's arithmetic, pinned to the tokens (#100). Both sides of every
 * assertion are derived from the same tokens, so a token change passes here
 * exactly when `gutterMinHeight` follows it — and a change to the formula's
 * *shape* (a dropped hairline, a lost gap, a hardcoded floor) is what fails.
 */
describe("gutterMinHeight", () => {
	it("is the two paddings alone for an empty gutter", () => {
		expect(gutterMinHeight(0)).toBe(space.sm + space.sm);
	});

	it("is one mark between the paddings", () => {
		expect(gutterMinHeight(1)).toBe(space.sm * 2 + size.labelDot);
	});

	it("adds the hairline and a gap per mark once a separator is drawn", () => {
		expect(gutterMinHeight(2)).toBe(
			space.sm * 2 + 2 * size.labelDot + border.hairline + 2 * space.xs,
		);
	});

	it("is exact for the shape the cap produces: a priority and six labels", () => {
		expect(gutterMinHeight(7)).toBe(
			space.sm * 2 + 7 * size.labelDot + border.hairline + 7 * space.xs,
		);
	});

	it("grows by one mark and one gap per additional label", () => {
		expect(gutterMinHeight(6) - gutterMinHeight(5)).toBe(
			size.labelDot + space.xs,
		);
	});
});
