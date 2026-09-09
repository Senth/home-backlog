import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
	columnSelector,
	gotoAndSettle,
	ROUTES,
	type Route,
	stripDevToast,
	VIEWPORTS,
} from "@/e2e/support/app";
import { PALETTE, type Scheme } from "@/e2e/support/theme";
import enUS from "@/i18n/locales/en-US.json";
import svSE from "@/i18n/locales/sv-SE.json";
import {
	appBarStackBreakpoint,
	border,
	compactBreakpoint,
	contentWidth,
	denseBreakpoint,
	drag,
	elevation,
	fab,
	focusRing,
	icon,
	markTargetMinimum,
	outlinedTouchTarget,
	radius,
	segmentedLabelLineHeight,
	size,
	space,
	touchTarget,
	touchTargetStyle,
} from "@/theme/tokens";

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
 * rather than a wider one. The color-scheme axis is narrower on purpose: only
 * the palette sweep runs in the dark, because that is the only measurement in
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
 * Claims 24–29 join the same split. The off-scale spacing and near-miss
 * alignment sweeps are geometry and run once per route in the loop below;
 * the palette sweep is the one other measurement a scheme changes, so it
 * sits in the scheme loop beside the axe pass — light in all four projects,
 * dark in the two English ones the `@dark` tag keeps. Claims 28 and 29 name
 * their one subject each: `/login` unauthenticated, and a node's `/details`
 * reached by clicking through from the board. Claim 27 — a 3:1 floor on the
 * FAB's fill against the page — was withdrawn as a `[test]` before it ever
 * passed: measured at 1.31:1 light and 2.18:1 dark, the floor turned out to
 * be a threshold this contract invented rather than one MD3 imposes, and
 * `primaryContainer` on `surface` is MD3's own FAB pairing. The findability
 * it was reaching for is claim 33, judged by eye in both schemes.
 *
 * All four measurement sweeps are written natively against
 * `theme/tokens.ts` and `theme/index.ts` (via `e2e/support/theme.ts`,
 * because `theme/index.ts` imports react-native-paper, whose react-native
 * entry is Flow that Node cannot parse). They were written before the app
 * was fixed, on purpose: a failure here is the finding phase 3 acts on, so
 * the sweeps carry no allowance that the spec does not spell out.
 *
 * The claims that are *not* a width-independent sweep get a test of their own:
 * the desktop column's own strings below, which are not inside an interactive
 * element and so are invisible to the clipped-label sweep, and the FAB's width
 * share at 200% text. The FAB clearance claim was dropped with #201, together
 * with the spec that made it.
 */

/**
 * The axe rules worth failing a build over, plus why the rest are not here.
 *
 * `wcag2aa` carries the contrast rule, which is the one this project cares most
 * about — `colors.warning` and `colors.success` standing in for each other, or a
 * body color that never got checked. `best-practice` is deliberately excluded:
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
 * Every number `theme/tokens.ts` exports — the first carve-out of the
 * off-scale spacing rule: a computed `padding*`, `margin*` or `*Gap` that is
 * a token value is on-scale even when it is not a step of `space`.
 */
const TOKEN_NUMBERS: number[] = [
	space,
	radius,
	elevation,
	contentWidth,
	size,
	drag,
	icon,
	border,
	focusRing,
	touchTargetStyle,
]
	.flatMap((group) => Object.values(group as Record<string, number>))
	.concat([
		touchTarget,
		outlinedTouchTarget,
		segmentedLabelLineHeight,
		markTargetMinimum,
		compactBreakpoint,
		appBarStackBreakpoint,
		denseBreakpoint,
	]);

/** The spacing check's whole allowance: the `space` steps plus the tokens. */
const ON_SCALE: number[] = [
	...new Set([...Object.values(space), ...TOKEN_NUMBERS]),
];

