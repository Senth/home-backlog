import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { gotoAndSettle, ROUTES } from "@/e2e/support/app";
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
 * Everything here runs at 390 px, in both locales and both colour schemes,
 * because Swedish words are longer and dark mode is a different palette rather
 * than an inversion.
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
			test(`${route.path} has no accessibility violations`, async ({
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

			test(`${route.path} does not scroll horizontally`, async ({ page }) => {
				await gotoAndSettle(page, route);

				// A page that scrolls sideways on a phone is the single most common
				// way a fixed width or an un-wrapped row escapes review.
				const overflow = await page.evaluate(() => ({
					scrollWidth: document.documentElement.scrollWidth,
					clientWidth: document.documentElement.clientWidth,
				}));

				expect(
					overflow.scrollWidth,
					`horizontal overflow on ${route.path} (${scheme})`,
				).toBeLessThanOrEqual(overflow.clientWidth);
			});

			test(`${route.path} has no touch target under ${touchTarget}dp`, async ({
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
