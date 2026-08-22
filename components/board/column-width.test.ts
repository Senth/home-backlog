import { columnWidth } from "@/components/board/column-width";
import { size, space } from "@/theme/tokens";

describe("columnWidth", () => {
	it("divides the board between its columns, gutters and gaps first", () => {
		// 1366 - 5×16 = 1286 across four columns.
		expect(columnWidth(1366, 4)).toBeCloseTo((1366 - space.md * 5) / 4);
	});

	it("leaves room for every gap, so the last column is not clipped", () => {
		const width = columnWidth(1366, 4);
		expect(width * 4 + space.md * 5).toBeLessThanOrEqual(1366);
	});

	it("is wider on a wider board", () => {
		expect(columnWidth(1920, 4)).toBeGreaterThan(columnWidth(1366, 4));
	});

	it("stops widening at the maximum, so a monitor is not one long line", () => {
		expect(columnWidth(3840, 4)).toBe(size.boardColumnMax);
	});

	it("falls back to the minimum when more columns than fit are shown", () => {
		// Eight columns on a laptop: the board scrolls sideways instead.
		expect(columnWidth(1366, 8)).toBe(size.boardColumnMin);
	});

	it("never goes under the minimum, however narrow the board", () => {
		expect(columnWidth(320, 4)).toBe(size.boardColumnMin);
	});

	it("holds the minimum for a board that has not been measured yet", () => {
		expect(columnWidth(0, 0)).toBe(size.boardColumnMin);
	});
});
