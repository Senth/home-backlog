import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { clickMenuItem, gotoAndSettle, ROUTES } from "@/e2e/support/app";
import {
	createFixtureNode,
	deleteNodesByTitlePrefix,
	memberUid,
	nodeFields,
	waitForNodeIdByTitle,
} from "@/e2e/support/firestore";
import enUS from "@/i18n/locales/en-US.json";
import { toCalendarDay } from "@/models/due-date";

/**
 * One walk over the details screen — every control on it, writing on the
 * spot and surviving a reload — and the waiting-on section, folded in from
 * the old `blocked-by.spec.ts` as one claim.
 *
 * What is deliberately *not* here: the people bookkeeping (inheritance,
 * promotion permutations, the stale-assignee sentence) — `data/nodes.test.ts`
 * owns those rules and `nesting.spec.ts` proves the browser reaches
 * re-parenting — and the offline blocker queue and the cross-board search,
 * which were dropped with #201 as hand-check territory.
 */

const BOARD = ROUTES[1];
const CARD = '[data-testid="card-container"]';

/** What every node this file creates is titled, so cleanup can find it. */
const PREFIX = "E2E details ";

test.afterEach(async () => {
	await deleteNodesByTitlePrefix(PREFIX);
});

/** Adds a card to the first column of the root board. */
async function addCard(page: Page, title: string): Promise<void> {
	await page
		.getByRole("button", { name: `Add to ${enUS.status.backlog}` })
		.click();
	await page.getByRole("textbox").first().fill(title);
	await page.getByRole("button", { name: enUS.board.add, exact: true }).click();
	await expect(page.getByText(title)).toBeVisible();
}

/** A shared root card of the seeded home, by title. */
async function newRootCard(title: string): Promise<string> {
	const marcus = await memberUid("Marcus");
	return createFixtureNode({
		title,
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [marcus],
		status: "backlog",
	});
}

/** The waiting mark on a card face. */
function markOf(card: Locator): Locator {
	return card.getByText(enUS.board.blocked, { exact: true });
}

test("1: every control on the details screen writes on the spot, and a reload puts every value back", async ({
	page,
}) => {
	const title = `${PREFIX}walk`;
	const renamed = `${PREFIX}walk renamed`;
	const notesText = "Acetyl fog, do not sand";
	const stepTitle = `${PREFIX}walk step`;

	await gotoAndSettle(page, BOARD);
	await addCard(page, title);
	await page.getByText(title).click();
	await page.waitForURL(/\/projects\/[^/]+\/details$/);
	const nodeId = new URL(page.url()).pathname.split("/")[2] as string;

	// Due date: the picker mounts only while open, and its days carry the
	// library's own test ids — the month in the id is `getMonth()`, 0-based.
	const picked = new Date();
	await page.getByRole("button", { name: enUS.detail.addDate }).click();
	await page
		.getByTestId(
			`react-native-paper-dates-day-${picked.getFullYear()}-${picked.getMonth()}-15`,
		)
		.click();
	await page.getByTestId("react-native-paper-dates-save").click();
	await expect
		.poll(
			async () =>
				(await nodeFields(nodeId)).dueDate ===
				toCalendarDay(new Date(picked.getFullYear(), picked.getMonth(), 15)),
			{ timeout: 30_000 },
		)
		.toBe(true);

	// Priority and effort: tapping the chip is the whole acknowledgement.
	await page.getByRole("button", { name: enUS.priority.high }).click();
	await expect
		.poll(async () => (await nodeFields(nodeId)).priority, { timeout: 30_000 })
		.toBe("high");
	await page.getByRole("button", { name: enUS.effort.evening }).click();
	await expect
		.poll(async () => (await nodeFields(nodeId)).effort, { timeout: 30_000 })
		.toBe("evening");

	// Notes save themselves after a pause in typing; the Saved line is the
	// field's own acknowledgement that a write happened. The note reads as
	// text on arrival (#237), so the pencil opens the editor first.
	await page.getByRole("button", { name: enUS.detail.notesEdit }).click();
	await page.getByPlaceholder(enUS.detail.notesPlaceholder).fill(notesText);
	await expect(page.getByText(/^Saved /)).toBeVisible({ timeout: 30_000 });
	await expect
		.poll(async () => (await nodeFields(nodeId)).notes, { timeout: 30_000 })
		.toBe(notesText);

	// A step, added from the screen it belongs to.
	await page.getByRole("button", { name: enUS.detail.addStep }).click();
	await page.getByRole("textbox").last().fill(stepTitle);
	await page.getByRole("button", { name: enUS.board.add, exact: true }).click();
	await expect(page.getByText(stepTitle)).toBeVisible();
	await waitForNodeIdByTitle(stepTitle);

	// Participants are the whole household on a fresh project; taking one off
	// is the write. The participants row renders before the assignees row, so
	// `.first()` is the participants checkbox.
	await page.getByRole("checkbox", { name: "Anna Maria Berg" }).first().click();
	await expect
		.poll(async () => (await nodeFields(nodeId)).participantIds, {
			timeout: 30_000,
		})
		.toEqual([await memberUid("Marcus")]);

	// Visibility asks before it changes: the flip rewrites the whole subtree,
	// server-checked, which is why the write takes a moment to land.
	await page
		.getByRole("button", { name: enUS.detail.visibilityPrivate })
		.click();
	await page
		.getByRole("button", { name: enUS.visibility.confirmAction })
		.click();
	await expect
		.poll(async () => (await nodeFields(nodeId)).visibility, {
			timeout: 30_000,
		})
		.toBe("private");

	// Rename from the app bar menu. The notes field reads as text now, so the
	// dialog's textbox is the only one on the screen — `.last()` still lands
	// on it.
	await clickMenuItem(
		page,
		page.getByRole("button", { name: enUS.board.actions }),
		enUS.board.rename,
	);
	await page.getByRole("textbox").last().fill(renamed);
	// Scoped to the dialog: the card's pencil on the face names itself Rename
	// too (#237), so an unscoped match would find two buttons.
	await page
		.getByTestId(`rename-details-${nodeId}-surface`)
		.getByRole("button", { name: enUS.board.rename, exact: true })
		.click();
	await expect(page.getByText(renamed).first()).toBeVisible();

	// The reload is the second half of the claim: every value comes back from
	// the server, not from the local cache.
	await page.reload();
	await expect(page.getByText(renamed).first()).toBeVisible({
		timeout: 30_000,
	});
	await expect(
		page.getByRole("button", { name: enUS.detail.clear }),
	).toBeVisible();
	// A selected chip says so in style, not in the DOM — `aria-pressed` lands
	// on Paper's outer surface and never reaches the button a person taps. Its
	// own tap semantics are the proof instead: tapping the selected value
	// clears it, so the toggle is what tells the reload kept the value.
	await page.getByRole("button", { name: enUS.priority.high }).click();
	await expect
		.poll(async () => (await nodeFields(nodeId)).priority, { timeout: 30_000 })
		.toBeNull();
	await page.getByRole("button", { name: enUS.effort.evening }).click();
	await expect
		.poll(async () => (await nodeFields(nodeId)).effort, { timeout: 30_000 })
		.toBeNull();
	await page.getByRole("button", { name: enUS.detail.notesEdit }).click();
	await expect(page.getByPlaceholder(enUS.detail.notesPlaceholder)).toHaveValue(
		notesText,
	);
	await expect(page.getByText(stepTitle)).toBeVisible();
	await expect(
		page.getByRole("checkbox", { name: "Anna Maria Berg" }).first(),
	).toHaveAttribute("aria-checked", "false");
	// A private root says so in the participants label, and locks its own row.
	await expect(page.getByText(enUS.detail.participantsPrivate)).toBeVisible();
	await expect(
		page.getByRole("checkbox", { name: "Marcus" }).first(),
	).toHaveAttribute("aria-disabled", "true");
});

