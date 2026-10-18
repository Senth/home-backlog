import {
	columnWidth as boardColumnWidth,
	expandedColumnWidth,
} from "@/components/board/column-width";
import {
	compactBreakpoint,
	contentWidth,
	detailsPanelMax,
	detailsPanelMin,
	detailsSplitMin,
	railWidth,
	size,
	space,
} from "@/theme/tokens";

type DesktopLayoutInput = {
	windowWidth: number;
	columnCount: number;
	screen: "board" | "flow";
};

export function desktopLayout({
	windowWidth,
	columnCount,
	screen,
}: DesktopLayoutInput) {
	const nav = windowWidth < compactBreakpoint ? "tabs" : "rail";
	const gutters = space.md * (columnCount + 1);
	const besideMin =
		railWidth + columnCount * size.boardColumnMin + gutters + detailsPanelMin;
	const details =
		nav === "tabs" ? "page" : windowWidth < besideMin ? "overlay" : "beside";
	const panelWidth =
		details === "page"
			? 0
			: details === "overlay"
				? detailsPanelMin
				: Math.max(
						detailsPanelMin,
						Math.min(
							detailsPanelMax,
							windowWidth -
								railWidth -
								gutters -
								columnCount * size.boardColumnMax,
						),
					);
	const columnAreaWidth =
		windowWidth -
		(nav === "rail" ? railWidth : 0) -
		(details === "beside" ? panelWidth : 0);
	const columnWidth =
		details === "beside" || screen === "board"
			? boardColumnWidth(columnAreaWidth, columnCount)
			: expandedColumnWidth(columnAreaWidth, columnCount);

	return {
		nav,
		details,
		panelWidth,
		columnWidth,
		split: panelWidth >= detailsSplitMin,
	};
}

export function detailsContentLayout(width: number) {
	const split = width >= detailsSplitMin;
	const fieldsWidth = detailsSplitMin - contentWidth.form;
	const available = split ? width : Math.min(width, contentWidth.form);
	return {
		split,
		contentWidth: available,
		fieldsWidth,
		cardWidth: available - space.md * 2 - (split ? fieldsWidth + space.lg : 0),
	};
}