/**
 * The closed table of react-native-paper internals — the second carve-out of
 * the off-scale spacing rule, and the only one that names an element. Every
 * entry names a third-party internal, how it is matched in the DOM, and the
 * Paper component that owns it; an entry naming one of our own screens is
 * the baseline this spec forbids, and review rejects it on sight. Adding an
 * entry when Paper grows a control is one line; adding one to make our own
 * change pass is not.
 *
 * Two entries match by signature instead of a testID, because the component
 * ships none:
 *
 * - `List.Subheader`'s padding is the only 13px vertical padding on a leaf
 *   text div at bodyMedium's 14px. A signature is a hole, not a selector: an
 *   app-authored 13px on a 14px text leaf would pass under it, and only an
 *   eye on the screens will catch that.
 * - `List.Item`'s row margin sits on a div whose child is Paper's own
 *   `<testID>-content` box — `undefined-content` here, since the app passes
 *   no testID — and `:has(>` reaches the row through that child. Pairing the
 *   selector with the exact 6px value keeps the match from reaching anything
 *   else that happens to carry a `-content` child.
 */
const PAPER_INTERNALS: {
	value: number;
	css: string | null;
	owner: string;
}[] = [
	{
		value: 5,
		css: 'a[role="tab"]',
		owner: "BottomNavigation's tab item padding",
	},
	{
		value: 6,
		css: '[data-testid="icon-button-container"], [data-testid="chip-container"]',
		owner: "IconButton's container margin, and the Chip's own",
	},
	{
		value: 6,
		css: 'div:has(> [data-testid$="-content"])',
		owner: "List.Item's row margin",
	},
	{ value: 13, css: null, owner: "List.Subheader's vertical padding" },
	{
		value: 12,
		css: '[data-testid="appbar-content"]',
		owner: "Appbar.Content's left margin",
	},
	{
		value: 10,
		css: '[data-testid="button-text"]',
		owner: "Button's label margin",
	},
	{
		value: 9,
		css: '[data-testid="button-text"]',
		owner: "Button's label margin in text+icon mode",
	},
	{
		value: 14,
		css: '[data-testid="text-input-outlined"]',
		owner: "TextInput's outlined input padding",
	},
];

/**
 * Paper's FAB testIDs: the fill lives on `fab-container` — the inner
 * touchable, `fab`, paints nothing — so both the width share and the
 * measured-height carve-out read the container.
 */
const FAB_SELECTOR = '[data-testid="fab-container"]';

/**
 * The off-scale spacing sweep (claim 24). Every computed `padding*`,
 * `margin*` and `*Gap` must be a step in `space` by absolute value, a token
 * value, a named Paper internal, or the one value the spec's "derived at
 * runtime from a measured element" carve-out covers: the board's pane inset,
 * `measuredFABHeight + space.md * 2` (`Board.tsx`'s `fabBottom = space.md`
 * plus one `space.md` of daylight), which the caller folds into `allowed`.
 */
function spacingSweep(args: {
	allowed: number[];
	paper: { value: number; css: string | null }[];
}): string[] {
	const onScale = new Set(args.allowed);
	const offenders = new Set<string>();
	const describe = (element: Element): string => {
		const testID = element.getAttribute("data-testid");
		const text = (element.textContent ?? "").trim().slice(0, 30);
		return `<${element.tagName.toLowerCase()}${testID ? ` data-testid=${testID}` : ""}${text ? ` "${text}"` : ""}>`;
	};
	const paperExcuse = (element: Element, value: number): boolean =>
		args.paper.some((entry) => {
			if (entry.value !== value) return false;
			if (entry.css !== null) return element.closest(entry.css) !== null;
			return (
				element.children.length === 0 &&
				window.getComputedStyle(element).fontSize === "14px" &&
				(element.textContent ?? "").trim() !== ""
			);
		});

	for (const element of Array.from(document.querySelectorAll("*"))) {
		const style = window.getComputedStyle(element);
		// Read as properties, not `getPropertyValue("paddingTop")`: the camel-
		// case spelling returns "" from Chrome's computed style, and a sweep
		// over empty strings passes vacuously.
		for (const prop of [
			"paddingTop",
			"paddingRight",
			"paddingBottom",
			"paddingLeft",
			"marginTop",
			"marginRight",
			"marginBottom",
			"marginLeft",
			"rowGap",
			"columnGap",
		] as const) {
			const raw = style[prop];
			// `normal` on unset gaps, `auto` on margins: neither is a length.
			if (!raw.endsWith("px")) continue;
			// A resolved `auto` margin reports used pixels here, not the word —
			// the card's right gutter pins its foot with `marginTop: "auto"`, and
			// whatever the flexbox algorithm answered is a function of the card's
			// height, not a spacing decision. The inline style still says `auto`,
			// and that is what it is.
			if (
				prop.startsWith("margin") &&
				(element as HTMLElement).style?.[prop] === "auto"
			) {
				continue;
			}
			const value = Math.abs(Number.parseFloat(raw));
			if (onScale.has(value)) continue;
			if (paperExcuse(element, value)) continue;
			offenders.add(`${prop}: ${raw} on ${describe(element)}`);
		}
	}
	return [...offenders];
}

