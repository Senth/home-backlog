import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
	clickMenuItem,
	columnSelector,
	gotoAndSettle,
	ROUTES,
} from "@/e2e/support/app";
import {
	createFixtureLabels,
	createFixtureNode,
	deleteLabelsByTitlePrefix,
	deleteNodesByTitlePrefix,
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
const CARD = '[data-testid="card-container"]';

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
 * preset hues, one a custom colour typed as a hex — and one of them applied
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

	// One with a custom colour, typed as a hex into the field the pencil
	// swatch opens. Stored exactly as picked; the clamp happens at draw time.
	await page.getByRole("button", { name: enUS.labels.newLabel }).click();
	await page.getByRole("textbox").fill(customTitle);
	await page.getByRole("button", { name: enUS.labels.customColour }).click();
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
	await page.getByRole("button", { name: enUS.common.dismiss }).click();

	const id = await waitForNodeIdByTitle(title);
	await expect
		.poll(async () => (await nodeFields(id)).labelIds, { timeout: 30_000 })
		.toContain(preset.id);
});

/**
 * The gutter's own acceptance, measured (#100): a card with a priority and six
 * labels carries **seven marks** plus the hairline in a 36px column, and every
 * one of them must sit inside the card's rounded edge — with the step count, at
 * the right gutter's foot, clear of it too. The review that settled this face
 * reproduced both clips in the browser; this is that check made exact.
 */
test("5: a priority, six labels and a step count all sit inside the card", async ({
	page,
}) => {
	const labels = await createFixtureLabels(PREFIX, 6);
	const title = `${PREFIX}full-gutter card`;
	await createFixtureNode({
		title,
		status: "backlog",
		rank: "z0",
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		completedAt: null,
		priority: "urgent",
		labelIds: labels.map((label) => label.id),
		childCount: 1,
		doneCount: 0,
	});

	await gotoAndSettle(page, BOARD);
	const card = page.locator(CARD, { hasText: title });
	await card.waitFor();

	const offenders = await page.evaluate(
		({ title }) => {
			const card = Array.from(
				document.querySelectorAll('[data-testid="card-container"]'),
			).find((node) => node.textContent?.includes(title));
			if (card === undefined) return ["fixture card not rendered"];

			const box = card.getBoundingClientRect();
			const outside = (name: string, rect: DOMRect): string | null => {
				if (
					rect.width > 0 &&
					rect.height > 0 &&
					rect.left >= box.left + 1 &&
					rect.right <= box.right - 1 &&
					rect.top >= box.top + 1 &&
					rect.bottom <= box.bottom - 1
				) {
					return null;
				}
				return `${name} at ${Math.round(rect.left)},${Math.round(rect.top)}–${Math.round(rect.right)},${Math.round(rect.bottom)} in card ${Math.round(box.left)},${Math.round(box.top)}–${Math.round(box.right)},${Math.round(box.bottom)}`;
			};

			const bad: string[] = [];
			const gutter = card.querySelector('[data-testid="card-gutter"]');
			if (gutter === null) {
				bad.push("no gutter on the fixture card");
			} else {
				const marks = Array.from(gutter.children);
				if (marks.length !== 8) {
					bad.push(
						`gutter holds ${marks.length} marks, expected a priority dot, a hairline and six labels`,
					);
				}
				for (const mark of marks) {
					const finding = outside("gutter mark", mark.getBoundingClientRect());
					if (finding !== null) bad.push(finding);
				}
			}

			const steps = card.querySelector('[data-testid="card-steps"]');
			if (steps === null) {
				bad.push("no step count on the fixture card");
			} else {
				const finding = outside("step count", steps.getBoundingClientRect());
				if (finding !== null) bad.push(finding);
			}
			return bad;
		},
		{ title },
	);

	expect(offenders, "marks outside the card's own box").toEqual([]);
});
