import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { stackPorts } from "@/e2e/support/stack";

/**
 * The REST API's door, and the API key it answers to.
 *
 * The calls go straight at the Functions emulator, bypassing Hosting's
 * `/api/**` rewrite the way `app.ts`'s own doc comment says a direct call to
 * the function arrives — `/v1/...`, not `/api/v1/...`. There is no Hosting
 * emulator in this stack (`firebase.json`'s `emulators` block has none), so
 * this is the only door available to a real request.
 */
export const FUNCTIONS_BASE = `http://127.0.0.1:${stackPorts().functions}/home-backlog/europe-west1/api/v1`;

/**
 * Every minted key carries this name stem, plus the timestamp that keeps
 * parallel workers and CI retries apart.
 */
export const KEY_NAME = "E2E rest api key";

/**
 * Mints a real API key through the Automations screen, runs `use` with it,
 * then revokes it. The mint lives inside the `try`, so a key minted but never
 * surfaced (the secret dialog failing to render, say) is still revoked in the
 * `finally`. What a crashed run can still leave behind is a key — each spec's
 * `afterEach` sweeps only documents — which is why every mint also gets a
 * unique name: a leaked key can never collide with a later mint's revoke
 * locator.
 */
export async function withApiKey<T>(
	page: Page,
	use: (token: string) => Promise<T>,
): Promise<T> {
	await page.goto("/automations");
	await page.waitForLoadState("networkidle");

	// Two keys can never share a name, so every mint gets a unique one;
	// `Date.now()` also keeps parallel workers and CI retries apart.
	const keyName = `${KEY_NAME} ${Date.now()}`;
	let minted = false;

	try {
		await page.getByRole("button", { name: "New API key" }).click();
		await page.getByRole("textbox").fill(keyName);
		await page.getByRole("button", { name: "Create", exact: true }).click();
		minted = true;

		// The secret `Text` carries the token as its own accessible name's target,
		// not a form control `getByLabel` would find — see `automations.tsx`.
		const secret = page.locator('[aria-label="Copy the key now"]');
		await expect(secret).toBeVisible();
		const token = (await secret.textContent())?.trim();
		if (!token) throw new Error("no token rendered in the secret dialog");
		await page.getByRole("button", { name: "Done" }).click();

		return await use(token);
	} finally {
		// Only a mint that got as far as `Create` can have produced a key; before
		// that there is nothing to revoke and revoking would hang on a locator.
		if (minted) {
			await page.getByRole("button", { name: `Revoke ${keyName}` }).click();
			await page.getByRole("button", { name: "Revoke", exact: true }).click();
		}
	}
}
