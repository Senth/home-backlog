import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
	columnSelector,
	gotoAndSettle,
	ROUTES,
	VIEWPORTS,
} from "@/e2e/support/app";
import { deleteNodesByTitlePrefix, fillColumn } from "@/e2e/support/firestore";
import enUS from "@/i18n/locales/en-US.json";
import svSE from "@/i18n/locales/sv-SE.json";
import { touchTarget } from "@/theme/tokens";

/**
 * The craft checks that are actually measurements.
 *
 * These used to be a browser agent squinting at a 390 px screenshot and
 * estimating whether a contrast ratio cleared 4.5:1 or a button cleared 48 dp.
 * A model guessing at a number it could compute is the worst of both worlds:
 * it costs tokens on every review and it is less accurate than one line of
 * JavaScript.
 *
 * What is left for `browser-review` after this file is the half that is not a
 * measurement — whether the Swedish reads like a person wrote it, whether an
 * empty state is honest, whether the density overwhelms.
 *
 * Everything here runs in both locales and both colour schemes, and at both
 * viewports — Swedish words are longer, dark mode is a different palette rather
 * than an inversion, and above `compactBreakpoint` the board is a different
 * layout rather than a wider one.
 *
 * The suite used to run at 390 px only, "because that is where a Swedish label
 * runs out of room first". That reasoning is still exactly right for
 * **clipping**: a label that fits at 390 px fits at 1920 px, so the phone width
 * is where the clipped-label check earns its keep. It says nothing at all,
 * though, about the styles that only exist above the breakpoint — the column
 * fill and border, the heading weight and padding, the flexed column width, the
 * smaller card title. None of those is reachable at 390 px, so none of them had
 * a gate until `playwright.config.ts` grew a viewport axis. The checks below are
 * width-independent and simply run again at the wider one; that they need no
 * change to do so is the point.
 *
 * ### Which acceptance claim each check carries
 *
 * The four per-route checks each run in all four projects, so one test is two
 * claims — the same measurement at 390 px and at 1920 px. A test title can only
 * begin with one claim number, so it names the claim that would otherwise have
 * no test at all, and the pairing is written down here instead:
 *
 * | test | at 390 px | at 1920 px |
 * |---|---|---|
 * | no accessibility violations | claim 5 (named) | claim 12, first half |
 * | no touch target under 48 dp | claim 7's backstop | claim 12 (named) |
 * | no clipped control label | the original check | claim 12, second half |
 * | does not scroll horizontally | the original check | claim 13 (named) |
 *
 * The two claims that are *not* a width-independent sweep get a test of their
 * own below: the FAB clearance, which only exists below the breakpoint, and the
 * desktop column's own strings, which are not inside an interactive element and
 * so are invisible to the clipped-label sweep.
 */

/**
 * The axe rules worth failing a build over, plus why the rest are not here.
 *
 * `wcag2aa` carries the contrast rule, which is the one this project cares most
 * about — `colors.warning` and `colors.success` standing in for each other, or a
 * body colour that never got checked. `best-practice` is deliberately excluded:
 * it flags things like "all page content should be landmarks", which is advice
 * for a document, not for an app shell that React Native Web renders as nested
 * divs. Failing on it would train everyone to ignore this spec.
 */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

function axe(page: Parameters<typeof gotoAndSettle>[0]) {
	return new AxeBuilder({ page }).withTags(AXE_TAGS);
}

/**
 * Interactive elements, as the browser sees them.
 *
 * React Native Web renders a Paper button as a `div` with `role="button"`, so
 * a `button` selector alone would miss almost everything this app ships.
 */
const INTERACTIVE =
	'button, [role="button"], [role="link"], [role="tab"], [role="switch"], [role="checkbox"], a[href], input, select, textarea';

