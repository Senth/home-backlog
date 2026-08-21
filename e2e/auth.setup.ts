import { expect, test as setup } from "@playwright/test";
import { AUTH_STATE } from "@/playwright.config";

/**
 * Signs in once, so no other spec ever has to.
 *
 * Sign-in here is a **redirect**, not a popup: `GoogleSignIn.web.tsx` uses
 * `signInWithRedirect` deliberately, because a popup dead-ends in an installed
 * PWA. The Auth emulator serves its own handler at port 8061, which is an
 * account picker listing whatever `.emulator-seed/auth_export` holds, so no real
 * Google account is involved. The browser leaves the app, picks an account, and
 * comes back — one tab throughout.
 *
 * The saved state has to include **IndexedDB**. Firebase's web persistence
 * chain starts at `indexedDBLocalPersistence` (see `config/firebase.ts`), so
 * cookies and `localStorage` alone would restore a signed-*out* browser and
 * every spec would land on the login screen. `indexedDB: true` is the whole
 * reason this works.
 */

/** The seeded account the suite runs as. Also in `.emulator-seed/auth_export`. */
const ACCOUNT = "marcus@example.com";

/** The seeded home the suite works inside. Marcus is a member of two. */
const HOME = "Huset";

setup("sign in and save browser state", async ({ page }) => {
	await page.goto("/");

	// The splash holds the router until auth resolves, so the login screen is
	// what a signed-out browser settles on rather than what it starts on.
	await page.waitForURL("**/login", { timeout: 60_000 });

	await page.getByRole("button", { name: /continue with google/i }).click();

	// The emulator's picker is a different origin (8061), reached by redirect.
	await page.waitForURL(/:8061\/emulator\/auth\/handler/, { timeout: 30_000 });
	await page.getByText(ACCOUNT, { exact: true }).click();

	// Back in the app and past the splash. A signed-in browser with no home
	// would land elsewhere, so this asserts the seeded state as much as the
	// sign-in: `/homes` is where an account that already has homes arrives.
	await page.waitForURL("**/homes", { timeout: 60_000 });
	await expect(
		page.getByRole("heading", { name: /my homes|mina hem/i }),
	).toBeVisible();

	// Pick a home, and save the state *after* that.
	//
	// Not decoration: `/projects`, `/locations` and `/maintenance` all live under
	// an active home, and visiting one without a home selected redirects to
	// `/homes`. A suite whose saved state stopped at the home list would still go
	// green — it would just be asserting `/homes` five times over and reporting
	// it as five routes.
	await page.getByText(HOME, { exact: true }).click();
	await page.waitForURL((url) => !url.pathname.endsWith("/homes"), {
		timeout: 60_000,
	});

	await page.context().storageState({ path: AUTH_STATE, indexedDB: true });
});
