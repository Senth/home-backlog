import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
	clickMenuItem,
	gotoAndSettle,
	ROUTES,
	VIEWPORTS,
} from "@/e2e/support/app";
import {
	createFixtureNode,
	deleteNodesByTitlePrefix,
	memberUid,
	nodeFields,
} from "@/e2e/support/firestore";
import enUS from "@/i18n/locales/en-US.json";

/**
 * The blocked-by claims from #66 — `docs/specs/wip/66-blocked-by.md`'s
 * Acceptance section, claims 1–8. Claims 9–10 are `[eye]` and belong to
 * `browser-review`, not here.
 *
 * A card waits on other cards through `blockedBy[]`; the mark derives from
 * the blockers' own statuses (`unresolvedBlockers`), so a done blocker stops
 * holding its dependents and a missing one — a deleted card — keeps holding
 * them. Nothing auto-clears an entry: only *Stop waiting on* does.
 *
 * **Pinned to phone width**, like `board.spec.ts` and `details.spec.ts`:
 * these are behaviour claims about one card at a time, not about a layout
 * that changes above `compactBreakpoint`.
 *
 * The cards are fixtures built by `createFixtureNode` — the picker's search
 * needs a card that is genuinely on *another* board, and a waiting card
 * seeded straight into `blockedBy` keeps the later claims about that card's
 * reaction rather than about the picking UI, which claims 1 and 2 already
 * walk. Every title carries the `PREFIX`, and `afterEach` sweeps it.
 */

test.use({ viewport: VIEWPORTS.phone });

const BOARD = ROUTES[1];
const CARD = '[data-testid="card-container"]';

/** What every node this file creates is titled, so cleanup can find it. */
const PREFIX = "E2E blocked ";

/** The face mark's word, and the two words a blocker's state can say. */
const WAITING = enUS.board.blocked;
const DONE_CHIP = enUS.detail.blockerDone;
const GONE = enUS.detail.blockerGone;

/**
 * The Done strip chip — the frozen column order is To do, Next up, In
 * progress, Done, the same index `board.spec.ts` reads In progress from.
 */
const DONE_COLUMN = 3;

test.afterEach(async () => {
	await deleteNodesByTitlePrefix(PREFIX);
});

/** A shared root card of the seeded home, by title — the root board's cards. */
async function newCard(
	title: string,
	overrides: Record<string, unknown> = {},
): Promise<string> {
	const marcus = await memberUid("Marcus");
	return createFixtureNode({
		title,
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [marcus],
		status: "backlog",
		archived: false,
		completedAt: null,
		...overrides,
	});
}

/** The waiting mark on a card, for one blocker. */
function markOf(card: Locator): Locator {
	return card.getByText(WAITING, { exact: true });
}

/** Opens the card's menu and steps into its *Waiting on…* page. */
async function openWaitingPage(page: Page, cardTitle: string): Promise<void> {
	const anchor = page
		.locator(CARD, { hasText: cardTitle })
		.getByRole("button", { name: enUS.board.actions });
	await clickMenuItem(page, anchor, enUS.board.waitingOn);
}

/** Moves a root card through `CardMenu › Move to › <column>`. */
async function moveTo(
	page: Page,
	cardTitle: string,
	columnLabel: string,
): Promise<void> {
	const anchor = page
		.locator(CARD, { hasText: cardTitle })
		.getByRole("button", { name: enUS.board.actions });
	await clickMenuItem(page, anchor, enUS.board.moveTo);
	await page.getByRole("menuitem", { name: columnLabel }).click();
}

/** A node's own details, reached directly rather than by clicking a card. */
async function openDetails(
	page: Page,
	nodeId: string,
	title: string,
): Promise<void> {
	await page.goto(`/projects/${nodeId}/details`);
	await page.waitForLoadState("networkidle");
	await expect(page.getByText(title).first()).toBeVisible({
		timeout: 30_000,
	});
}

