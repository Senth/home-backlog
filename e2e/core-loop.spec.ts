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
	deleteLabelsByTitlePrefix,
	deleteNodesByTitlePrefix,
	fillColumn,
	nodeFields,
	waitForLabelByTitle,
	waitForNodeIdByTitle,
} from "@/e2e/support/firestore";
import enUS from "@/i18n/locales/en-US.json";

/**
 * The Trello part, end to end and nothing else: the FAB, the four columns, and
 * a card completing into Done — with the reload claim from the old navigation
 * spec folded in at the end, and the labels a card carries (#100) on top. The
 * phone affordance is the card menu: drag is `DragArea.web.tsx` and belongs to
 * the desktop path, which the `writes` project never runs.
 *
 * What is deliberately *not* here: the rank arithmetic behind a move and the
 * `completedAt` bookkeeping are `data/nodes.ts` / `models/node.ts` unit
 * territory. This file proves the browser reaches them.
 */

const BOARD = ROUTES[1];
const CARD = cardSelector();

/** What every node this file creates is titled, so cleanup can find it. */
const PREFIX = "E2E core-loop ";

test.afterEach(async () => {
	await deleteNodesByTitlePrefix(PREFIX);
	await deleteLabelsByTitlePrefix(PREFIX);
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
 * The scrollable box inside a column pane — the `ScrollView` `BoardColumn`
 * renders — read the way the browser sees it. Found by shape rather than a
 * testID: it is the one descendant whose content overflows it, which is also
 * what makes a `null` answer here a failure worth naming.
 */
async function paneScroll(
	page: Page,
	status: string,
): Promise<{ scrollTop: number; atEnd: boolean } | null> {
	return page.evaluate((selector) => {
		const column = document.querySelector(selector);
		if (column === null) return null;
		const scroller = Array.from(column.querySelectorAll<HTMLElement>("*")).find(
			(el) => el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1,
		);
		if (scroller === undefined) return null;
		return {
			scrollTop: scroller.scrollTop,
			atEnd:
				scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2,
		};
	}, columnSelector(status));
}

/** Scrolls the pane to its last pixel, the way a reader parked there has. */
async function parkPaneAtEnd(page: Page, status: string): Promise<void> {
	await page.evaluate((selector) => {
		const column = document.querySelector(selector);
		const scroller = Array.from(
			column?.querySelectorAll<HTMLElement>("*") ?? [],
		).find(
			(el) => el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1,
		);
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	}, columnSelector(status));
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

/**
 * Labels end to end: two definitions created on the home — one from the
 * preset hues, one a custom color typed as a hex — and one of them applied
 * to a card through the picker. The definition read and the card write are
 * both settled by the backend, since the screen shows the optimistic copy.
 */
test("4: a home grows two labels, and a card carries one", async ({ page }) => {
	const presetTitle = `${PREFIX}preset`;
	const customTitle = `${PREFIX}custom`;

	await gotoAndSettle(page, ROUTES[0]);
	await page.getByRole("button", { name: "Manage Huset" }).click();
	await page.waitForURL(/\/homes\/[^/]+$/);
	await page.getByText(enUS.labels.title, { exact: true }).click();
	await page.waitForURL(/\/homes\/[^/]+\/labels$/);

	// One label from the preset hues — the swatch row the dialog opens on.
	await page.getByRole("button", { name: enUS.labels.newLabel }).click();
	await page.getByRole("textbox").fill(presetTitle);
	await page.getByRole("button", { name: enUS.labels.hue.red }).click();
	await page
		.getByRole("button", { name: enUS.labels.add, exact: true })
		.click();
	await expect(page.getByText(presetTitle)).toBeVisible();

	// One with a custom color, typed as a hex into the field the pencil
	// swatch opens. Stored exactly as picked; the clamp happens at draw time.
	await page.getByRole("button", { name: enUS.labels.newLabel }).click();
	await page.getByRole("textbox").fill(customTitle);
	await page.getByRole("button", { name: enUS.labels.customColor }).click();
	await page.getByRole("textbox").nth(1).fill("#3366cc");
	await page
		.getByRole("button", { name: enUS.labels.add, exact: true })
		.click();
	await expect(page.getByText(customTitle)).toBeVisible();

	const preset = await waitForLabelByTitle(presetTitle);
	const custom = await waitForLabelByTitle(customTitle);
	expect(custom.color).toBe("#3366cc");

	// And one lands on a real card, through the card menu's picker. The dot
	// this draws is judged by eye; what is proved here is that the write is
	// the one the model layer says it is.
	const title = `${PREFIX}labelled card`;
	await gotoAndSettle(page, BOARD);
	await addCardFromFab(page, title);

	const anchor = page
		.locator(CARD, { hasText: title })
		.getByRole("button", { name: enUS.board.actions });
	await clickMenuItem(page, anchor, enUS.board.labels);
	await page.getByRole("checkbox", { name: presetTitle }).click();
	// The picker is a bottom sheet now (#237): the scrim and Escape are the
	// dismissal, and the sheet carries no dismiss button of its own.
	await page.keyboard.press("Escape");

	const id = await waitForNodeIdByTitle(title);
	await expect
		.poll(async () => (await nodeFields(id)).labelIds, { timeout: 30_000 })
		.toContain(preset.id);
});

/**
 * #141: the pane's bottom padding follows the FAB, which rises while a
 * snackbar is up. Growing the padding is free; shrinking it back on dismiss
 * clamps a pane parked at its bottom, and the content slides. The raised
 * inset holds until the pane scrolls away from its end, so the dismissal
 * moves nothing.
 *
 * Lives in the `writes` project, not `craft` (#141's DoD names it): the claim
 * needs a column full enough to scroll, which only `fillColumn` can build,
 * and the read-only projects must not see a foreign card.
 */
test("5: dismissing the move snackbar does not move a column parked at its bottom", async ({
	page,
}) => {
	// The scroll room is bulk: `fillColumn` copies a stored node, and the copy
	// is refused by the rules the moment the app tries to move it — discovered
	// here as a PERMISSION_DENIED that rolled the move back. So the card that
	// moves is created the way a person creates one, through the FAB, which
	// sorts after the bulk and is the card a parked reader is looking at.
	await fillColumn("backlog", 10, `${PREFIX}card`);
	const title = `${PREFIX}fab card`;
	const movedTo = enUS.board.moved.replace("{{column}}", enUS.status.next_up);
	await gotoAndSettle(page, BOARD);
	await addCardFromFab(page, title);
	await expect(
		page.locator(columnSelector("backlog"), { hasText: title }),
	).toBeVisible();

	// A reader who has scrolled to the end of the column and stayed there.
	await parkPaneAtEnd(page, "backlog");
	await expect
		.poll(() => paneScroll(page, "backlog"))
		.toMatchObject({ atEnd: true });

	// Moving the last card puts a snackbar on screen: the FAB and the pane's
	// padding rise with it, and the card leaving the column clamps the parked
	// scroll onto the new bottom. From here until the dismissal the content
	// is still, which is what makes the two readings below comparable.
	const anchor = page
		.locator(CARD, { hasText: title })
		.getByRole("button", { name: enUS.board.actions });
	await clickMenuItem(page, anchor, enUS.board.moveTo);
	await page
		.getByRole("menuitem", { name: enUS.status.next_up, exact: true })
		.click();
	await expect(
		page.locator(columnSelector("backlog"), { hasText: title }),
	).toHaveCount(0);
	// The write stuck, not merely the leaving: a move the rules refuse rolls
	// back into the source column, and the hidden destination pane renders
	// `noCards` by design, so the backend is the only witness both ways.
	const id = await waitForNodeIdByTitle(title);
	await expect
		.poll(async () => (await nodeFields(id)).status, { timeout: 30_000 })
		.toBe("next_up");
	await expect
		.poll(() => paneScroll(page, "backlog"))
		.toMatchObject({ atEnd: true });
	await page.waitForTimeout(500);
	// Still up: if Paper's four seconds ran out while the reads above ran,
	// the pane below was read after the dismissal and the claim proves
	// nothing.
	await expect(page.getByText(movedTo)).toBeVisible();
	const raised = await paneScroll(page, "backlog");
	expect(
		raised,
		"the pane does not scroll — its column is too short",
	).not.toBeNull();

	// The dismissal the claim is about is the snackbar's own — pressing Undo
	// would return the card and grow the column back, which cannot slide.
	await expect(page.getByText(movedTo)).toBeHidden({ timeout: 10_000 });
	const dismissed = await paneScroll(page, "backlog");

	expect(
		Math.abs((dismissed?.scrollTop ?? NaN) - (raised?.scrollTop ?? NaN)),
		`the pane moved on dismiss: ${raised?.scrollTop} → ${dismissed?.scrollTop}`,
	).toBeLessThanOrEqual(1);
});