test("2: marking a card waiting lists the blocker on the details screen, completing the blocker clears the mark live, and Stop waiting on removes the row", async ({
	page,
}) => {
	const waiterTitle = `${PREFIX}paint the wall`;
	const blockerTitle = `${PREFIX}order paint`;
	await newRootCard(blockerTitle);
	const waiterId = await newRootCard(waiterTitle);

	await gotoAndSettle(page, BOARD);
	const waiter = page.locator(CARD, { hasText: waiterTitle });
	await expect(waiter).toBeVisible({ timeout: 30_000 });
	await expect(markOf(waiter)).toHaveCount(0);

	// Mark it: `CardMenu › Waiting on… › <blocker>`, both cards on this board.
	await clickMenuItem(
		page,
		waiter.getByRole("button", { name: enUS.board.actions }),
		enUS.board.waitingOn,
	);
	await page.getByRole("menuitem", { name: blockerTitle }).click();
	await expect(markOf(waiter)).toBeVisible({ timeout: 30_000 });
	await page.keyboard.press("Escape");
	await expect(page.getByRole("menuitem", { name: blockerTitle })).toBeHidden();

	// The details screen lists the blocker by title.
	await waiter.getByText(waiterTitle).click();
	await page.waitForURL(/\/projects\/[^/]+\/details$/);
	await expect(page.getByText(blockerTitle, { exact: true })).toBeVisible();

	// Completing the blocker from the board — no reload anywhere — clears the
	// mark, because the mark derives from the blocker's own status.
	await page.goBack();
	await expect(waiter).toBeVisible({ timeout: 30_000 });
	await clickMenuItem(
		page,
		page
			.locator(CARD, { hasText: blockerTitle })
			.getByRole("button", { name: enUS.board.actions }),
		enUS.board.moveTo,
	);
	await page.getByRole("menuitem", { name: enUS.status.done }).click();
	await expect(markOf(waiter)).toHaveCount(0, { timeout: 30_000 });

	// The row says what happened to it, and stopping is what ends the wait —
	// nothing about completing the blocker removed the entry itself.
	await waiter.getByText(waiterTitle).click();
	await page.waitForURL(/\/projects\/[^/]+\/details$/);
	await expect(
		page.getByText(enUS.detail.blockerDone, { exact: true }),
	).toBeVisible();
	await page
		.getByRole("button", {
			name: enUS.detail.stopWaitingOn.replace("{{title}}", blockerTitle),
		})
		.click();
	await expect(page.getByText(blockerTitle, { exact: true })).toHaveCount(0);
	await expect
		.poll(async () => (await nodeFields(waiterId)).blockedBy, {
			timeout: 30_000,
		})
		.toEqual([]);
});
