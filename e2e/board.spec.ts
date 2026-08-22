import { expect, test } from "@playwright/test";
import { gotoAndSettle, ROUTES, VIEWPORTS } from "@/e2e/support/app";
import enUS from "@/i18n/locales/en-US.json";
import { touchTarget } from "@/theme/tokens";

/**
 * The board's card face, measured.
 *
 * Everything here is a claim from the board list-area pass (#104) that is about
 * a card rather than about a width: what the face shows, what a tap does, what
 * the count is announced as, and that the lifted card is the card it left. The
 * width claims are in `board-desktop.spec.ts`, and the claims that have to be
 * made in Swedish are in `craft.spec.ts` and `i18n.spec.ts`, which are the two
 * files the Swedish projects run.
 *
 * **Pinned to phone width.** The board is one pane and a strip of chips below
 * `compactBreakpoint` and four columns above it, so a card claim asserted at
 * whatever width the project happens to use would be asserting two different
 * layouts under one name. 390 px is also the device the app is used on.
 *
 * The fixture is a real household's board, so the cards are named rather than
 * indexed: `Renovera badrummet` has four steps and one of them done, and
 * `Byt filter i ventilationen` has none. Both are root cards of the seeded home.
 */

test.use({ viewport: VIEWPORTS.phone });

const BOARD = ROUTES[1];

/** A card with steps, and the column it is in. */
const WITH_STEPS = { title: "Renovera badrummet", done: 1, total: 4 };
/** A card without any, one column over. */
const WITHOUT_STEPS = { title: "Byt filter i ventilationen" };

/**
 * The strip chips, in the frozen column order: To do, Next up, In progress,
 * Done. By position because the chip's own words are translated and this file
 * runs in English only; the order is `defaultColumns`, which is what the board
 * freezes.
 */
const EXECUTION_CHIP = 2;

/**
 * The two glyphs this claim set is about, as the characters the icon font
 * renders them as.
 *
 * `format-list-checks` is what says a card is a board; `chevron-right` is what
 * used to say it, twice over, and must now appear on no card at all. A codepoint
 * rather than a name because that is all the DOM has — `@expo/vector-icons`
 * renders an icon as one character of `material-community`, and its glyph map is
 * where these two came from.
 */
const STEPS_GLYPH = String.fromCodePoint(0xf0756);
const CHEVRON_GLYPH = String.fromCodePoint(0xf0142);

const CARD = '[data-testid="card-container"]';

test("1: a card with steps shows the glyph and its count, a card without shows neither, and both still open what they opened before", async ({
	page,
}) => {
	await gotoAndSettle(page, BOARD);

	const board = page.locator(CARD, { hasText: WITH_STEPS.title });
	const steps = board.getByTestId("card-steps");
	await expect(steps).toBeVisible();
	await expect(steps).toContainText(STEPS_GLYPH);
	await expect(steps).toContainText(`${WITH_STEPS.done}/${WITH_STEPS.total}`);

	// A tap on a card that is a board drills into that board: `/projects/<id>`,
	// and not the details route one segment further on.
	await board.getByText(WITH_STEPS.title).click();
	await page.waitForURL(/\/projects\/[^/]+$/);

	await page.goBack();
	await page.getByTestId("chip").nth(EXECUTION_CHIP).click();

	const plain = page.locator(CARD, { hasText: WITHOUT_STEPS.title });
	await expect(plain).toBeVisible();
	await expect(plain.getByTestId("card-steps")).toHaveCount(0);
	await expect(plain).not.toContainText(STEPS_GLYPH);

	// And a card that is not a board still opens its details, which is the half
	// of this that a dropped chevron could have broken silently.
	await plain.getByText(WITHOUT_STEPS.title).click();
	await page.waitForURL(/\/projects\/[^/]+\/details$/);
});

test("2: no card renders a chevron", async ({ page }) => {
	await gotoAndSettle(page, BOARD);

	// Every pane, not just the one the board opens on: a pane that is not on
	// screen renders no cards at all, so a single-pane check would clear three
	// columns it never looked at.
	const chips = page.getByTestId("chip");
	let seen = 0;

	for (let index = 0; index < (await chips.count()); index++) {
		await chips.nth(index).click();
		const cards = page.locator(CARD);
		const count = await cards.count();
		seen += count;

		for (let card = 0; card < count; card++) {
			await expect(cards.nth(card)).not.toContainText(CHEVRON_GLYPH);
		}
	}

	// The fixture's six root cards. Without this the loop above passes on a board
	// that rendered nothing, which is exactly how a "no chevron" check survives
	// the card face disappearing.
	expect(seen, "cards walked across the strip").toBeGreaterThanOrEqual(6);
});

test("4: the step count is still announced as a sentence, not as a fraction", async ({
	page,
}) => {
	await gotoAndSettle(page, BOARD);

	// `1/4` is a mark for the eye. What a screen reader has to say is the
	// detail screen's own sentence, which is why the count keeps that label.
	const spoken = enUS.detail.stepsDone
		.replace("{{done}}", String(WITH_STEPS.done))
		.replace("{{total}}", String(WITH_STEPS.total));

	const count = page
		.locator(CARD, { hasText: WITH_STEPS.title })
		.getByTestId("card-steps")
		.locator("[aria-label]");

	await expect(count).toHaveAttribute("aria-label", spoken);
	await expect(count).toHaveText(`${WITH_STEPS.done}/${WITH_STEPS.total}`);
});

