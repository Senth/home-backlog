import { scrollbar } from "@/theme/tokens";

type Size = { width: number; height: number };

export type ScrollMetrics = {
	contentSize: Size;
	layoutMeasurement: Size;
	contentOffset: { x: number; y: number };
};

export type ScrollAxis = "vertical" | "horizontal";

export type ScrollThumb = {
	thumb: { length: number; offset: number } | null;
	fade: { start: boolean; end: boolean };
};

const tolerance = 1;

/** Where the overlay thumb sits along the scroller's length, and which edges have content beyond them. */
export function scrollThumb(
	{ contentSize, layoutMeasurement, contentOffset }: ScrollMetrics,
	axis: ScrollAxis,
): ScrollThumb {
	const key = axis === "vertical" ? "height" : "width";
	const content = contentSize[key];
	const visible = layoutMeasurement[key];
	const offset = contentOffset[axis === "vertical" ? "y" : "x"];
	const range = content - visible;
	const fade = {
		start: offset > tolerance,
		end: range - offset > tolerance,
	};
	if (range <= tolerance) {
		return { thumb: null, fade: { start: false, end: false } };
	}
	const length = Math.min(
		visible,
		Math.max(scrollbar.minLength, (visible * visible) / content),
	);
	const progress = Math.min(1, Math.max(0, offset / range));
	return { thumb: { length, offset: progress * (visible - length) }, fade };
}
