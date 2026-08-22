import { expect, test } from "@playwright/test";
import {
	columnSelector,
	gotoAndSettle,
	ROUTES,
	VIEWPORTS,
} from "@/e2e/support/app";

/**
 * The board's flexed column width, at the two widths that disagree about it.
 *
 * This file **sets its own viewport per test** rather than taking the project's,
 * which is the one place in the suite that is right to do. The claim is that the
 * column divides the board rather than taking a fixed slice of it, and a single
 * width cannot show that: four columns and their five `space.md` gutters split
 * 1366 into 321 each, and 1920 into 460 — which clamps to `boardColumnMax`. Two
 * measurements, and the difference between them, is the claim.
 *
 * 1366 is also the width the flex is *tightest* at, and the one the pass was
 * argued from: a fixed 375 px column pushes Done off a 1366 laptop and turns
 * every cross-column drag into a drag with auto-scroll.
 *
 * Locale plays no part here — a column's width is arithmetic — so this runs in
 * the English projects only, like every spec that is not `craft` or `i18n`.
 */

const BOARD = ROUTES[1];

/** The frozen default column set: To do, Next up, In progress, Done. */
const COLUMNS = ["backlog", "next_up", "execution", "done"] as const;

test("10: four columns fit a 1366px laptop without scrolling, and are wider on a 1920px monitor", async ({
	page,
}) => {
	await page.setViewportSize(VIEWPORTS.laptop);
	const laptop = await measureColumns(page);

	expect(laptop.widths, "column widths at 1366px").toHaveLength(COLUMNS.length);
	// Visible, not merely laid out: a column whose right edge is past the window
	// is a column somebody has to scroll to, which is the failure a fixed-width
	// column shipped with.
	expect(laptop.offScreen, "columns past the right edge at 1366px").toEqual([]);
	// The board's own `ScrollView`, which is where a board with more columns than
	// fit does its scrolling. Four columns must not need it.
	expect(
		laptop.scroller.scrollWidth,
		"the board scrolls sideways at 1366px",
	).toBeLessThanOrEqual(laptop.scroller.clientWidth + 1);

	await page.setViewportSize(VIEWPORTS.desktop);
	const monitor = await measureColumns(page);

	expect(monitor.widths, "column widths at 1920px").toHaveLength(
		COLUMNS.length,
	);
	// The point of the flex: a wide monitor is not a laptop with more empty
	// space beside the same four columns.
	expect(
		Math.min(...monitor.widths),
		`columns were ${laptop.widths.join("/")} at 1366px and ${monitor.widths.join("/")} at 1920px`,
	).toBeGreaterThan(Math.max(...laptop.widths));
});

async function measureColumns(page: import("@playwright/test").Page) {
	await gotoAndSettle(page, BOARD);
	await expect(page.locator(columnSelector(COLUMNS[0]))).toBeVisible();

	return page.evaluate((selectors) => {
		const boxes = selectors.map((selector) => {
			const column = document.querySelector(selector);
			if (column === null) throw new Error(`no column matched ${selector}`);
			return { selector, box: column.getBoundingClientRect() };
		});

		// The horizontal `ScrollView` the columns sit in, found by walking up from
		// one of them rather than by class name, which is generated.
		let scroller = document.querySelector(selectors[0] ?? "")?.parentElement;
		while (
			scroller !== null &&
			scroller !== undefined &&
			window.getComputedStyle(scroller).overflowX === "visible"
		) {
			scroller = scroller.parentElement;
		}
		if (scroller === null || scroller === undefined) {
			throw new Error("the board's horizontal ScrollView was not found");
		}

		return {
			widths: boxes.map(({ box }) => box.width),
			offScreen: boxes
				.filter(
					({ box }) =>
						box.width === 0 || box.left < 0 || box.right > window.innerWidth,
				)
				.map(({ selector }) => selector),
			scroller: {
				scrollWidth: scroller.scrollWidth,
				clientWidth: scroller.clientWidth,
			},
		};
	}, COLUMNS.map(columnSelector));
}