for (const scheme of ["light", "dark"] as const) {
	test.describe(`${scheme} scheme`, () => {
		test.use({ colorScheme: scheme });

		test(`6: the step count clears 4.5:1 against the card fill (${scheme})`, async ({
			page,
		}) => {
			await gotoAndSettle(page, BOARD);

			const measured = await page
				.locator(CARD, { hasText: WITH_STEPS.title })
				.evaluate((card) => {
					const count = card.querySelector<HTMLElement>(
						'[data-testid="card-steps"] [aria-label]',
					);
					if (count === null) return null;
					return {
						text: window.getComputedStyle(count).color,
						// The card's own fill, not the column's: what the count is read
						// against is whatever the card is painted with.
						fill: window.getComputedStyle(card).backgroundColor,
					};
				});

			expect(
				measured,
				"the count and the card fill were both measured",
			).not.toBeNull();

			const ratio = contrast(measured?.text ?? "", measured?.fill ?? "");
			expect(
				ratio,
				`${measured?.text} on ${measured?.fill} (${scheme})`,
			).toBeGreaterThanOrEqual(4.5);
		});

		test(`11: a lifted card's fill matches the card it left (${scheme})`, async ({
			page,
		}) => {
			await gotoAndSettle(page, BOARD);

			const card = page.locator(CARD, { hasText: WITH_STEPS.title });
			const box = await card.boundingBox();
			expect(box, "the card to drag was on screen").not.toBeNull();
			if (box === null) return;

			const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
			const resting = await card.evaluate(
				(node) => window.getComputedStyle(node).backgroundColor,
			);

			// A mouse arms the drag on `pointerSlop` pixels of movement rather than
			// on a hold, so this is down-move-measure with the button still down.
			await page.mouse.move(from.x, from.y);
			await page.mouse.down();
			await page.mouse.move(from.x, from.y + 40, { steps: 8 });

			const fills = await page.evaluate((selector) => {
				const cards = Array.from(
					document.querySelectorAll<HTMLElement>(selector),
				);
				return {
					count: cards.length,
					// The overlay's card and its `Surface`, which fills behind the
					// card's corners: an untinted radius there is where a lifted card
					// would otherwise be a different shade from the gap it left.
					colours: cards.flatMap((node) => {
						const surface = node.parentElement;
						return [
							window.getComputedStyle(node).backgroundColor,
							...(surface === null
								? []
								: [window.getComputedStyle(surface).backgroundColor]),
						];
					}),
				};
			}, CARD);

			// Put it back where it came from before asserting: a drop onto its own
			// slot writes nothing, and an assertion that throws with the button
			// still down leaves the next test holding a card.
			await page.mouse.move(from.x, from.y, { steps: 8 });
			await page.mouse.up();

			// One card in the column, one in the air. Without this the equality
			// below is a comparison of a single card with itself.
			expect(fills.count, "the card lifted into an overlay").toBe(2);

			const opaque = fills.colours.filter(
				(colour) => colour !== "rgba(0, 0, 0, 0)",
			);
			expect(
				Array.from(new Set(opaque)),
				`fills on the board while a card is up (${scheme})`,
			).toEqual([resting]);
		});
	});
}

test(`7: the card's menu button and every strip chip are at least ${touchTarget}dp`, async ({
	page,
}) => {
	await gotoAndSettle(page, BOARD);

	// Named rather than swept: `craft.spec.ts` fails on *any* undersized control
	// on the route, which is the check that catches a regression anywhere — and
	// which passes just as happily on a board that renders no menu button and no
	// strip at all. These two are the controls this pass shrank the glyph inside,
	// so these two are asserted to exist and then measured.
	const menu = page.locator(CARD).first().getByRole("button");
	await expect(menu).toHaveCount(1);

	const chips = page.getByTestId("chip");
	await expect(chips).toHaveCount(4);

	for (const control of [menu, ...(await chips.all())]) {
		const box = await control.boundingBox();
		const label = await control.getAttribute("aria-label");
		expect(box, `${label} is on screen`).not.toBeNull();
		expect(box?.width ?? 0, `${label} width`).toBeGreaterThanOrEqual(
			touchTarget,
		);
		expect(box?.height ?? 0, `${label} height`).toBeGreaterThanOrEqual(
			touchTarget,
		);
	}
});

/** WCAG 2.1 contrast, from two `rgb(...)` strings as the browser reports them. */
function contrast(foreground: string, background: string): number {
	const light = (colour: string) => {
		const [red = 0, green = 0, blue = 0] = (colour.match(/[\d.]+/g) ?? []).map(
			Number,
		);
		const channel = (value: number) => {
			const ratio = value / 255;
			return ratio <= 0.03928
				? ratio / 12.92
				: ((ratio + 0.055) / 1.055) ** 2.4;
		};
		return (
			0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
		);
	};

	const one = light(foreground);
	const two = light(background);
	return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
}
