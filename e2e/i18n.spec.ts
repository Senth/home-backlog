import { expect, test } from "@playwright/test";
import { gotoAndSettle, ROUTES, translationKeys } from "@/e2e/support/app";
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