/**
 * The off-palette color sweep (claim 25), scoped to what actually paints:
 * `color` only on an element carrying its own text, `backgroundColor` only
 * where it is not the UA default's transparent, border colors only where a
 * border is actually drawn. Anything wider reports `rgb(0, 0, 0)` hundreds
 * of times for text-less divs — a scoping artefact, not a finding.
 */
function paletteSweep(args: { palette: string[] }): string[] {
	const onPalette = new Set(args.palette);
	const offenders = new Set<string>();
	const describe = (element: Element): string => {
		const testID = element.getAttribute("data-testid");
		const text = (element.textContent ?? "").trim().slice(0, 30);
		return `<${element.tagName.toLowerCase()}${testID ? ` data-testid=${testID}` : ""}${text ? ` "${text}"` : ""}>`;
	};
	const alpha = (computed: string): number => {
		const match = computed.match(/rgba?\(([^)]+)\)/);
		if (match === null) return 0;
		const parts = match[1].split(",").map((part) => part.trim());
		return parts.length > 3 ? Number.parseFloat(parts[3]) : 1;
	};
	const canonical = (computed: string): string | null => {
		const match = computed.match(/rgba?\(([^)]+)\)/);
		// Empty on non-rendered elements (`<head>`, `<meta>`), which paint
		// nothing and are not findings.
		if (match === null) return null;
		const [r, g, b, a = "1"] = match[1].split(",").map((part) => part.trim());
		return `rgba(${r}, ${g}, ${b}, ${Number(a)})`;
	};

	for (const element of Array.from(document.querySelectorAll("*"))) {
		const style = window.getComputedStyle(element);
		const paintsText = Array.from(element.childNodes).some(
			(node) =>
				node.nodeType === Node.TEXT_NODE &&
				(node.textContent ?? "").trim() !== "",
		);
		const textColor = canonical(style.color);
		if (paintsText && textColor !== null && !onPalette.has(textColor)) {
			offenders.add(`color: ${style.color} on ${describe(element)}`);
		}
		const background = canonical(style.backgroundColor);
		if (
			background !== null &&
			alpha(style.backgroundColor) > 0 &&
			!onPalette.has(background)
		) {
			offenders.add(
				`backgroundColor: ${style.backgroundColor} on ${describe(element)}`,
			);
		}
		for (const [widthProp, styleProp, colorProp, side] of [
			["borderTopWidth", "borderTopStyle", "borderTopColor", "top"],
			["borderRightWidth", "borderRightStyle", "borderRightColor", "right"],
			["borderBottomWidth", "borderBottomStyle", "borderBottomColor", "bottom"],
			["borderLeftWidth", "borderLeftStyle", "borderLeftColor", "left"],
		] as const) {
			const borderColor = canonical(style[colorProp]);
			const drawn =
				borderColor !== null &&
				style[widthProp] !== "0px" &&
				style[styleProp] !== "none";
			if (drawn && borderColor !== null && !onPalette.has(borderColor)) {
				offenders.add(
					`border${side}Color: ${style[colorProp]} on ${describe(element)}`,
				);
			}
		}
	}
	return [...offenders];
}

