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
 * spot and surviving a reload — and the waiting-on row, folded in from
 * the old `blocked-by.spec.ts` as one claim.
 *
 * Every field is a row that opens today's editor in a bottom sheet (#237),
 * so the walk opens sheets as it goes and scopes each assertion to that
 * sheet's surface: the screen behind an open sheet stays in the DOM.
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

/** Adds a card to the first column of the board on screen. */
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

	// Due date: the row opens the sheet, the picker mounts only while open,
	// and its days carry the library's own test ids — the month in the id is
	// `getMonth()`, 0-based.
	const picked = new Date();
	await page.getByRole("button", { name: enUS.detail.dueDate }).click();
	await page
		.getByTestId(`editor-due-${nodeId}-surface`)
		.getByRole("button", { name: enUS.detail.addDate })
		.click();
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
	await page.keyboard.press("Escape");

	// Priority and effort: the row opens its sheet, tapping the chip is the
	// whole acknowledgement. The chip taps are scoped to the sheet — the row
	// behind it carries the same words.
	await page.getByRole("button", { name: enUS.detail.priority }).click();
	await page
		.getByTestId(`editor-priority-${nodeId}-surface`)
		.getByRole("button", { name: enUS.priority.high })
		.click();
	await expect
		.poll(async () => (await nodeFields(nodeId)).priority, { timeout: 30_000 })
		.toBe("high");
	await page.keyboard.press("Escape");

	await page.getByRole("button", { name: enUS.detail.effort }).click();
	await page
		.getByTestId(`editor-effort-${nodeId}-surface`)
		.getByRole("button", { name: enUS.effort.evening })
		.click();
	await expect
		.poll(async () => (await nodeFields(nodeId)).effort, { timeout: 30_000 })
		.toBe("evening");
	await page.keyboard.press("Escape");

	// Notes save themselves after a pause in typing; the Saved line is the
	// field's own acknowledgement that a write happened. The note reads as
	// text on arrival (#237), so the pencil opens the editor's sheet first.
	await page.getByRole("button", { name: enUS.detail.notesEdit }).click();
	await page.getByPlaceholder(enUS.detail.notesPlaceholder).fill(notesText);
	await expect(page.getByText(/^Saved /)).toBeVisible({ timeout: 30_000 });
	await expect
		.poll(async () => (await nodeFields(nodeId)).notes, { timeout: 30_000 })
		.toBe(notesText);
	await page.keyboard.press("Escape");

	// A step, made where steps are made: the *Steps* row navigates to the
	// card's board, and nothing on the details screen creates one.
	await page.getByRole("button", { name: enUS.detail.steps }).click();
	await page.waitForURL(new RegExp(`/projects/${nodeId}$`));
	await addCard(page, stepTitle);
	await waitForNodeIdByTitle(stepTitle);
	// Back to the details. Tapping the card here would open its own board —
	// the screen we are standing on — so the stack's back is the way out.
	await page.goBack();

	// Participants are the whole household on a fresh project; taking one off
	// is the write.
	await page.getByRole("button", { name: enUS.detail.whoIsIn }).click();
	await page
		.getByTestId(`editor-participants-${nodeId}-surface`)
		.getByRole("checkbox", { name: "Anna Maria Berg" })
		.click();
	await expect
		.poll(async () => (await nodeFields(nodeId)).participantIds, {
			timeout: 30_000,
		})
		.toEqual([await memberUid("Marcus")]);
	await page.keyboard.press("Escape");

	// Visibility asks before it changes: the flip rewrites the whole subtree,
	// server-checked, which is why the write takes a moment to land.
	await page.getByRole("button", { name: enUS.detail.whoCanSee }).click();
	await page
		.getByTestId(`editor-visibility-${nodeId}-surface`)
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
	await page.keyboard.press("Escape");

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

	// The date kept: the sheet's Clear button proves the value came back.
	await page.getByRole("button", { name: enUS.detail.dueDate }).click();
	await expect(
		page
			.getByTestId(`editor-due-${nodeId}-surface`)
			.getByRole("button", { name: enUS.detail.clear }),
	).toBeVisible();
	await page.keyboard.press("Escape");

	// A selected chip says so in style, not in the DOM — `aria-pressed` lands
	// on Paper's outer surface and never reaches the button a person taps. Its
	// own tap semantics are the proof instead: tapping the selected value
	// clears it, so the toggle is what tells the reload kept the value.
	await page.getByRole("button", { name: enUS.detail.priority }).click();
	await page
		.getByTestId(`editor-priority-${nodeId}-surface`)
		.getByRole("button", { name: enUS.priority.high })
		.click();
	await expect
		.poll(async () => (await nodeFields(nodeId)).priority, { timeout: 30_000 })
		.toBeNull();
	await page.keyboard.press("Escape");

	await page.getByRole("button", { name: enUS.detail.effort }).click();
	await page
		.getByTestId(`editor-effort-${nodeId}-surface`)
		.getByRole("button", { name: enUS.effort.evening })
		.click();
	await expect
		.poll(async () => (await nodeFields(nodeId)).effort, { timeout: 30_000 })
		.toBeNull();
	await page.keyboard.press("Escape");

	await page.getByRole("button", { name: enUS.detail.notesEdit }).click();
	await expect(
		page
			.getByTestId("notes-editor-surface")
			.getByPlaceholder(enUS.detail.notesPlaceholder),
	).toHaveValue(notesText);
	await page.keyboard.press("Escape");

	// The Steps row's value is the count the real board query reports.
	await expect(
		page.getByText(
			enUS.detail.stepsDone.replace("{{done}}", "0").replace("{{total}}", "1"),
		),
	).toBeVisible();

	await page.getByRole("button", { name: enUS.detail.whoIsIn }).click();
	const participants = page.getByTestId(
		`editor-participants-${nodeId}-surface`,
	);
	await expect(
		participants.getByRole("checkbox", { name: "Anna Maria Berg" }),
	).toHaveAttribute("aria-checked", "false");
	// A private root says so in the participants label, and locks its own row.
	await expect(
		participants.getByText(enUS.detail.participantsPrivate),
	).toBeVisible();
	await expect(
		participants.getByRole("checkbox", { name: "Marcus" }).first(),
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

	// The details row names the blocker it waits on.
	await waiter.getByText(waiterTitle).click();
	await page.waitForURL(/\/projects\/[^/]+\/details$/);
	// The row's value arrives with the blocker's one-shot read, which can
	// outrun this line's patience by a webchannel reconnect after the long
	// walk that precedes it.
	await expect(page.getByText(blockerTitle, { exact: true })).toBeVisible({
		timeout: 30_000,
	});

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
		page.getByText(enUS.detail.waitingAllDone.replace("{{count}}", "1")),
	).toBeVisible({ timeout: 30_000 });
	await page.getByRole("button", { name: enUS.detail.waitingOn }).click();
	await page
		.getByTestId(`waiting-${waiterId}-surface`)
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

