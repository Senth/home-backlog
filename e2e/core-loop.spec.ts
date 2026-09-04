import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
	clickMenuItem,
	columnSelector,
	gotoAndSettle,
	ROUTES,
} from "@/e2e/support/app";
import {
	deleteNodesByTitlePrefix,
	nodeFields,
	waitForNodeIdByTitle,
} from "@/e2e/support/firestore";
import enUS from "@/i18n/locales/en-US.json";

/**
 * The Trello part, end to end and nothing else: the FAB, the four columns, and
 * a card completing into Done — with the reload claim from the old navigation
 * spec folded in at the end. The phone affordance is the card menu: drag is
 * `DragArea.web.tsx` and belongs to the desktop path, which the `writes`
 * project never runs.
 *
 * What is deliberately *not* here: the rank arithmetic behind a move and the
 * `completedAt` bookkeeping are `data/nodes.ts` / `models/node.ts` unit
 * territory. This file proves the browser reaches them.
 */

const BOARD = ROUTES[1];
const CARD = '[data-testid="card-container"]';

/** What every node this file creates is titled, so cleanup can find it. */
const PREFIX = "E2E core-loop ";

test.afterEach(async () => {
	await deleteNodesByTitlePrefix(PREFIX);
});

/** Adds a card to the pane the board opened on — the FAB names it in words. */
async function addCardFromFab(page: Page, title: string): Promise<void> {
	await page
		.getByRole("button", { name: `Add to ${enUS.status.backlog}` })
		.click();
	await page.getByRole("textbox").first().fill(title);
	await page.getByRole("button", { name: enUS.board.add, exact: true }).click();
}

/**
 * Moves a card through `CardMenu › Move to › <column>`, then switches the
 * pane to the destination — the board stays where it was on purpose (see
 * `Board.tsx`), so the chip tap is how a person sees what happened.
 */
async function moveTo(
	page: Page,
	title: string,
	status: "next_up" | "execution" | "done",
): Promise<void> {
	const label = enUS.status[status];
	const anchor = page
		.locator(CARD, { hasText: title })
		.getByRole("button", { name: enUS.board.actions });
	await clickMenuItem(page, anchor, enUS.board.moveTo);
	await page.getByRole("menuitem", { name: label, exact: true }).click();
	await page.getByTestId("chip").filter({ hasText: label }).click();
	await expect(
		page.locator(columnSelector(status), { hasText: title }),
	).toBeVisible();
}

test("1: /projects shows the root board with the seeded cards", async ({
	page,
}) => {
	await gotoAndSettle(page, BOARD);

	// The board opens on its first column, where the seed's To do card sits.
	await expect(
		page.locator(columnSelector("backlog"), { hasText: "Renovera badrummet" }),
	).toBeVisible();
});

test("2: the FAB creates a card, and it lands in Backlog", async ({ page }) => {
	const title = `${PREFIX}fab card`;
	await gotoAndSettle(page, BOARD);

	await addCardFromFab(page, title);

	await expect(
		page.locator(columnSelector("backlog"), { hasText: title }),
	).toBeVisible();

	// On screen is Firestore's optimistic copy — this is the proof the write
	// itself landed, which only the backend can give.
	const id = await waitForNodeIdByTitle(title);
	await expect
		.poll(async () => (await nodeFields(id)).status, { timeout: 30_000 })
		.toBe("backlog");
});

test("3: a card moves through the four columns, completes into Done, and a reload keeps it", async ({
	page,
}) => {
	const title = `${PREFIX}walk`;
	await gotoAndSettle(page, BOARD);
	await addCardFromFab(page, title);

	// Backlog → Next up → Execution → Done. The last move is what completing
	// is: there is no separate complete control, Done is the completion.
	await moveTo(page, title, "next_up");
	await moveTo(page, title, "execution");
	await moveTo(page, title, "done");

	const id = await waitForNodeIdByTitle(title);
	await expect
		.poll(async () => (await nodeFields(id)).status, { timeout: 30_000 })
		.toBe("done");
	await expect
		.poll(async () => (await nodeFields(id)).completedAt, { timeout: 30_000 })
		.not.toBeNull();

	// A reload resets the board to its first column, so the card is found
	// where the app says it should be — not where the pane was left.
	await page.reload();
	await page.getByTestId("chip").filter({ hasText: enUS.status.done }).click();
	await expect(
		page.locator(columnSelector("done"), { hasText: title }),
	).toBeVisible();
});