/**
 * The near-miss alignment sweep (claim 26): two painted boxes — a background
 * fill or a drawn border, never a component box against the text inside it —
 * whose edges on the same axis differ by more than 0 and less than
 * `space.xs`. Measured at rest; no drag state exists in these tests.
 *
 * An edge pair can only *read* as a near-miss between boxes somebody laid
 * out together, so a pair is compared only when the two boxes share a
 * parent element — that is what keeps a chip in one board column from being
 * judged against another column's card, or a row's meta chip against a FAB
 * a screen away. Which axis is compared follows the boxes' own overlap:
 * stacked boxes — x-ranges overlapping — should line up left/right; boxes
 * side by side — y-ranges overlapping — should line up top/bottom. Two
 * same-parent boxes sharing neither band on the axis compared were never
 * aligned there by anybody, and their near-equal edges are arithmetic
 * coincidence, not a defect the eye could see.
 */
function alignmentSweep(args: { xs: number }): string[] {
	const offenders = new Set<string>();
	const describe = (element: Element): string => {
		const testID = element.getAttribute("data-testid");
		const text = (element.textContent ?? "").trim().slice(0, 30);
		return `<${element.tagName.toLowerCase()}${testID ? ` data-testid=${testID}` : ""}${text ? ` "${text}"` : ""}>`;
	};
	const alpha = (computed: string): number => {
		const match = computed.match(/rgba?\(([^)]+)\)/);
		if (match === null) return 0;
		const parts = match[1].split(",").map((part) => part.trim());
		return parts.length > 3 ? Number.parseFloat(parts[3]) : 1;
	};
	const painted = (element: Element): boolean => {
		const style = window.getComputedStyle(element);
		if (alpha(style.backgroundColor) > 0) return true;
		for (const [widthProp, styleProp, colorProp] of [
			["borderTopWidth", "borderTopStyle", "borderTopColor"],
			["borderRightWidth", "borderRightStyle", "borderRightColor"],
			["borderBottomWidth", "borderBottomStyle", "borderBottomColor"],
			["borderLeftWidth", "borderLeftStyle", "borderLeftColor"],
		] as const) {
			if (
				style[widthProp] !== "0px" &&
				style[styleProp] !== "none" &&
				alpha(style[colorProp]) > 0
			) {
				return true;
			}
		}
		return false;
	};

	const boxes: { rect: DOMRect; name: string; element: Element }[] = [];
	for (const element of Array.from(document.querySelectorAll("*"))) {
		if (!painted(element)) continue;
		const rect = element.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) continue;
		boxes.push({ rect, name: describe(element), element });
	}

	for (let i = 0; i < boxes.length; i++) {
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i];
			const b = boxes[j];
			if (a.element.parentElement !== b.element.parentElement) continue;
			const overlapX = a.rect.left < b.rect.right && b.rect.left < a.rect.right;
			const overlapY = a.rect.top < b.rect.bottom && b.rect.top < a.rect.bottom;
			for (const edge of ["left", "right", "top", "bottom"] as const) {
				// Vertical edges belong to stacked boxes, which overlap in x;
				// horizontal edges belong to side-by-side boxes, which overlap
				// in y. See the function's comment for why.
				if (edge === "left" || edge === "right" ? !overlapX : !overlapY) {
					continue;
				}
				const delta = Math.abs(a.rect[edge] - b.rect[edge]);
				// Up to 0.02px is the same edge read twice with float noise.
				if (delta > 0.02 && delta < args.xs) {
					offenders.add(
						`${a.name} and ${b.name}: ${edge} edges differ by ${delta.toFixed(2)}px`,
					);
				}
			}
		}
	}
	return [...offenders];
}

/**
 * The three sweeps of claims 28 and 29 against a page that is already where
 * it should be — `/login`, which no authed context can reach, and `/details`,
 * which `ROUTES` cannot carry because its id comes from clicking.
 */
async function craftFindings(
	page: Parameters<typeof gotoAndSettle>[0],
	scheme: Scheme,
): Promise<string[]> {
	// `/details` is reached by a bare `page.goto`, which never passes through
	// `gotoAndSettle`, so the dev toast is stripped here. See
	// `e2e/support/app.ts` for why.
	await stripDevToast(page);

	return [
		...(await page.evaluate(spacingSweep, {
			allowed: ON_SCALE,
			paper: PAPER_INTERNALS,
		})),
		...(await page.evaluate(paletteSweep, { palette: PALETTE[scheme] })),
		...(await page.evaluate(alignmentSweep, { xs: space.xs })),
	];
}

