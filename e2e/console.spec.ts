import { expect, test } from "@playwright/test";
import { gotoAndSettle, ROUTES, recordConsole } from "@/e2e/support/app";

/**
 * The console is a gate, and this is the gate.
 *
 * `CLAUDE.md` states it plainly: the console is clean and its exceptions are a
 * closed list. That used to be checked by a browser agent running
 * `playwright-cli console` after each interaction and judging what it saw,
 * which cost tokens on every review and depended on the agent's patience. It is
 * a count. Counts belong in CI.
 *
 * A console that is never quiet teaches the next reviewer to read past it, which
 * is exactly how a real error gets waved through — the reasoning is written out
 * in `utils/dev-console.ts`.
 */

for (const route of ROUTES) {
	test(`console is clean on ${route.path}`, async ({ page }) => {
		const console_ = recordConsole(page);

		await gotoAndSettle(page, route);

		expect(console_.errors(), `console errors on ${route.path}`).toEqual([]);
		expect(console_.warnings(), `console warnings on ${route.path}`).toEqual(
			[],
		);
	});
}

test("console stays clean across a full navigation sweep", async ({ page }) => {
	// Per-route loads above each start from a cold page. This one keeps a single
	// session and moves through the app the way a person does, which is where a
	// stale listener or an effect without cleanup shows up instead.
	const console_ = recordConsole(page);

	for (const route of ROUTES) {
		await gotoAndSettle(page, route);
	}

	expect(console_.errors(), "console errors across the sweep").toEqual([]);
	expect(console_.warnings(), "console warnings across the sweep").toEqual([]);
});