test("1: picking cards on the same board from the card menu marks the card Waiting, counts a second blocker, and lists both titles on the details screen", async ({
	page,
}) => {
	const waiterTitle = `${PREFIX}the wall`;
	const first = `${PREFIX}order tiles`;
	const second = `${PREFIX}order grout`;
	const firstId = await newCard(first);
	const secondId = await newCard(second);
	const waiterId = await newCard(waiterTitle);

	await gotoAndSettle(page, BOARD);
	const waiter = page.locator(CARD, { hasText: waiterTitle });
	await expect(waiter).toBeVisible({ timeout: 30_000 });
	await expect(markOf(waiter)).toHaveCount(0);

	await openWaitingPage(page, waiterTitle);
	await page.getByRole("menuitem", { name: first }).click();
	// The menu stays open — picking the second blocker is a tap in the same page.
	await expect(markOf(waiter)).toBeVisible();

	await page.getByRole("menuitem", { name: second }).click();
	await expect(waiter.getByText(`${WAITING} · 2`)).toBeVisible();

	// Out of the menu, and into the details the titles are listed on.
	await page.keyboard.press("Escape");
	await expect(page.getByRole("menuitem", { name: second })).toBeHidden();
	await waiter.getByText(waiterTitle).click();
	await page.waitForURL(/\/projects\/[^/]+\/details$/);
	await expect(page.getByText(first)).toBeVisible();
	await expect(page.getByText(second)).toBeVisible();

	// And the write behind both taps reached the document, in pick order.
	await expect
		.poll(async () => (await nodeFields(waiterId)).blockedBy, {
			timeout: 30_000,
		})
		.toEqual([firstId, secondId]);
});

test("2: finding a card on another board through Search everywhere… marks the card Waiting and its title appears on the details screen", async ({
	page,
}) => {
	const waiterTitle = `${PREFIX}stain benches`;
	const childTitle = `${PREFIX}replace pane`;
	// A throwaway board one level up, so the blocker is genuinely cross-board:
	// not a child of the root board's parent, so no card on `/projects` carries it.
	const otherBoard = await newCard(`${PREFIX}greenhouse board`);
	const childId = await newCard(childTitle, {
		parentId: otherBoard,
		ancestorIds: [otherBoard],
	});
	const waiterId = await newCard(waiterTitle);

	await gotoAndSettle(page, BOARD);
	const waiter = page.locator(CARD, { hasText: waiterTitle });
	await expect(waiter).toBeVisible({ timeout: 30_000 });

	await openWaitingPage(page, waiterTitle);
	await page.getByRole("menuitem", { name: enUS.board.waitingSearch }).click();
	await page.getByRole("textbox").last().fill("pane");
	const result = page.getByRole("checkbox", { name: childTitle });
	await expect(result).toBeVisible({ timeout: 30_000 });
	await result.click();

	// Picking closes the dialog, and the cross-board mark arrives through the
	// board's own watcher rather than from a card on screen.
	await expect(markOf(waiter)).toBeVisible({ timeout: 30_000 });

	await waiter.getByText(waiterTitle).click();
	await page.waitForURL(/\/projects\/[^/]+\/details$/);
	await expect(page.getByText(childTitle)).toBeVisible();
	await expect
		.poll(async () => (await nodeFields(waiterId)).blockedBy, {
			timeout: 30_000,
		})
		.toContain(childId);
});