for (const scheme of ["light", "dark"] as const) {
	test.describe(`${scheme} scheme`, () => {
		test.use({ colorScheme: scheme });

		for (const route of ROUTES) {
			test(`5: ${route.path} has no accessibility violations`, async ({
				page,
			}) => {
				await gotoAndSettle(page, route);

				const { violations } = await axe(page).analyze();

				// The default message is a wall of JSON; this names the rule and one
				// offending element, which is what actually gets acted on.
				const summary = violations.map(
					(violation) =>
						`${violation.id} (${violation.impact}): ${violation.help} — ${violation.nodes[0]?.target.join(" ")}`,
				);
				expect(summary, `axe violations on ${route.path} (${scheme})`).toEqual(
					[],
				);
			});

			test(`13: ${route.path} does not scroll the document horizontally`, async ({
				page,
			}) => {
				await gotoAndSettle(page, route);

				// A page that scrolls sideways on a phone is the single most common
				// way a fixed width or an un-wrapped row escapes review.
				//
				// At 1920 px it asserts something sharper, because the board
				// deliberately scrolls sideways above the breakpoint: more columns
				// than fit is a scroll, by design. That scroll lives inside a
				// `ScrollView`, which translates its own inner element and never
				// moves `document.documentElement` — so measuring the document is
				// what lets this check tell the intended scroll from the accidental
				// one. What it still fails on is a column that overflows its
				// container and drags the whole document wider than the window.
				const overflow = await page.evaluate(() => ({
					scrollWidth: document.documentElement.scrollWidth,
					clientWidth: document.documentElement.clientWidth,
				}));

				expect(
					overflow.scrollWidth,
					`horizontal overflow on ${route.path} (${scheme})`,
				).toBeLessThanOrEqual(overflow.clientWidth);
			});

			test(`12: ${route.path} has no touch target under ${touchTarget}dp`, async ({
				page,
			}) => {
				await gotoAndSettle(page, route);

				const undersized = await page.evaluate(
					({ selector, minimum }) => {
						const offenders: string[] = [];
						for (const element of Array.from(
							document.querySelectorAll(selector),
						)) {
							const box = element.getBoundingClientRect();
							// Zero-sized elements are not rendered — a collapsed menu, a
							// tab in an inactive stack. They are not touch targets.
							if (box.width === 0 || box.height === 0) continue;
							// An element whose own box is small but which sits inside a
							// larger interactive ancestor is fine: the ancestor is what the
							// thumb hits.
							if (element.parentElement?.closest(selector) !== null) continue;
							if (box.width < minimum || box.height < minimum) {
								const label =
									element.getAttribute("aria-label") ||
									element.textContent?.trim().slice(0, 40) ||
									element.className;
								offenders.push(
									`${Math.round(box.width)}x${Math.round(box.height)} "${label}"`,
								);
							}
						}
						return offenders;
					},
					{ selector: INTERACTIVE, minimum: touchTarget },
				);

				expect(
					undersized,
					`touch targets under ${touchTarget}dp on ${route.path} (${scheme})`,
				).toEqual([]);
			});

			test(`${route.path} has no clipped control label`, async ({ page }) => {
				await gotoAndSettle(page, route);

				// Paper hardcodes `numberOfLines={1}` on button labels, which becomes
				// an ellipsis rather than a wrap. That is how the login button once
				// read "C…" at 200% zoom, and it is the failure Swedish is most
				// likely to reproduce — longer words, same box.
				const clipped = await page.evaluate((selector) => {
					const offenders: string[] = [];
					for (const element of Array.from(
						document.querySelectorAll(selector),
					)) {
						for (const node of Array.from(
							element.querySelectorAll<HTMLElement>("*"),
						)) {
							const style = window.getComputedStyle(node);
							if (style.textOverflow !== "ellipsis") continue;
							if (node.scrollWidth > node.clientWidth + 1) {
								offenders.push(
									`"${node.textContent?.trim().slice(0, 40)}" (${node.scrollWidth}px in ${node.clientWidth}px)`,
								);
							}
						}
					}
					return offenders;
				}, INTERACTIVE);

				expect(
					clipped,
					`clipped control labels on ${route.path} (${scheme})`,
				).toEqual([]);
			});
		}
	});
}

