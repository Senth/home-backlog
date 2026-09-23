import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
	cardSelector,
	clickMenuItem,
	gotoAndSettle,
	ROUTES,
	VIEWPORTS,
} from "@/e2e/support/app";
import {
	createFixtureLocation,
	createFixtureNode,
	deleteLocationsByTitlePrefix,
	deleteNodesByTitlePrefix,
	memberUid,
	nodeFields,
	waitForNodeIdByTitle,
} from "@/e2e/support/firestore";
import enUS from "@/i18n/locales/en-US.json";
import svSE from "@/i18n/locales/sv-SE.json";
import { toCalendarDay } from "@/models/due-date";
import { touchTarget } from "@/theme/tokens";

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
const CARD = cardSelector();

/** What every node this file creates is titled, so cleanup can find it. */
const PREFIX = "E2E details ";

/** What every location this file creates is titled, for the same reason. */
const LOC_PREFIX = "E2E loc ";

test.afterEach(async () => {
	await deleteNodesByTitlePrefix(PREFIX);
	await deleteLocationsByTitlePrefix(LOC_PREFIX);
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

	// A small place tree, since the seed ships none: Hallway sits under
	// Basement under House, so the picker has a trail to draw.
	const houseTitle = `${LOC_PREFIX}House`;
	const basementTitle = `${LOC_PREFIX}Basement`;
	const hallwayTitle = `${LOC_PREFIX}Hallway`;
	const houseId = await createFixtureLocation({
		title: houseTitle,
		parentId: null,
		ancestorIds: [],
	});
	const basementId = await createFixtureLocation({
		title: basementTitle,
		parentId: houseId,
		ancestorIds: [houseId],
	});
	const hallwayId = await createFixtureLocation({
		title: hallwayTitle,
		parentId: basementId,
		ancestorIds: [houseId, basementId],
	});

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

	// Location (#246): the row opens the picker, picking a place writes the
	// card's place and its denormalized path in one write, and the trail under
	// the ticked row names where that place sits. The trail's titles also ride
	// their own rows above, so the visibility claim takes the first of each.
	await page.getByRole("button", { name: enUS.detail.location }).click();
	const locationPicker = page.getByTestId(`location-picker-${nodeId}-surface`);
	await locationPicker.getByRole("checkbox", { name: hallwayTitle }).click();
	await expect
		.poll(async () => (await nodeFields(nodeId)).locationId, {
			timeout: 30_000,
		})
		.toBe(hallwayId);
	await expect
		.poll(async () => (await nodeFields(nodeId)).locationAncestorIds, {
			timeout: 30_000,
		})
		.toEqual([houseId, basementId]);
	await expect(locationPicker.getByText(basementTitle).first()).toBeVisible();
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
	const stepId = await waitForNodeIdByTitle(stepTitle);
	// Back to the details. Tapping the card here would open its own board —
	// the screen we are standing on — so the stack's back is the way out.
	await page.goBack();

	// The step inherits the project's place (#290): its own field stays empty
	// in the store, the row names Hallway anyway, and the picker ticks it as
	// inherited.
	expect((await nodeFields(stepId)).locationId).toBeNull();
	await page.goto(`/projects/${stepId}/details`);
	await expect(page.getByTestId(`field-location-${stepId}`)).toContainText(
		hallwayTitle,
		{ timeout: 30_000 },
	);
	await page.getByRole("button", { name: enUS.detail.location }).click();
	const stepPicker = page.getByTestId(`location-picker-${stepId}-surface`);
	await expect(
		stepPicker.getByRole("checkbox", { name: hallwayTitle }),
	).toBeChecked();
	await expect(
		stepPicker.getByText(enUS.detail.locationInherited),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await page.goto(`/projects/${nodeId}/details`);

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
	// The root is written first, so the poll above can pass while the progress
	// dialog is still out — and the dialog holds the screen on purpose until
	// the whole subtree is written. The Escape below is the sheet's to answer,
	// which it only is once the dialog is gone.
	await expect(
		page.getByTestId("visibility-progress-dialog-surface"),
	).toBeHidden({ timeout: 30_000 });
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
	// Scoped to the row's test id: the ✕ beside it now names itself
	// "Clear Priority", and a name match would find two buttons (#247).
	await page.getByTestId(`field-priority-${nodeId}`).click();
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

	// The location came back from the server too, and the ticked row's tap —
	// the same one that filed the card — is what takes the place off.
	await page.getByRole("button", { name: enUS.detail.location }).click();
	await page
		.getByTestId(`location-picker-${nodeId}-surface`)
		.getByRole("checkbox", { name: hallwayTitle })
		.click();
	await expect
		.poll(async () => (await nodeFields(nodeId)).locationId, {
			timeout: 30_000,
		})
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

test("2: marking a card waiting lists the blocker on the details screen, completing the blocker clears the mark live, and tapping the ticked row in the picker takes the wait off", async ({
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
	const picker = page.getByTestId(`waiting-${waiterId}-surface`);
	// The picked blocker is offered ticked even though it is done now — the
	// tap on it is what takes the wait off (#237: the picker, not a dialog).
	await picker.getByRole("checkbox", { name: blockerTitle }).click();
	await expect
		.poll(async () => (await nodeFields(waiterId)).blockedBy, {
			timeout: 30_000,
		})
		.toEqual([]);
	// The card itself is never offered as its own blocker.
	await expect(picker.getByRole("checkbox", { name: waiterTitle })).toHaveCount(
		0,
	);
	await page.keyboard.press("Escape");
	await expect(page.getByText(enUS.detail.waitingNone)).toBeVisible();
});

/**
 * The bar's own walk (#237 phase 4, #336). The columns are the default set:
 * the arrows step one column either way, the last working column steps into
 * Done, and the centre opens a picker that jumps anywhere.
 */
test("3: the bar at the foot steps the card forward and back, jumps it through the picker, steps it into Done, and never covers the last row", async ({
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
	const centre = page.getByTestId(`column-name-${nodeId}`);
	const forwardTo = (column: string) =>
		bar.getByRole("button", {
			name: enUS.detail.moveToColumn.replace("{{column}}", column),
		});
	const settled = (status: string) =>
		expect
			.poll(async () => (await nodeFields(nodeId)).status, { timeout: 30_000 })
			.toBe(status);

	// First column: the back arrow has nowhere to go, and the name reads the
	// card's own status. en-US default columns do not fit labelled at 400px,
	// so the arrows are icon-only.
	await expect(centre.getByText(enUS.status.backlog)).toBeVisible();
	await expect(forwardTo(enUS.status.next_up)).toBeEnabled();
	await expect(forwardTo(enUS.status.next_up)).not.toContainText(
		enUS.status.next_up,
	);
	await expect(bar.getByRole("button", { disabled: true })).toHaveCount(1);

	// Forward writes, and the name follows the card's listener — the write is
	// settled when the backend says so, not when the optimistic copy moves.
	await forwardTo(enUS.status.next_up).click();
	await settled("next_up");
	await expect(centre.getByText(enUS.status.next_up)).toBeVisible();

	// Back writes too, from the column it landed in.
	await forwardTo(enUS.status.backlog).click();
	await settled("backlog");
	await expect(centre.getByText(enUS.status.backlog)).toBeVisible();

	// The centre jumps: every column, the card's own marked, and a tap on
	// the current one changes nothing and keeps the sheet open.
	await centre.click();
	const picker = page.getByTestId(`editor-column-${nodeId}-surface`);
	const row = (column: string) =>
		picker.getByRole("button", { name: column, exact: true });
	for (const column of [
		enUS.status.backlog,
		enUS.status.next_up,
		enUS.status.execution,
		enUS.status.done,
	]) {
		await expect(row(column)).toBeVisible();
	}
	await expect(row(enUS.status.backlog)).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await row(enUS.status.backlog).click();
	await expect(picker).toBeVisible();
	await row(enUS.status.execution).click();
	await expect(picker).toBeHidden();
	await settled("execution");
	await expect(centre.getByText(enUS.status.execution)).toBeVisible();

	// The last working column steps into Done, where forward is off.
	await forwardTo(enUS.status.done).click();
	await settled("done");
	await expect(centre.getByText(enUS.status.done)).toBeVisible();
	await expect(bar.getByRole("button", { disabled: true })).toHaveCount(1);

	// The bar owns no band of the list: scrolled to its end, the last row and
	// the bar are both on screen.
	await page.getByRole("button", { name: enUS.detail.whoIsIn }).click();
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("button", { name: enUS.detail.whoIsIn }),
	).toBeVisible();
	await expect(forwardTo(enUS.status.execution)).toBeVisible();
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
	await expect(bar.getByRole("button", { disabled: true })).toHaveCount(1);

	await forwardTo(enUS.status.execution).click();
	await expect
		.poll(async () => (await nodeFields(cardId)).status, { timeout: 30_000 })
		.toBe("execution");
	await expect(
		page.getByTestId(`column-name-${cardId}`).getByText(enUS.status.execution),
	).toBeVisible();
	// `execution` is the last working column of *this* set: forward is Done.
	await forwardTo(enUS.status.done).click();
	await expect
		.poll(async () => (await nodeFields(cardId)).status, { timeout: 30_000 })
		.toBe("done");
	await expect(bar.getByRole("button", { disabled: true })).toHaveCount(1);
});

/**
 * The 200% claim (#237 phase 3 and 4), at the size that broke it: a 195x422
 * window in Swedish. The name column of every row once collapsed to zero —
 * `flex: 1` gives a column zero basis, so in the shrink phase it yielded
 * everything and the names spelled one character per line — and the bar's
 * column name collapsed the same way while *Done* clipped off the screen.
 */
test.describe("at 200% text in sv-SE (#237)", () => {
	test.use({ locale: "sv-SE", viewport: VIEWPORTS.phoneZoomed });
	test("5: every row keeps a name column and a value that reads, and the bar's name reads before it clips", async ({
		page,
	}) => {
		// A root card with both members on it, so all ten rows render. No
		// assignee, so *Who's doing it* carries the "nobody yet" text value.
		const marcus = await memberUid("Marcus");
		const nodeId = await createFixtureNode({
			title: `${PREFIX}zoomed`,
			parentId: null,
			ancestorIds: [],
			visibility: "shared",
			participantIds: [marcus, await memberUid("Anna Maria Berg")],
			assigneeIds: [],
			status: "backlog",
		});
		await page.goto(`/projects/${nodeId}/details`);
		await page.waitForLoadState("networkidle");
		await expect(page.getByText(`${PREFIX}zoomed`).first()).toBeVisible({
			timeout: 30_000,
		});

		/**
		 * Both halves of every row: the name and the value the card holds. The
		 * value strings are what this fixture renders in sv-SE; *Who's in it*
		 * has no text value — its avatars carry initials, and Marcus's is "M".
		 */
		const rows = [
			{ field: "steps", name: svSE.detail.steps, value: svSE.detail.stepsNone },
			{
				field: "priority",
				name: svSE.detail.priority,
				value: svSE.detail.notSet,
			},
			{
				field: "effort",
				name: svSE.detail.effort,
				value: svSE.detail.notSet,
			},
			{
				field: "location",
				name: svSE.detail.location,
				value: svSE.detail.notSet,
			},
			{
				field: "labels",
				name: svSE.detail.labels,
				value: svSE.detail.labelsNone,
			},
			{
				field: "waiting",
				name: svSE.detail.waitingOn,
				value: svSE.detail.waitingNone,
			},
			{ field: "due", name: svSE.detail.dueDate, value: svSE.detail.addDate },
			{
				field: "visibility",
				name: svSE.detail.whoCanSee,
				value: svSE.detail.visibilityShared,
			},
			{ field: "participants", name: svSE.detail.whoIsIn, value: "M" },
			{
				field: "assignees",
				name: svSE.detail.whoIsDoing,
				value: svSE.detail.assigneesNone,
			},
		];

		/** True when two boxes share any area — how an overlap reads. */
		const overlaps = (
			a: NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>,
			b: NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>,
		): boolean =>
			a.x < b.x + b.width &&
			b.x < a.x + a.width &&
			a.y < b.y + b.height &&
			b.y < a.y + a.height;

		// The card is a seeded root and Huset has two members, so all ten rows
		// render. Each name keeps a column at least a touch target wide, which a
		// one-character-per-line collapse cannot fake — and each value keeps a
		// real width clear of its chevron, which is the same failure on the
		// other half of the row: a value with no floor collapsed to a w=0 slot
		// here while the names passed (#237).
		for (const { field, name, value } of rows) {
			const row = page.getByRole("button", { name });
			await expect(row).toBeVisible();
			const nameBox = await row.getByText(name, { exact: true }).boundingBox();
			expect(
				nameBox?.width ?? 0,
				`the name column of "${name}" at 195px`,
			).toBeGreaterThanOrEqual(touchTarget);
			const valueBox = await row
				.getByText(value, { exact: true })
				.boundingBox();
			expect(
				valueBox?.width ?? 0,
				`the value of "${name}" at 195px`,
			).toBeGreaterThan(0);
			// The chevron is a sibling of the row's pressable, never inside it —
			// a real <button> may not contain another button (#237) — so it is
			// scoped to the row container, the pressable's parent.
			const chevron = await row
				.locator("xpath=..")
				.getByTestId(`field-${field}-${nodeId}-chevron`)
				.boundingBox();
			expect(
				valueBox !== null && chevron !== null && overlaps(valueBox, chevron),
				`the value of "${name}" overlaps its chevron at 195px`,
			).toBe(false);
		}

		// The bar stacks: the name on a line of its own, whole — one line, no
		// ellipsis — and both arrows a full touch target below it.
		const bar = page.getByTestId(`column-bar-${nodeId}`);
		const name = page
			.getByTestId(`column-name-${nodeId}`)
			.getByText(svSE.status.backlog);
		const fit = await name.evaluate((element) => ({
			height: element.getBoundingClientRect().height,
			line: Number.parseFloat(getComputedStyle(element).lineHeight),
			clipped:
				element.scrollWidth > element.clientWidth ||
				element.scrollHeight > element.clientHeight,
		}));
		expect(fit.clipped, "the bar's name is clipped at 195px").toBe(false);
		expect(fit.height, "the bar's name wraps at 195px").toBeLessThan(
			2 * fit.line,
		);
		const arrowTo = (column: string) =>
			bar.getByRole("button", {
				name: svSE.detail.moveToColumn.replace("{{column}}", column),
			});
		for (const [column, arrow] of [
			[svSE.status.backlog, bar.getByRole("button", { disabled: true })],
			[svSE.status.next_up, arrowTo(svSE.status.next_up)],
		] as const) {
			const box = await arrow.locator("..").boundingBox();
			expect(box?.width ?? 0, `${column} arrow width`).toBeGreaterThanOrEqual(
				touchTarget,
			);
			expect(box?.height ?? 0, `${column} arrow height`).toBeGreaterThanOrEqual(
				touchTarget,
			);
			expect(
				(box?.x ?? 0) + (box?.width ?? 0),
				`${column} arrow stays inside a 195px viewport`,
			).toBeLessThanOrEqual(VIEWPORTS.phoneZoomed.width);
		}

		// Given the bar's full 400px, Swedish default columns fit labelled.
		await page.setViewportSize(VIEWPORTS.desktop);
		await expect(arrowTo(svSE.status.next_up)).toContainText(
			svSE.status.next_up,
		);
	});
});
