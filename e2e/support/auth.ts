import type { Page } from "@playwright/test";
import { stackPorts } from "@/e2e/support/stack";

/**
 * Signing in as a second seeded account, for the two claims that need one.
 *
 * `auth.setup.ts` signs in once, as Marcus, and saves that state for every
 * other spec — which is right for a suite whose claims are all single-user.
 * `#102`'s claim 4 (a narrowed project absent from another member's board) and
 * claim 19 (an invite accepted or declined) are not, and there is no saved
 * state for a second identity to reuse: paying the sign-in redirect twice, in
 * exactly the two specs that need it, is cheaper than a second saved state
 * every other spec would carry for nothing.
 */

/** The seeded account beside Marcus — a member of `Huset`, of nothing else. */
export const SECOND_ACCOUNT = "anna@example.com";

/**
 * Signs a fresh, unauthenticated page in as a seeded account — the same
 * redirect flow `auth.setup.ts` uses, run against a page that was never
 * handed a saved `storageState`.
 *
 * Stops once the app has left `/login`, wherever it lands — `HomeContext`
 * auto-picks a home when none is stored, so an account with exactly one home
 * (Anna, in `Huset`) goes straight to `/overview` and never shows `/homes` at
 * all. An account with none, or more than one and nothing chosen yet, lands
 * on `/homes` instead. Both callers navigate from here to wherever they
 * actually need.
 */
export async function signInAs(page: Page, email: string): Promise<void> {
	await page.goto("/");

	// A "fresh" page — even from a dedicated `chromium.launch()` — was observed
	// carrying Marcus's persisted session: `firebaseLocalStorageDb` and
	// `home-backlog.activeHomeId` were already there on first load, in this
	// stack. Wherever that persistence actually lives, wiping the page's own
	// storage and reloading is what reliably gets a second identity a blank
	// one — see the trace this comment is named after if that stops being
	// true. ponytail: page-level wipe, not a root-caused fix; revisit if a
	// third identity is ever needed and this stops being enough.
	await page.evaluate(async () => {
		localStorage.clear();
		sessionStorage.clear();
		if ("databases" in indexedDB) {
			const databases = await indexedDB.databases();
			await Promise.all(
				databases.map(
					(database) =>
						database.name &&
						new Promise((resolve) => {
							const request = indexedDB.deleteDatabase(database.name as string);
							request.onsuccess = () => resolve(undefined);
							request.onerror = () => resolve(undefined);
							request.onblocked = () => resolve(undefined);
						}),
				),
			);
		}
	});
	await page.reload();

	await page.waitForURL("**/login", { timeout: 60_000 });

	await page.getByRole("button", { name: /continue with google/i }).click();

	// The emulator's picker is a different origin (the allocated auth port),
	// reached by redirect.
	await page.waitForURL(
		new RegExp(`:${stackPorts().auth}/emulator/auth/handler`),
		{ timeout: 30_000 },
	);
	await page.getByText(email, { exact: true }).click();

	await page.waitForURL((url) => url.pathname !== "/login", {
		timeout: 60_000,
	});
}
