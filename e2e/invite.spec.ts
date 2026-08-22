import type { Page } from "@playwright/test";
import { chromium, expect, test } from "@playwright/test";
import { clickMenuItem } from "@/e2e/support/app";
import { SECOND_ACCOUNT, signInAs } from "@/e2e/support/auth";

/**
 * `#102`'s claim 19: an invite accepted with *Add them to every shared
 * project* ticked puts the new member on every shared root; unticked, on
 * none.
 *
 * A throwaway **home**, not a throwaway node — Marcus's real homes are the
 * only fixture this claim can use without a raw Firestore write standing in
 * for the invite/accept round trip the claim is actually about. Both variants
 * clean up through the app itself: remove the second member, then delete the
 * home, the same two controls `DangerZone`/`MembersList` already ship. A run
 * that crashes mid-test leaves a throwaway home behind, the same risk
 * `offline.spec.ts` accepts for a crashed worker and a stray card.
 */

test.describe.configure({ mode: "serial" });

const CARD = '[data-testid="card-container"]';

async function inviteAndJoin(page: Page, ticked: boolean): Promise<void> {
	const homeName = `E2E invite ${ticked ? "ticked" : "unticked"} ${Date.now()}`;
	const cardTitle = `E2E invite card`;

	// Create the throwaway home, as Marcus.
	await page.goto("/homes");
	await page.waitForLoadState("networkidle");
	await page.getByRole("button", { name: "Create a new home" }).click();
	await page.getByRole("textbox").fill(homeName);
	await page.getByRole("button", { name: "Create", exact: true }).click();
	await page.waitForURL((url) => !url.pathname.endsWith("/homes"), {
		timeout: 60_000,
	});

	// One shared root, so there is something to check the invitee's board for.
	await page.waitForLoadState("networkidle");
	await page
		.getByRole("button", { name: /^Add to /i })
		.first()
		.click();
	await page.getByRole("textbox").first().fill(cardTitle);
	await page.getByRole("button", { name: "Add", exact: true }).click();
	await expect(page.getByText(cardTitle)).toBeVisible();

	// Invite Anna, with the box set as this run wants it.
	await page.goto("/homes");
	await page.waitForLoadState("networkidle");
	await page.getByRole("button", { name: `Manage ${homeName}` }).click();
	await page.waitForURL(/\/homes\/[^/]+$/);

	await page.getByRole("textbox").nth(1).fill(SECOND_ACCOUNT);
	if (ticked) {
		await page
			.getByRole("checkbox", { name: "Add them to every shared project" })
			.click();
	}
	await page.getByRole("button", { name: "Send invitation" }).click();
	await expect(page.getByText(/Invitation sent to/)).toBeVisible();

	// Accept as Anna, in a browser of her own — a dedicated `chromium.launch()`
	// rather than `browser.newContext()` on the shared worker browser, since
	// IndexedDB (where Firebase keeps the signed-in session) was observed
	// leaking across contexts of the same `chrome-headless-shell` process. See
	// `e2e/support/auth.ts`.
	const annaBrowser = await chromium.launch();
	try {
		const context = await annaBrowser.newContext();
		const annaPage = await context.newPage();
		// Anna is already a member of `Huset`, so `signInAs` lands her there
		// directly rather than on `/homes` — the pending invite for the
		// throwaway home is a deliberate second stop.
		await signInAs(annaPage, SECOND_ACCOUNT);
		await annaPage.goto("/homes");
		await annaPage.waitForLoadState("networkidle");
		await annaPage
			.getByText(new RegExp(`invited you to ${homeName}`))
			.waitFor({ state: "visible", timeout: 30_000 });
		await annaPage.getByRole("button", { name: "Join" }).click();
		await annaPage.waitForURL("**/projects", { timeout: 60_000 });
		await annaPage.waitForLoadState("networkidle");

		if (ticked) {
			await expect(annaPage.locator(CARD, { hasText: cardTitle })).toBeVisible({
				timeout: 30_000,
			});
		} else {
			await expect(annaPage.locator(CARD, { hasText: cardTitle })).toHaveCount(
				0,
			);
		}
	} finally {
		await annaBrowser.close();
	}

	// Clean up: remove Anna, then delete the now-solo home.
	await page.goto("/homes");
	await page.waitForLoadState("networkidle");
	await page.getByRole("button", { name: `Manage ${homeName}` }).click();
	await page.waitForURL(/\/homes\/[^/]+$/);

	await clickMenuItem(
		page,
		page.getByRole("button", { name: "Manage Anna Maria Berg" }),
		"Remove from home",
	);
	await page
		.getByRole("button", { name: "Remove from home", exact: true })
		.click();
	await expect(page.getByText("Anna Maria Berg")).toHaveCount(0);

	await page.getByRole("button", { name: "Delete this home" }).click();
	await page.getByRole("button", { name: "Delete", exact: true }).click();
	await page.waitForURL("**/homes", { timeout: 30_000 });
}

test("19: accepting an invite with the box ticked puts the new member on every shared root", async ({
	page,
}) => {
	await inviteAndJoin(page, true);
});

test("19: accepting an invite with the box unticked puts the new member on none of the shared roots", async ({
	page,
}) => {
	await inviteAndJoin(page, false);
});
