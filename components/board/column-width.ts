import { size, space } from "@/theme/tokens";

/**
 * How wide each column is above `compactBreakpoint`, given the width the board
 * was measured at and how many columns are on it.
 *
 * The columns divide the board rather than taking a fixed slice of it: a fixed
 * 300 wasted half of a 1920 monitor, and the issue's literal "25% wider" — a
 * fixed 375 — pushes Done off a 1366 laptop and turns every cross-column drag
 * into a drag with auto-scroll.
 *
 * The board's own gutters and the gaps between columns come out first. There
 * are `n + 1` of them at `space.md`: the two outside edges, and `n - 1` between
 * the columns — which is what `Board.tsx`'s horizontal `ScrollView` really
 * lays out, so a wrong count here is a column clipped at the right edge.
 *
 * Clamped at both ends. Below `boardColumnMin` a two-line title stops fitting,
 * so a board with more columns than fit keeps the minimum and scrolls sideways
 * exactly as it always did; above `boardColumnMax` a wider column stops helping
 * and the title becomes one long line the eye loses.
 */
export function columnWidth(boardWidth: number, count: number): number {
	if (count <= 0) return size.boardColumnMin;

	const gutters = space.md * (count + 1);
	const each = (boardWidth - gutters) / count;

	return Math.min(Math.max(each, size.boardColumnMin), size.boardColumnMax);
}
