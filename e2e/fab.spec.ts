import { expect, test } from "@playwright/test";
import {
	columnSelector,
	gotoAndSettle,
	ROUTES,
	VIEWPORTS,
} from "@/e2e/support/app";
import { deleteNodesByTitlePrefix, fillColumn } from "@/e2e/support/firestore";

/**
 * `#136`'s claim 8: the last card in a full column is clear of the FAB.
 *
 * This lives on its own rather than in `craft.spec.ts` because it is the one
 * craft check that **writes** — the fixture is a household's real board and
 * none of its columns overflows a phone, so the column this claim is about has
 * to be built. That puts it in the `writes` project, where one worker runs the
 * mutating specs one at a time; a dozen filler cards appearing in the backlog
 * column while `board.spec.ts` drags a card out of it is exactly the flake the
 * serial project exists to prevent.
 *
 * It carries its own locale axis for the same reason. The claim is measured at
 * a 195 px window, where the extended FAB's translated label is the thing most
 * likely to wrap and drop its top edge onto the card below — so Swedish is a
 * second measurement here, not a repeat of the English one.
 */

const BOARD = ROUTES[1];

/** The cards this claim makes for itself, and then deletes. */
const FILLER = "E2E fab clearance";

for (const locale of ["en-US", "sv-SE"] as const) {
	test.describe(locale, () => {
		test.use({ locale, viewport: VIEWPORTS.phone });

		test(`8: the last card in a full column is clear of the FAB, in ${locale} and at 200%`, async ({
			page,
		}) => {
			// The fixture is a household's real board and none of its columns overflows a
			// phone, so the column that this claim is about has to be made. Deleted in
			// `finally`, and created inside the `try` so that a batch which throws on its
			// seventh card is swept too: cards left behind would fail every later spec,
			// in every later project, for a different reason than the one that broke.
			try {
				await fillColumn("backlog", 12, FILLER);

				for (const viewport of [VIEWPORTS.phone, VIEWPORTS.phoneZoomed]) {
					await page.setViewportSize(viewport);
					await gotoAndSettle(page, BOARD);

					const measured = await page.evaluate(
						({ selector, fab }) => {
							const column = document.querySelector(selector);
							if (column === null) return { error: `no ${selector}` } as const;

							// The column's own scroller, which is where the bottom padding that
							// holds the last card clear of the FAB is spent.
							const scroller = Array.from(
								column.querySelectorAll<HTMLElement>("*"),
							).find(
								(node) =>
									node.scrollHeight > node.clientHeight + 1 &&
									window.getComputedStyle(node).overflowY !== "visible",
							);
							if (scroller === undefined) {
								return { error: "the column does not scroll" } as const;
							}

							// A user reads the bottom of a column by scrolling to the end of
							// it, and the end is the only place the padding is load-bearing.
							// Scrolling *just enough to see* the last card would park it
							// against the scrollport edge, under the FAB, and prove nothing.
							scroller.scrollTop = scroller.scrollHeight;

							const cards = column.querySelectorAll(
								'[data-testid="card-container"]',
							);
							const last = cards[cards.length - 1];
							const button = document.querySelector(fab);
							if (last === undefined || button === null) {
								return { error: "no last card, or no FAB" } as const;
							}

							return {
								gap:
									button.getBoundingClientRect().top -
									last.getBoundingClientRect().bottom,
							} as const;
						},
						{ selector: columnSelector("backlog"), fab: '[data-testid="fab"]' },
					);

					expect(
						"error" in measured ? measured.error : null,
						"a column full enough to scroll, with a FAB over it",
					).toBeNull();
					// Strictly clear, not merely not-overlapping. A last card whose bottom
					// edge is exactly the FAB's top edge is a card with a button sitting on
					// it as soon as anything rounds the other way — a shadow, a focus ring,
					// a half-pixel of a scroll — and it reads as touching long before that.
					expect(
						"gap" in measured ? measured.gap : 0,
						`gap between the last card and the FAB at ${viewport.width}x${viewport.height}`,
					).toBeGreaterThan(0);
				}
			} finally {
				await deleteNodesByTitlePrefix(FILLER);
			}
		});
	});
}