test("3: completing the blocker clears the waiting mark and its details row shows Done without a reload, and reopening the blocker brings the mark back", async ({
	page,
}) => {
	const waiterTitle = `${PREFIX}lay tiles`;
	const blockerTitle = `${PREFIX}order tiles`;
	const blockerId = await newCard(blockerTitle);
	await newCard(waiterTitle, { blockedBy: [blockerId] });

	await gotoAndSettle(page, BOARD);
	const waiter = page.locator(CARD, { hasText: waiterTitle });
	await expect(markOf(waiter)).toBeVisible({ timeout: 30_000 });

	// Complete the blocker from its own card menu, staying on the page.
	await moveTo(page, blockerTitle, enUS.status.done);
	await expect(markOf(waiter)).toHaveCount(0, { timeout: 30_000 });

	// The details row says what happened to it — no reload in between.
	await waiter.getByText(waiterTitle).click();
	await page.waitForURL(/\/projects\/[^/]+\/details$/);
	await expect(page.getByText(DONE_CHIP, { exact: true })).toBeVisible();
	await expect(
		page.getByRole("button", { name: `Stop waiting on ${blockerTitle}` }),
	).toBeVisible();

	// Reopen the blocker: out of Done, and the mark comes back with it.
	await page.goBack();
	await page.getByTestId("chip").nth(DONE_COLUMN).click();
	await moveTo(page, blockerTitle, enUS.status.backlog);
	await page.getByTestId("chip").first().click();
	await expect(markOf(waiter)).toBeVisible({ timeout: 30_000 });
});

test("4: Stop waiting on removes the row, and the mark goes when the last blocker goes", async ({
	page,
}) => {
	const waiterTitle = `${PREFIX}seal grout`;
	const blockerTitle = `${PREFIX}order grout`;
	const blockerId = await newCard(blockerTitle);
	const waiterId = await newCard(waiterTitle, { blockedBy: [blockerId] });

	await openDetails(page, waiterId, waiterTitle);
	const stop = page.getByRole("button", {
		name: `Stop waiting on ${blockerTitle}`,
	});
	await expect(stop).toBeVisible();
	await stop.click();

	// The row is gone from the section, and the write is in the document.
	await expect(page.getByText(blockerTitle)).toHaveCount(0);
	await expect
		.poll(async () => (await nodeFields(waiterId)).blockedBy, {
			timeout: 30_000,
		})
		.toEqual([]);

	// The last blocker gone is the mark gone, on the board.
	await gotoAndSettle(page, BOARD);
	const waiter = page.locator(CARD, { hasText: waiterTitle });
	await expect(waiter).toBeVisible({ timeout: 30_000 });
	await expect(markOf(waiter)).toHaveCount(0);
});

test("5: completing a waiting card keeps its blockedBy in the document and shows no mark in the Done column", async ({
	page,
}) => {
	const waiterTitle = `${PREFIX}hang door`;
	const blockerTitle = `${PREFIX}buy hinges`;
	const blockerId = await newCard(blockerTitle);
	const waiterId = await newCard(waiterTitle, { blockedBy: [blockerId] });

	await gotoAndSettle(page, BOARD);
	const waiter = page.locator(CARD, { hasText: waiterTitle });
	await expect(markOf(waiter)).toBeVisible({ timeout: 30_000 });

	// Completing the *waiting* card, not its blocker.
	await moveTo(page, waiterTitle, enUS.status.done);

	// In Done the list is inert history: nothing removes it, nothing reads it.
	await expect
		.poll(async () => (await nodeFields(waiterId)).blockedBy, {
			timeout: 30_000,
		})
		.toEqual([blockerId]);

	await page.getByTestId("chip").nth(DONE_COLUMN).click();
	await expect(waiter).toBeVisible({ timeout: 30_000 });
	await expect(markOf(waiter)).toHaveCount(0);
});

