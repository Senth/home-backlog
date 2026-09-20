import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
	cardSelector,
	clickMenuItem,
	columnSelector,
	gotoAndSettle,
	ROUTES,
} from "@/e2e/support/app";
import {
	createFixtureNode,
	deleteNodesByTitlePrefix,
	memberUid,
	nodeFields,
} from "@/e2e/support/firestore";
import enUS from "@/i18n/locales/en-US.json";

/**
 * The thing `PROJECT.md` says Trello lacks: a card is a board, at any depth,
 * and the tree can be re-shaped after the fact. Opening, the breadcrumb trail
 * and browser back, re-parenting through `Move under…`, promoting with
 * `Top level`, and a deep link into the middle of the tree — the claims the
 * old navigation spec made about routes, made about *nested* ones.
 *
 * The tree is built with `createFixtureNode` straight past the UI, the same
 * trade `details.spec.ts` makes: the claim is what the browser does with a
 * tree that exists, not how a tree gets built (the FAB path is `core-loop`'s).
 * `reparentNode`'s refusals — under itself, visibility mismatches — are
 * `data/nodes.test.ts` territory; this file proves the browser reaches the
 * writes that are allowed.
 *
 * Browser back is asserted against the trail of *taps*, which push boards onto
 * the history. Breadcrumb navigation is `router.dismissTo`, which replaces
 * rather than pushes — walking crumbs up and then pressing back leaves the app
 * instead of retracing the walk — so the crumbs are proven by where each tap
 * lands, and back is proven where history actually exists.
 */

const BOARD = ROUTES[1];
const CARD = cardSelector();

/** What every node this file creates is titled, so cleanup can find it. */
const PREFIX = "E2E nesting ";

const COLUMNS = ["backlog", "next_up", "execution", "done"];

test.afterEach(async () => {
	await deleteNodesByTitlePrefix(PREFIX);
});

/**
 * One subtree: root › child › grandchild, all shared, all on Backlog.
 * `childCount` is the stored fact a tap reads (`hasSteps`), so a node with a
 * child opens as a board and one without opens as details.
 *
 * The ranks are real order keys, not any old sorted string. The app computes
 * its next rank with `rankAtEnd` over the last card it can see — a fixture
 * rank outside `BASE_62_DIGITS` (the seed's ranks are uppercase-led, like
 * `V0`) would crash the very writes this spec drives. The same trap
 * `e2e/support/firestore.ts` records for `fillColumn`.
 */
async function createTree(): Promise<{
	rootId: string;
	childId: string;
	grandchildId: string;
}> {
	const marcus = await memberUid("Marcus");
	const root = {
		visibility: "shared",
		participantIds: [marcus],
		assigneeIds: [],
		status: "backlog",
		columns: COLUMNS,
	};
	const step = { ...root, participantIds: [] };

	const rootId = await createFixtureNode({
		title: `${PREFIX}root`,
		parentId: null,
		ancestorIds: [],
		childCount: 1,
		doneCount: 0,
		rank: "V1",
		...root,
	});
	const childId = await createFixtureNode({
		title: `${PREFIX}child`,
		parentId: rootId,
		ancestorIds: [rootId],
		childCount: 1,
		doneCount: 0,
		rank: "V2",
		...step,
	});
	const grandchildId = await createFixtureNode({
		title: `${PREFIX}grandchild`,
		parentId: childId,
		ancestorIds: [rootId, childId],
		childCount: 0,
		doneCount: 0,
		rank: "V3",
		...step,
	});

	return { rootId, childId, grandchildId };
}

/** A node's own board, reached directly rather than by clicking a card. */
async function openBoard(
	page: Page,
	nodeId: string,
	readyText: string,
): Promise<void> {
	await page.goto(`/projects/${nodeId}`);
	await page.waitForLoadState("networkidle");
	await expect(page.getByText(readyText).first()).toBeVisible({
		timeout: 30_000,
	});
}

test("1: opening a card with steps opens it as its own board", async ({
	page,
}) => {
	const { rootId } = await createTree();
	await gotoAndSettle(page, BOARD);

	await page.locator(CARD, { hasText: `${PREFIX}root` }).click();

	await page.waitForURL(new RegExp(`/projects/${rootId}$`), {
		timeout: 30_000,
	});
	await expect(
		page.locator(columnSelector("backlog"), { hasText: `${PREFIX}child` }),
	).toBeVisible();
});