/**
 * The scheme axis, and the one check that is about color.
 *
 * Only the palette changes with the scheme — `theme/tokens.ts` is where every
 * color lives and nothing in it is a size — so contrast is the only
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

			test(`25: ${route.path} only paints palette colors`, async ({ page }) => {
				await gotoAndSettle(page, route);

				const offenders = await page.evaluate(paletteSweep, {
					palette: PALETTE[scheme],
				});

				expect(
					offenders,
					`off-palette color on ${route.path} (${scheme})`,
				).toEqual([]);
			});
		}

		test("29: a node's /details is on-scale, on-palette and free of near-miss edges", async ({
			page,
		}) => {
			// The same click-through claim 21 makes: the card's id comes from the
			// fixture, never a literal, so the board is where the reach starts.
			await gotoAndSettle(page, BOARD);
			await page.getByText(SEEDED_PROJECT).first().click();
			await page.waitForURL(/\/projects\/[^/]+$/);
			const id = new URL(page.url()).pathname.split("/")[2] as string;
			await page.goto(`/projects/${id}/details`);
			await page.waitForLoadState("networkidle");
			await page
				.getByText(SEEDED_PROJECT)
				.first()
				.waitFor({ state: "visible", timeout: 30_000 });
			await page.evaluate(() => document.fonts.ready);
			// The sweeps read the page only once it is still. Under a loaded
			// worker the stack's mount transition can still be fading the board
			// out when the fonts resolve, and a mid-fade sample paints *two*
			// screens at once — the board's boxes measured against the details
			// screen's, which is a near-miss between screens nobody aligned.
			// ponytail: a fixed wait standing in for "the transition has
			// finished", which the DOM exposes no marker for.
			await page.waitForTimeout(1_500);

			const offenders = await craftFindings(page, scheme);

			expect(offenders, `craft findings on /details (${scheme})`).toEqual([]);
		});

		test.describe("unauthenticated", () => {
			// `/login` is the one route the authed context would bounce — the
			// shared storage state would redirect it before it rendered — so it
			// carries its own empty state rather than a `ROUTES` entry, and
			// `console.spec.ts` and `i18n.spec.ts` stay untouched by it.
			test.use({ storageState: { cookies: [], origins: [] } });

			test("28: /login is on-scale, on-palette and free of near-miss edges", async ({
				page,
			}) => {
				await gotoAndSettle(page, LOGIN_ROUTE);

				const offenders = await craftFindings(page, scheme);

				expect(offenders, `craft findings on /login (${scheme})`).toEqual([]);
			});
		});
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
			({ selector, minimum, markFloor }) => {
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
					// A **mark** is held to WCAG 2.5.8's 24px instead of the 48px
					// control floor, and only a mark: a label dot says which group a
					// card belongs to, and its tap duplicates the hover tooltip. A
					// `touchTarget` box around a 20px dot on a 24px pitch overlaps
					// its neighbour and steals its tap, so it takes `markTouch` — its
					// own band of the gutter. docs/DESIGN.md carries the exemption
					// and its limit. It is a lower floor, never no floor: an
					// undersized element wearing this testID still fails here.
					const floor =
						element.getAttribute("data-testid") === "label-mark"
							? markFloor
							: minimum;
					if (box.width < floor || box.height < floor) {
						const label =
							element.getAttribute("aria-label") ||
							element.textContent?.trim().slice(0, 40) ||
							element.className;
						offenders.push(
							`${Math.round(box.width)}x${Math.round(box.height)} "${label}" (floor ${floor})`,
						);
					}
				}
				return offenders;
			},
			{
				selector: INTERACTIVE,
				minimum: touchTarget,
				markFloor: markTargetMinimum,
			},
		);

		expect(
			undersized,
			`touch targets under ${touchTarget}dp on ${route.path}`,
		).toEqual([]);
	});

	test(`24: ${route.path} only uses on-scale spacing`, async ({ page }) => {
		await gotoAndSettle(page, route);

		// The measured element the pane inset is derived from: the FAB's own
		// height, read the way `Board.tsx` reads it. Routes without a FAB
		// carry none, and none of those render the inset.
		const fabHeights = await page.evaluate((selector) => {
			return Array.from(document.querySelectorAll(selector)).map(
				(element) => element.getBoundingClientRect().height,
			);
		}, FAB_SELECTOR);

		const offenders = await page.evaluate(spacingSweep, {
			allowed: [
				...ON_SCALE,
				...fabHeights.map((height) => height + space.md * 2),
			],
			paper: PAPER_INTERNALS,
		});

		expect(offenders, `off-scale spacing on ${route.path}`).toEqual([]);
	});

	test(`26: ${route.path} has no near-miss edges between painted boxes`, async ({
		page,
	}) => {
		await gotoAndSettle(page, route);

		const offenders = await page.evaluate(alignmentSweep, { xs: space.xs });

		expect(offenders, `near-miss edges on ${route.path}`).toEqual([]);
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
 * The claims that are not a width-independent sweep.
 *
 * All are claims about *both locales*, and the Swedish projects run this file
 * and `i18n.spec.ts` and nothing else. Each is pinned to the one width it is
 * about — the desktop column, and a 200% phone — so none costs a second run
 * of the same measurement in the project at the other width.
 */

