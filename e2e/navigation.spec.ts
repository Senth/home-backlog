import { expect, test } from "@playwright/test";
import { gotoAndSettle, ROUTES } from "@/e2e/support/app";
import enUS from "@/i18n/locales/en-US.json";

/**
 * Reload, back, and deep links — the three ways a router quietly breaks.
 *
 * All three used to be checklist items a browser agent walked by hand every
 * review. None of them is a judgement call: either the screen comes back with
 * its data or it does not.
 *
 * Deep linking is not a formality in an installed PWA. Every route here is
 * somewhere a person can be sent, or can be restored to after the app is killed
 * in the background, and a route that only works when you arrive by tapping is
 * broken for the shipping product.
 */

const HOMES = ROUTES[0];
const BOARD = ROUTES[1];
const OVERVIEW = ROUTES[5];

test("1: clicking the Projects tab lands on /projects and shows the root board", async ({
	page,
}) => {
	await gotoAndSettle(page, OVERVIEW);

	// The suite's first navigation by tab press. The pathname is asserted
	// before the board's data, so a wrong landing fails as a path — never as
	// a timeout, never as missing data.
	await page.getByRole("tab", { name: enUS.tab.projects }).click();

	// Wait for the router to go anywhere before asserting where it went:
	// asserting the pathname the instant after the click would race the
	// navigation and report the screen we came from.
	await page.waitForURL((url) => url.pathname !== OVERVIEW.path, {
		timeout: 30_000,
	});
	expect(new URL(page.url()).pathname).toBe(BOARD.path);

	await expect(page.getByText(BOARD.ready.text).first()).toBeVisible({
		timeout: 30_000,
	});
});

test("a reload keeps you on the same screen, with its data", async ({
	page,
}) => {
	await gotoAndSettle(page, BOARD);

	await page.reload();

	// `gotoAndSettle`'s readiness marker is data-backed, so re-waiting for it
	// after the reload is what proves the data came back and not just the shell.
	await expect(page.getByText(BOARD.ready.text).first()).toBeVisible({
		timeout: 30_000,
	});
	expect(new URL(page.url()).pathname).toBe(BOARD.path);
});

test("browser back returns to the previous screen", async ({ page }) => {
	await gotoAndSettle(page, HOMES);
	await gotoAndSettle(page, BOARD);

	await page.goBack();

	await expect(page.getByText(HOMES.ready.text).first()).toBeVisible({
		timeout: 30_000,
	});
	expect(new URL(page.url()).pathname).toBe(HOMES.path);
});

for (const route of ROUTES) {
	test(`${route.path} can be reached as a deep link`, async ({ page }) => {
		// The assertion is inside `gotoAndSettle`: it fails if the app redirects
		// somewhere else, and it fails if the screen never gets its data.
		await gotoAndSettle(page, route);
	});
}