test("2: breadcrumbs walk back up, and browser back agrees with the taps", async ({
	page,
}) => {
	const { rootId, childId, grandchildId } = await createTree();

	// Down by taps: root → child. Each tap pushes a board, so the browser's
	// own back button retraces exactly what the taps did.
	await gotoAndSettle(page, BOARD);
	await page.locator(CARD, { hasText: `${PREFIX}root` }).click();
	await page.waitForURL(new RegExp(`/projects/${rootId}$`), {
		timeout: 30_000,
	});
	await page.locator(CARD, { hasText: `${PREFIX}child` }).click();
	await page.waitForURL(new RegExp(`/projects/${childId}$`), {
		timeout: 30_000,
	});

	await page.goBack();
	await page.waitForURL(new RegExp(`/projects/${rootId}$`), {
		timeout: 30_000,
	});
	await expect(page.locator(CARD, { hasText: `${PREFIX}child` })).toBeVisible();

	// And the crumbs walk back up from a board reached directly — the way a
	// deep link, a reload or a shared link arrives. Crumb navigation is
	// `dismissTo`, which replaces rather than pushes, so the walk is proven by
	// where each crumb lands, never by where back goes afterwards.
	await openBoard(page, grandchildId, `${PREFIX}grandchild`);
	await page.getByRole("button", { name: `${PREFIX}child` }).click();
	await page.waitForURL(new RegExp(`/projects/${childId}$`), {
		timeout: 30_000,
	});
	await expect(
		page.locator(CARD, { hasText: `${PREFIX}grandchild` }),
	).toBeVisible();

	await page.getByRole("button", { name: `${PREFIX}root` }).click();
	await page.waitForURL(new RegExp(`/projects/${rootId}$`), {
		timeout: 30_000,
	});
	await expect(page.locator(CARD, { hasText: `${PREFIX}child` })).toBeVisible();

	await page.getByRole("button", { name: enUS.board.root }).click();
	await page.waitForURL((url) => url.pathname === "/projects", {
		timeout: 30_000,
	});
});

test("3: Move under… re-parents a card onto another board", async ({
	page,
}) => {
	const marcus = await memberUid("Marcus");
	const hostId = await createFixtureNode({
		title: `${PREFIX}new home`,
		parentId: null,
		ancestorIds: [],
		childCount: 0,
		doneCount: 0,
		rank: "V1",
		visibility: "shared",
		participantIds: [marcus],
		assigneeIds: [],
		status: "backlog",
		columns: COLUMNS,
	});
	const cardId = await createFixtureNode({
		title: `${PREFIX}wanderer`,
		parentId: null,
		ancestorIds: [],
		childCount: 0,
		doneCount: 0,
		rank: "V4",
		visibility: "shared",
		participantIds: [marcus],
		assigneeIds: [],
		status: "backlog",
		columns: COLUMNS,
	});

	await gotoAndSettle(page, BOARD);
	const anchor = page
		.locator(CARD, { hasText: `${PREFIX}wanderer` })
		.getByRole("button", { name: enUS.board.actions });
	await clickMenuItem(page, anchor, enUS.board.moveUnder);
	await page.getByRole("menuitem", { name: `${PREFIX}new home` }).click();

	// The move reads the server (`reparentNode`), so on-screen can lag the
	// write — settle on the backend before judging either board.
	await expect
		.poll(async () => (await nodeFields(cardId)).parentId, { timeout: 30_000 })
		.toBe(hostId);

	// Gone from the old board — the root — once a fresh load says so.
	await page.reload();
	await expect(
		page.locator(CARD, { hasText: `${PREFIX}wanderer` }),
	).toHaveCount(0);

	// And sitting on the new one.
	await openBoard(page, hostId, `${PREFIX}new home`);
	await expect(
		page.locator(columnSelector("backlog"), { hasText: `${PREFIX}wanderer` }),
	).toBeVisible();
});

test("4: promoting a step to Top level makes it a root on /projects", async ({
	page,
}) => {
	const { rootId, childId } = await createTree();
	await openBoard(page, rootId, `${PREFIX}root`);

	const anchor = page
		.locator(CARD, { hasText: `${PREFIX}child` })
		.getByRole("button", { name: enUS.board.actions });
	await clickMenuItem(page, anchor, enUS.board.moveUnder);
	await page.getByRole("menuitem", { name: enUS.board.moveUnderTop }).click();

	await expect
		.poll(async () => (await nodeFields(childId)).parentId, { timeout: 30_000 })
		.toBeNull();

	await gotoAndSettle(page, BOARD);
	await expect(
		page.locator(columnSelector("backlog"), { hasText: `${PREFIX}child` }),
	).toBeVisible();
});

test("5: a deep link straight to a nested board lands on that board", async ({
	page,
}) => {
	const { grandchildId } = await createTree();
	await openBoard(page, grandchildId, `${PREFIX}grandchild`);

	// The full trail is on screen, root first, and the board itself is the
	// grandchild's own — empty, and saying so like any board would (#310, per
	// column rather than once above them all).
	await expect(
		page.getByRole("button", { name: `${PREFIX}root` }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: `${PREFIX}child` }),
	).toBeVisible();
	await expect(
		page
			.locator(columnSelector("backlog"))
			.getByText(enUS.board.columnEmpty, { exact: true }),
	).toBeVisible();
});