test("6: deleting a blocker leaves its row saying the card is gone, with the remove action working, and the mark stays until the row is removed", async ({
	page,
}) => {
	const waiterTitle = `${PREFIX}fit skirting`;
	const blockerTitle = `${PREFIX}cut skirting`;
	// The blocker is deleted before the waiter is built: the id in `blockedBy`
	// points at a card that no longer exists, which is exactly the state a
	// deletion behind the app's back leaves behind.
	const blockerId = await newCard(blockerTitle);
	await deleteNodesByTitlePrefix(blockerTitle);
	const waiterId = await newCard(waiterTitle, { blockedBy: [blockerId] });

	await gotoAndSettle(page, BOARD);
	const waiter = page.locator(CARD, { hasText: waiterTitle });
	await expect(waiter).toBeVisible({ timeout: 30_000 });
	// A missing blocker still holds the card — the honest *not yet*.
	await expect(markOf(waiter)).toBeVisible({ timeout: 30_000 });

	await openDetails(page, waiterId, waiterTitle);
	await expect(page.getByText(GONE)).toBeVisible();
	const stop = page.getByRole("button", {
		name: enUS.detail.stopWaitingOnGone,
	});
	await expect(stop).toBeVisible();
	await stop.click();

	// Removing the row is what ends the wait — nothing else did.
	await expect(page.getByText(GONE)).toHaveCount(0);
	await gotoAndSettle(page, BOARD);
	await expect(waiter).toBeVisible({ timeout: 30_000 });
	await expect(markOf(waiter)).toHaveCount(0);
});

test("7: picking a same-board blocker offline queues the write and lands it when the connection returns", async ({
	page,
	context,
}) => {
	const waiterTitle = `${PREFIX}paint fence offline`;
	const blockerTitle = `${PREFIX}buy paint offline`;
	const blockerId = await newCard(blockerTitle);
	const waiterId = await newCard(waiterTitle);

	await gotoAndSettle(page, BOARD);
	const waiter = page.locator(CARD, { hasText: waiterTitle });
	await expect(waiter).toBeVisible({ timeout: 30_000 });

	await context.setOffline(true);
	await openWaitingPage(page, waiterTitle);
	await page.getByRole("menuitem", { name: blockerTitle }).click();

	// Optimistic, from the local cache, the same as every queued write.
	await expect(markOf(waiter)).toBeVisible({ timeout: 30_000 });

	await context.setOffline(false);
	await page.reload();
	await expect(page.getByText(waiterTitle).first()).toBeVisible({
		timeout: 30_000,
	});

	// The one that cannot be faked by the cache: the queued write reached
	// Firestore.
	await expect
		.poll(async () => (await nodeFields(waiterId)).blockedBy, {
			timeout: 30_000,
			message: `the offline pick never reached Firestore — it was queued and lost`,
		})
		.toContain(blockerId);
	await gotoAndSettle(page, BOARD);
	const waiterAgain = page.locator(CARD, { hasText: waiterTitle });
	await expect(waiterAgain).toBeVisible({ timeout: 30_000 });
	await expect(markOf(waiterAgain)).toBeVisible();
});

test("8: a blocked project shows the waiting mark on Overview", async ({
	page,
}) => {
	const waiterTitle = `${PREFIX}reno overview`;
	const blockerTitle = `${PREFIX}quote overview`;
	const blockerId = await newCard(blockerTitle);
	// In progress, so the project is an Ongoing projects row; its blocker is a
	// root too, so Overview already holds its status in the map it hands the rows.
	await newCard(waiterTitle, {
		status: "execution",
		blockedBy: [blockerId],
	});

	await page.goto("/overview");
	await page.waitForLoadState("networkidle");
	await page
		.getByRole("button", { name: enUS.overview.add })
		.waitFor({ state: "visible", timeout: 30_000 });
	expect(new URL(page.url()).pathname, "did not land on /overview").toBe(
		"/overview",
	);

	const ongoing = page.getByTestId("overview-section-ongoing");
	await expect(ongoing.getByText(waiterTitle, { exact: true })).toBeVisible({
		timeout: 30_000,
	});
	const chip = ongoing.getByText(WAITING, { exact: true });
	await expect(chip).toBeVisible();
	await expect(chip).toHaveAttribute(
		"aria-label",
		enUS.board.waitingLabel_one.replace("{{count}}", "1"),
	);
});