const BOARD = ROUTES[1];
/** The other route that renders the FAB, and the one Overview names. */
const OVERVIEW = ROUTES[5];

/**
 * `/login` unauthenticated. A `ROUTES` entry would be walked by the authed
 * projects and bounce to `/homes` before it rendered, so it is its own test.
 */
const LOGIN_ROUTE = {
	path: "/login",
	ready: { key: "screen.login.title" },
} as unknown as Route;

/** A card the fixture always has, whose title names the screen you open it as. */
const SEEDED_PROJECT = "Renovera badrummet";

/**
 * The committed fixture's per-column counts, the same table `i18n.spec.ts`
 * reads for the strip: the desktop heading carries its count now (#141), so
 * the string it asserts has to be filled the same way the component fills it.
 */
const COLUMN_COUNTS = {
	backlog: 1,
	next_up: 2,
	execution: 2,
	done: 1,
} as const;

const fill = (template: string, column: string, count: number) =>
	template.replace("{{column}}", column).replace("{{count}}", String(count));

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
					heading: fill(
						strings.board.columnChip,
						strings.status[status],
						COLUMN_COUNTS[status],
					),
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
	test.skip(
		page.viewportSize()?.width !== VIEWPORTS.phone.width,
		"the 200% claim pins a 195px window; the desktop project would re-measure it identically",
	);

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

test("31: the FAB spans no more than 60% of a 195px viewport, in this locale", async ({
	page,
}, testInfo) => {
	test.skip(
		page.viewportSize()?.width !== VIEWPORTS.phone.width,
		"the 200% claim pins a 195px window; the desktop project would re-measure it identically",
	);

	// A 390px phone at 200% browser zoom is a 195x422 window, and the extended
	// FAB's translated label once took 77.9% of that window in English and
	// 91.8% in Swedish. The FAB's own cap is a share of the width it floats
	// over (`fab.widthShare`, measured from the board), so the check reads the
	// share the app enforces rather than a second copy of the number — the
	// label wraps under it, the words stay, and both FAB routes are measured.
	await page.setViewportSize(VIEWPORTS.phoneZoomed);

	const failures: string[] = [];
	for (const route of [BOARD, OVERVIEW]) {
		await gotoAndSettle(page, route);
		const share = await page.evaluate((selector) => {
			const element = document.querySelector(selector);
			if (element === null) return null;
			return (
				element.getBoundingClientRect().width /
				document.documentElement.clientWidth
			);
		}, FAB_SELECTOR);
		expect(share, `no FAB rendered on ${route.path}`).not.toBeNull();
		// Rounded to a tenth of a percent: the cap binds at exactly 60.0% and
		// the raw quotient can land a float step above the literal.
		const rounded = Math.round((share ?? 0) * 1000);
		if (rounded > Math.round(fab.widthShare * 1000)) {
			failures.push(
				`${route.path}: the FAB spans ${((share ?? 0) * 100).toFixed(1)}% of the viewport`,
			);
		}
	}

	expect(
		failures,
		`FAB width share at 195px (${testInfo.project.name})`,
	).toEqual([]);
});