/**
 * The two board claims that are not a width-independent sweep.
 *
 * Both live here rather than in `board.spec.ts` because both are claims about
 * *both locales*, and the Swedish projects run this file and `i18n.spec.ts` and
 * nothing else. Each is pinned to the one width it is about and skips in the
 * projects at the other, so neither costs a second run of the same measurement.
 */

const BOARD = ROUTES[1];

/** The cards the FAB claim makes for itself, and then deletes. */
const FILLER = "E2E fab clearance";

test(`8: the last card in a full column is clear of the FAB, in this locale and at 200%`, async ({
	page,
}) => {
	test.skip(
		page.viewportSize()?.width !== VIEWPORTS.phone.width,
		"there is no FAB above compactBreakpoint — the add control is in the column",
	);

	// The fixture is a household's real board and none of its columns overflows a
	// phone, so the column that this claim is about has to be made. Deleted in
	// `finally`: a failure that leaves twelve cards behind would fail every later
	// spec for a different reason than the one that actually broke.
	await fillColumn("backlog", 12, FILLER);

	try {
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

test("14: the desktop column header, card title and add button are unclipped", async ({
	page,
}, testInfo) => {
	test.skip(
		page.viewportSize()?.width !== VIEWPORTS.desktop.width,
		"none of these exist below compactBreakpoint",
	);

	// The strings the sweep above cannot see. A column heading and a card title
	// are not inside an interactive element, so the clipped-label check never
	// looks at them — and the heading is the string this pass gave more weight
	// and more padding, in the layout that gives it the least room per column.
	const strings = testInfo.project.name.startsWith("sv-SE") ? svSE : enUS;

	await gotoAndSettle(page, BOARD);

	const offenders = await page.evaluate(
		({ columns }) => {
			const bad: string[] = [];
			const overflows = (node: Element) =>
				node.scrollWidth > node.clientWidth + 1 ||
				node.scrollHeight > node.clientHeight + 1;
			// The leaf that holds exactly this string. Its presence proves the whole
			// string is rendered — CSS truncation leaves `textContent` intact — and
			// its box is what says whether the eye can see all of it.
			const leaf = (root: Element, text: string) =>
				Array.from(root.querySelectorAll("*")).find(
					(node) => node.children.length === 0 && node.textContent === text,
				);

			for (const { selector, heading, addTo } of columns) {
				const column = document.querySelector(selector);
				if (column === null) {
					bad.push(`no column ${selector}`);
					continue;
				}

				for (const text of [heading, addTo]) {
					const node = leaf(column, text);
					if (node === undefined) bad.push(`"${text}" is not rendered`);
					else if (overflows(node)) {
						bad.push(
							`"${text}" (${node.scrollWidth}x${node.scrollHeight} in ${node.clientWidth}x${node.clientHeight})`,
						);
					}
				}

				// Whatever card this column happens to hold: the titles are the
				// household's own Swedish, in both locales, and the desktop face
				// renders them a step smaller than the phone one does.
				const card = column.querySelector('[data-testid="card-container"]');
				const title = card?.querySelector("div[dir]");
				if (title !== null && title !== undefined && overflows(title)) {
					bad.push(
						`card title "${title.textContent}" (${title.scrollWidth}px in ${title.clientWidth}px)`,
					);
				}
			}
			return bad;
		},
		{
			columns: (["backlog", "next_up", "execution", "done"] as const).map(
				(status) => ({
					selector: columnSelector(status),
					heading: strings.status[status],
					addTo: strings.board.addTo.replace(
						"{{column}}",
						strings.status[status],
					),
				}),
			),
		},
	);

	expect(
		offenders,
		`clipped desktop strings (${testInfo.project.name})`,
	).toEqual([]);
});
