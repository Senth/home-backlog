import { expect, test } from "@playwright/test";
import { clickMenuItem, gotoAndSettle, ROUTES } from "@/e2e/support/app";
import { deleteNodesByTitlePrefix, nodeTitles } from "@/e2e/support/firestore";

/**
 * Offline is the whole point of the PWA, so this is the spec that matters most.
 *
 * The old checklist did this by dispatching an `offline` event, and the agent
 * file said outright that this was not good enough: the event only exercises
 * `use-online-status`, never the Firestore write queue. `context.setOffline`
 * cuts the connection at the browser, which is the real thing.
 *
 * The assertion that earns its keep is the last one. A card visible after a
 * reload proves only that Firestore's local cache still has it — a write that
 * never reached the server looks identical from the UI. Asking the backend
 * directly is the only way to tell "queued and delivered" from "queued and
 * quietly lost".
 */

const BOARD = ROUTES[1];

test.describe("offline writes", () => {
	// A title unique per run, so a previous failure cannot make this one pass.
	const title = `E2E offline ${Date.now()}`;

	// By prefix rather than by this run's exact title, so a delete cannot miss
	// the card a *previous* run crashed out of cleaning up. This spec lives in
	// the `writes` project, which is one worker deep and runs alone, so there is
	// never a second offline card in flight for this to take out from under
	// another test.
	test.afterEach(async () => {
		await deleteNodesByTitlePrefix("E2E offline");
	});

	test("a card created offline reaches Firestore once the connection returns", async ({
		page,
		context,
	}) => {
		await gotoAndSettle(page, BOARD);

		await context.setOffline(true);

		// `.first()` because the add affordance is per-column above
		// `compactBreakpoint`: the phone has one FAB naming the pane on screen,
		// desktop has an add row in each of the four columns. The first is the
		// first column either way, so both widths add to the same place — and
		// every assertion below is by title, not by column.
		await page
			.getByRole("button", { name: /^Add to /i })
			.first()
			.click();
		await page.getByRole("textbox").first().fill(title);
		await page.getByRole("button", { name: "Add", exact: true }).click();

		// Optimistic: the card is on the board immediately, offline or not.
		await expect(page.getByText(title)).toBeVisible();

		await context.setOffline(false);
		await page.reload();

		await expect(page.getByText(title)).toBeVisible();

		// The one that cannot be faked by the cache.
		await expect
			.poll(nodeTitles, {
				timeout: 30_000,
				message: `"${title}" never reached Firestore — the write was queued and lost`,
			})
			.toContain(title);
	});

	test("17: a rename made offline appears immediately and lands on reconnect", async ({
		page,
		context,
	}) => {
		const original = `E2E offline rename ${Date.now()}`;
		const renamed = `${original} renamed`;

		await gotoAndSettle(page, BOARD);

		// Created online, so this test is only about the rename queuing — the
		// other test already covers a queued create.
		await page
			.getByRole("button", { name: /^Add to /i })
			.first()
			.click();
		await page.getByRole("textbox").first().fill(original);
		await page.getByRole("button", { name: "Add", exact: true }).click();
		await expect(page.getByText(original)).toBeVisible();
		await expect.poll(nodeTitles, { timeout: 30_000 }).toContain(original);

		await context.setOffline(true);

		const anchor = page
			.locator('[data-testid="card-container"]', { hasText: original })
			.getByRole("button", { name: "Card actions" });
		await clickMenuItem(page, anchor, "Rename");
		await page.getByRole("textbox").fill(renamed);
		await page.getByRole("button", { name: "Rename", exact: true }).click();

		// Optimistic, the same as a create.
		await expect(page.getByText(renamed)).toBeVisible();

		await context.setOffline(false);
		await page.reload();

		await expect(page.getByText(renamed)).toBeVisible();

		await expect
			.poll(nodeTitles, {
				timeout: 30_000,
				message: `"${renamed}" never reached Firestore — the rename was queued and lost`,
			})
			.toContain(renamed);
	});
});
