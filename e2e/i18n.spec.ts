import { expect, test } from "@playwright/test";
import {
	gotoAndSettle,
	ROUTES,
	translationKeys,
	VIEWPORTS,
} from "@/e2e/support/app";
import enUS from "@/i18n/locales/en-US.json";
import svSE from "@/i18n/locales/sv-SE.json";

/**
 * Nothing on screen may be a translation key, in either locale.
 *
 * A raw key on screen means one of two failures: a `t()` call whose key does not
 * exist, or a string that was added to `en-US.json` and forgotten in
 * `sv-SE.json`. `scripts/check-invariants.sh` already catches key *parity*
 * between the two files — the same set of keys in both. It cannot catch a key
 * that is missing from both, or a `t("bord.title")` typo, because from the
 * outside those look like a key nobody has added yet.
 *
 * The check is made against the real key list rather than a shape like
 * `/\w+(\.\w+)+/`, which is the difference between a check that runs forever and
 * one that gets disabled the first time an email address or a version number
 * trips it.
 */

const KEYS = translationKeys();

/**
 * The locale each Playwright project runs under, from its name.
 *
 * A prefix rather than an equality, because the project name carries two axes
 * now: `sv-SE` and `sv-SE-desktop` are the same locale at two widths. An
 * equality here would have asked the desktop Swedish project for an English
 * heading and failed on the app's behalf.
 */
function expectedTitle(projectName: string): string {
	return projectName.startsWith("sv-SE") ? svSE.homes.title : enUS.homes.title;
}

test("the project's locale is actually in effect", async ({
	page,
}, testInfo) => {
	// If this fails, every other assertion in this file is vacuous: a sv-SE
	// project silently serving English would find no untranslated strings.
	await gotoAndSettle(page, ROUTES[0]);
	await expect(
		page.getByRole("heading", { name: expectedTitle(testInfo.project.name) }),
	).toBeVisible();
});

for (const route of ROUTES) {
	test(`no raw translation key is rendered on ${route.path}`, async ({
		page,
	}) => {
		await gotoAndSettle(page, route);

		const text = await page.locator("body").innerText();
		const onScreen = KEYS.filter((key) => text.includes(key));

		expect(onScreen, `raw t() keys visible on ${route.path}`).toEqual([]);
	});
}

/**
 * The column strip, whose label stopped being composed in code.
 *
 * The sweep above proves no key reaches the screen; it cannot prove a label is
 * *built from* one. `"To do" + " · " + count` in a component renders exactly as
 * `board.columnChip` does and reads exactly as right — and is a string no
 * translator can reach, in the one control that is the primary way across a
 * board on a phone. So the separator and the order are asserted against the key,
 * in whichever locale the project runs.
 *
 * The counts are the committed fixture's, the same way the board specs name its
 * cards. Reading them off the chip and then comparing them with themselves would
 * be a check that cannot fail.
 */
const STRIP = [
	{ status: "backlog", count: 1 },
	{ status: "next_up", count: 2 },
	{ status: "execution", count: 2 },
	{ status: "done", count: 1 },
] as const;

test("9: every column chip is composed from board.columnChip, spoken from board.columnChipA11y, and the current one from board.columnChipCurrentA11y", async ({
	page,
}, testInfo) => {
	test.skip(
		page.viewportSize()?.width !== VIEWPORTS.phone.width,
		"above compactBreakpoint the column headers say this and the strip is not rendered",
	);

	const strings = testInfo.project.name.startsWith("sv-SE") ? svSE : enUS;
	const fill = (template: string, column: string, count: number) =>
		template.replace("{{column}}", column).replace("{{count}}", String(count));

	await gotoAndSettle(page, ROUTES[1]);

	const chips = page.getByTestId("chip");
	await expect(chips).toHaveCount(STRIP.length);

	for (const [index, { status, count }] of STRIP.entries()) {
		const column = strings.status[status];
		const chip = chips.nth(index);

		await expect(chip).toHaveText(
			fill(strings.board.columnChip, column, count),
		);
		// And what a screen reader hears instead, because a middle dot is read
		// aloud as "middle dot" or as nothing at all. The chip for the column on
		// screen says that it is the current one in its own name: Paper's `Chip`
		// never lets an `aria-*` prop reach the `<button>` a person taps, so the
		// label is the only state a screen reader can hear. The board opens on
		// the first column.
		const a11yKey =
			index === 0
				? count === 1
					? strings.board.columnChipCurrentA11y_one
					: strings.board.columnChipCurrentA11y_other
				: count === 1
					? strings.board.columnChipA11y_one
					: strings.board.columnChipA11y_other;
		await expect(chip).toHaveAttribute(
			"aria-label",
			fill(a11yKey, column, count),
		);
		// And `aria-current` beside it — the DOM's "you are here". It lands on
		// Paper's outer surface rather than the button, so it is asserted there.
		const container = page.getByTestId("chip-container").nth(index);
		if (index === 0) {
			await expect(container).toHaveAttribute("aria-current", "true");
		} else {
			await expect(container).not.toHaveAttribute("aria-current");
		}
	}
});