/**
 * The bar's own walk (#237 phase 4). The columns are the default set, so the
 * forward arrow has somewhere to go until the last working one, and *Done* is
 * reachable from everywhere.
 */
test("3: the bar at the foot moves the card forward, back and to Done, disables the arrows at the ends, and never covers the last row", async ({
	page,
}) => {
	const title = `${PREFIX}bar walk`;
	const nodeId = await newRootCard(title);

	await page.goto(`/projects/${nodeId}/details`);
	await page.waitForLoadState("networkidle");
	await expect(page.getByText(title).first()).toBeVisible({
		timeout: 30_000,
	});

	const bar = page.getByTestId(`column-bar-${nodeId}`);
	const forwardTo = (column: string) =>
		bar.getByRole("button", {
			name: enUS.detail.moveToColumn.replace("{{column}}", column),
		});

	// First column: the back arrow has nowhere to go, and the name reads the
	// card's own status.
	await expect(
		page.getByTestId(`column-name-${nodeId}`).getByText(enUS.status.backlog),
	).toBeVisible();
	await expect(forwardTo(enUS.status.next_up)).toBeEnabled();
	await expect(forwardTo(enUS.status.backlog)).toBeDisabled();

	// Forward writes, and the name follows the card's listener — the write is
	// settled when the backend says so, not when the optimistic copy moves.
	await forwardTo(enUS.status.next_up).click();
	await expect
		.poll(async () => (await nodeFields(nodeId)).status, { timeout: 30_000 })
		.toBe("next_up");
	await expect(
		page.getByTestId(`column-name-${nodeId}`).getByText(enUS.status.next_up),
	).toBeVisible();

	await forwardTo(enUS.status.execution).click();
	await expect
		.poll(async () => (await nodeFields(nodeId)).status, { timeout: 30_000 })
		.toBe("execution");
	// The last working column: forward is off, *Done* is the way on.
	await expect(forwardTo(enUS.status.execution)).toBeDisabled();

	// Back writes too, from the column it landed in.
	await forwardTo(enUS.status.next_up).click();
	await expect
		.poll(async () => (await nodeFields(nodeId)).status, { timeout: 30_000 })
		.toBe("next_up");
	await expect(
		page.getByTestId(`column-name-${nodeId}`).getByText(enUS.status.next_up),
	).toBeVisible();

	// *Done* is always available and moves to done.
	await bar.getByRole("button", { name: enUS.common.done }).click();
	await expect
		.poll(async () => (await nodeFields(nodeId)).status, { timeout: 30_000 })
		.toBe("done");
	// Scoped to the name: the button beside it says Done too.
	await expect(
		page.getByTestId(`column-name-${nodeId}`).getByText(enUS.status.done),
	).toBeVisible();
	await expect(forwardTo(enUS.status.done)).toBeDisabled();

	// The bar owns no band of the list: scrolled to its end, the last row and
	// the bar are both on screen.
	await page.getByRole("button", { name: enUS.detail.whoIsIn }).click();
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("button", { name: enUS.detail.whoIsIn }),
	).toBeVisible();
	await expect(
		bar.getByRole("button", { name: enUS.common.done, exact: true }),
	).toBeVisible();
});

