import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
	columnSelector,
	gotoAndSettle,
	ROUTES,
	VIEWPORTS,
} from "@/e2e/support/app";
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
 * Everything here runs in both locales and at both viewports — Swedish words
 * are longer, and above `compactBreakpoint` the board is a different layout
 * rather than a wider one. The colour-scheme axis is narrower on purpose: only
 * the contrast check runs in the dark, because that is the only measurement in
 * this file a palette can change.
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
 * The claims that are *not* a width-independent sweep get a test of their own:
 * the desktop column's own strings below, which are not inside an interactive
 * element and so are invisible to the clipped-label sweep, and the FAB
 * clearance in `fab.spec.ts`, which fills a column and so belongs with the
 * specs that write.
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

/**
 * The scheme axis, and the one check that is about colour.
 *
 * Only the palette changes with the scheme — `theme/tokens.ts` is where every
 * colour lives and nothing in it is a size — so contrast is the only
 * measurement below that can come out differently in the dark. The three
 * geometry checks used to run in both schemes too, which was 15 tests per
 * project asserting the same boxes twice.
 *
 * Dark is tagged so the Swedish projects can drop it: a contrast ratio is the
 * same ratio whatever the words say, so a Swedish dark pass re-measures the
 * English one.
 */
for (const scheme of ["light", "dark"] as const) {
	test.describe(`${scheme} scheme`, { tag: `@${scheme}` }, () => {
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
		}
	});
}

/**
 * Geometry, measured once per project.
 *
 * A box is the same box in the dark, so these take whatever scheme Playwright
 * defaults to. What they do vary over is the two axes that change a box: the
 * locale, because a Swedish word is longer, and the viewport, because above
 * `compactBreakpoint` the board is a different layout rather than a wider one.
 */
for (const route of ROUTES) {
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
			`horizontal overflow on ${route.path}`,
		).toBeLessThanOrEqual(overflow.clientWidth);
	});

	test(`12: ${route.path} has no touch target under ${touchTarget}dp`, async ({
		page,
	}) => {
		await gotoAndSettle(page, route);

		const undersized = await page.evaluate(
			({ selector, minimum }) => {
				const offenders: string[] = [];
				for (const element of Array.from(document.querySelectorAll(selector))) {
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
			`touch targets under ${touchTarget}dp on ${route.path}`,
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
			for (const element of Array.from(document.querySelectorAll(selector))) {
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

		expect(clipped, `clipped control labels on ${route.path}`).toEqual([]);
	});
}

/**
 * The two claims that are not a width-independent sweep.
 *
 * Both are claims about *both locales*, and the Swedish projects run this file
 * and `i18n.spec.ts` and nothing else. Each is pinned to the one width it is
 * about — the desktop column, and a 200% phone — so neither costs a second run
 * of the same measurement in the project at the other width.
 */

const BOARD = ROUTES[1];

/** A card the fixture always has, whose title names the screen you open it as. */
const SEEDED_PROJECT = "Renovera badrummet";

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

test("21: the app bar still shows the screen's name at 200%, in this locale", async ({
	page,
}, testInfo) => {
	// Three 48dp targets and the bar's padding claim ~192px of the row whatever
	// the text size, and `phoneZoomed` is a 195px window — so a single-line bar
	// had three pixels left for the title and the screen lost its name. Below
	// `appBarStackBreakpoint` the title takes a line of its own instead.
	await page.setViewportSize(VIEWPORTS.phoneZoomed);
	await gotoAndSettle(page, BOARD);
	await page.getByText(SEEDED_PROJECT).first().click();
	await page.waitForURL(/\/projects\/[^/]+$/);
	const id = new URL(page.url()).pathname.split("/")[2] as string;

	const titleWidth = async (): Promise<number> =>
		page.evaluate((title) => {
			const inBar = Array.from(document.querySelectorAll("*"))
				.filter((node) => node.textContent === title)
				.map((node) => node.getBoundingClientRect())
				.filter((box) => box.top < 200)
				.map((box) => Math.round(box.width));
			return Math.max(0, ...inBar);
		}, SEEDED_PROJECT);

	await page.getByText(SEEDED_PROJECT).first().waitFor();
	const onBoard = await titleWidth();

	await page.goto(`/projects/${id}/details`);
	await page.getByText(SEEDED_PROJECT).first().waitFor();
	const onDetails = await titleWidth();

	// Room for the name, not merely a non-zero box: an ellipsis on its own is
	// the failure this claim is about.
	const where = `at 200% (${testInfo.project.name})`;
	expect(onBoard, `board app bar title width ${where}`).toBeGreaterThan(120);
	expect(onDetails, `details app bar title width ${where}`).toBeGreaterThan(
		120,
	);
});