/** A board frozen to a non-default column set, and one card on it. */
async function narrowBoardCard(): Promise<{
	projectId: string;
	cardId: string;
}> {
	const marcus = await memberUid("Marcus");
	const projectId = await createFixtureNode({
		title: `${PREFIX}narrow board`,
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [marcus],
		status: "backlog",
		columns: ["backlog", "execution"],
	});
	const cardId = await createFixtureNode({
		title: `${PREFIX}narrow card`,
		parentId: projectId,
		ancestorIds: [projectId],
		visibility: "shared",
		participantIds: [],
		status: "backlog",
	});
	return { projectId, cardId };
}

test("4: a card whose board has a non-default column set steps through that set", async ({
	page,
}) => {
	const { cardId } = await narrowBoardCard();

	await page.goto(`/projects/${cardId}/details`);
	await page.waitForLoadState("networkidle");
	await expect(page.getByText(`${PREFIX}narrow card`).first()).toBeVisible({
		timeout: 30_000,
	});

	const bar = page.getByTestId(`column-bar-${cardId}`);
	const forwardTo = (column: string) =>
		bar.getByRole("button", {
			name: enUS.detail.moveToColumn.replace("{{column}}", column),
		});

	// The set is backlog → execution: the first step out of To do is In
	// progress, and there is no Next up on this board to step through.
	await expect(
		page.getByTestId(`column-name-${cardId}`).getByText(enUS.status.backlog),
	).toBeVisible();
	await expect(forwardTo(enUS.status.execution)).toBeEnabled();
	await expect(forwardTo(enUS.status.backlog)).toBeDisabled();

	await forwardTo(enUS.status.execution).click();
	await expect
		.poll(async () => (await nodeFields(cardId)).status, { timeout: 30_000 })
		.toBe("execution");
	await expect(
		page.getByTestId(`column-name-${cardId}`).getByText(enUS.status.execution),
	).toBeVisible();
	// `execution` is the last working column of *this* set, so forward is off.
	await expect(forwardTo(enUS.status.execution)).toBeDisabled();
});
