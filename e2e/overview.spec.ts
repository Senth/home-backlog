import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
	clickMenuItem,
	columnSelector,
	gotoAndSettle,
	ROUTES,
} from "@/e2e/support/app";
import {
	createFixtureNode,
	deleteNodesByTitlePrefix,
	fillColumn,
	homeMemberUids,
	memberUid,
} from "@/e2e/support/firestore";
import enUS from "@/i18n/locales/en-US.json";
import { soonInDays, toCalendarDay } from "@/models/due-date";
import { doneWithinDays } from "@/models/overview";
import { touchTarget } from "@/theme/tokens";

/**
 * `#54`'s claims 1–12 and 17 — Overview's own behaviour, over Ongoing projects,
 * Coming up and Recently done. Claims 13–16 are `[eye]` and live in
 * `/review`'s browser pass instead.
 *
 * This is a `writes` spec: every claim but 1 and 8 needs a node the seeded
 * board does not carry — an overdue one, one completed 40 days ago, one a
 * private root hides — and `moveNode` only ever writes `completedAt` as *now*,
 * so those go straight through `createFixtureNode` rather than the UI. Claims
 * 11 and 12 need a home with **nothing** in it, which the seeded `Huset` never
 * is, so they make and delete a throwaway one, the same trade `invite.spec.ts`
 * already accepts: a run killed mid-test leaves it behind.
 */

const BOARD = ROUTES[1];
const CARD = '[data-testid="card-container"]';

/**
 * The strip chip that switches the phone-width board to its In progress pane
 * — `defaultColumns` order, the same index `board.spec.ts` uses. A card
 * created straight into `execution` is off the default pane until this is
 * clicked.
 */
const EXECUTION_CHIP = 2;

/** What every node this file creates is titled, so cleanup can find it. */
const PREFIX = "E2E overview ";

test.afterEach(async () => {
	await deleteNodesByTitlePrefix(PREFIX);
});

/** Today, offset by `days` — the same calendar-day string `dueDate` stores. */
function calendarDay(days: number): string {
	const date = new Date();
	date.setDate(date.getDate() + days);
	return toCalendarDay(date);
}

/**
 * Overview, waited for by its FAB rather than by anything home-specific — the
 * throwaway homes claims 11 and 12 use never show "Huset".
 */
async function gotoOverview(page: Page): Promise<void> {
	await page.goto("/overview");
	await page.waitForLoadState("networkidle");
	await page
		.getByRole("button", { name: enUS.overview.add })
		.waitFor({ state: "visible", timeout: 30_000 });
	expect(new URL(page.url()).pathname, "did not land on /overview").toBe(
		"/overview",
	);
}

/** Moves a root card through `CardMenu › Move to › <column>`. */
async function moveCardTo(
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

/** A throwaway home, created and switched into — for claims 11 and 12. */
async function createThrowawayHome(
	page: Page,
	homeName: string,
): Promise<void> {
	await page.goto("/homes");
	await page.waitForLoadState("networkidle");
	await page.getByRole("button", { name: enUS.homes.create }).click();
	await page.getByRole("textbox").first().fill(homeName);
	await page
		.getByRole("button", { name: enUS.homes.createAction, exact: true })
		.click();
	await page.waitForURL((url) => !url.pathname.endsWith("/homes"), {
		timeout: 60_000,
	});
}

/**
 * Deletes the throwaway home.
 *
 * Nothing here has to switch the browser back to Huset: every test in this
 * file gets its own fresh context loaded from `playwright.config.ts`'s own
 * `storageState`, the one `auth.setup.ts` saved once with Huset active — a
 * home switched inside one test's own context never carries into the next.
 */
async function deleteThrowawayHome(
	page: Page,
	homeName: string,
): Promise<void> {
	await page.goto("/homes");
	await page.waitForLoadState("networkidle");
	await page.getByRole("button", { name: `Manage ${homeName}` }).click();
	await page.waitForURL(/\/homes\/[^/]+$/);
	await page.getByRole("button", { name: enUS.manageHome.delete }).click();
	await page
		.getByRole("button", { name: enUS.manageHome.deleteConfirm, exact: true })
		.click();
	await page.waitForURL("**/homes", { timeout: 30_000 });
}

test("1: the app opens on Overview, and Overview is the first tab", async ({
	page,
}) => {
	await page.goto("/");
	await page.waitForLoadState("networkidle");
	await page
		.getByRole("button", { name: enUS.overview.add })
		.waitFor({ state: "visible", timeout: 30_000 });
	expect(new URL(page.url()).pathname).toBe("/overview");

	await expect(page.getByRole("tab").first()).toHaveAccessibleName(
		new RegExp(enUS.tab.overview),
	);
});

test("2: a root card in In progress appears under Ongoing projects, and leaves the section when it is moved to To do", async ({
	page,
}) => {
	const title = `${PREFIX}ongoing`;
	// Every member, not `[]` — this root is moved through the real app below,
	// which writes through `firestore.rules`, and the rules refuse an empty
	// `participantIds` on a root (`models/node.ts`). The other fixtures in this
	// file are read-only and never hit that rule.
	await createFixtureNode({
		title,
		status: "execution",
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: await homeMemberUids(),
		dueDate: null,
		completedAt: null,
	});

	await gotoOverview(page);
	await expect(page.getByText(title)).toBeVisible();

	await gotoAndSettle(page, BOARD);
	await page.getByTestId("chip").nth(EXECUTION_CHIP).click();
	await moveCardTo(page, title, enUS.status.backlog);

	await gotoOverview(page);
	await expect(page.getByText(title)).toHaveCount(0);
});

test("3: a node with no due date is absent from Coming up", async ({
	page,
}) => {
	const title = `${PREFIX}undated`;
	await createFixtureNode({
		title,
		status: "backlog",
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [],
		dueDate: null,
		completedAt: null,
	});

	await gotoOverview(page);
	await expect(page.getByText(title)).toHaveCount(0);
});

test("4: under Coming up, a node whose due date has passed sorts above one due in three days", async ({
	page,
}) => {
	const lateTitle = `${PREFIX}overdue`;
	const soonTitle = `${PREFIX}due in three days`;

	await createFixtureNode({
		title: lateTitle,
		status: "backlog",
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [],
		completedAt: null,
		dueDate: calendarDay(-1),
	});
	await createFixtureNode({
		title: soonTitle,
		status: "backlog",
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [],
		completedAt: null,
		dueDate: calendarDay(3),
	});

	await gotoOverview(page);
	const lateBox = await page.getByText(lateTitle).boundingBox();
	const soonBox = await page.getByText(soonTitle).boundingBox();
	expect(lateBox, `"${lateTitle}" was not on screen`).not.toBeNull();
	expect(soonBox, `"${soonTitle}" was not on screen`).not.toBeNull();
	expect(lateBox?.y ?? 0).toBeLessThan(soonBox?.y ?? 0);
});

test("5: a node due further out than soonInDays is absent from Coming up", async ({
	page,
}) => {
	const title = `${PREFIX}far out`;
	await createFixtureNode({
		title,
		status: "backlog",
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [],
		completedAt: null,
		dueDate: calendarDay(soonInDays + 3),
	});

	await gotoOverview(page);
	await expect(page.getByText(title)).toHaveCount(0);
});

test("6: a node completed yesterday appears under Recently done; one completed 40 days ago does not", async ({
	page,
}) => {
	const recentTitle = `${PREFIX}done yesterday`;
	const oldTitle = `${PREFIX}done long ago`;
	const dayInMs = 24 * 60 * 60 * 1000;

	await createFixtureNode({
		title: recentTitle,
		status: "done",
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [],
		dueDate: null,
		completedAt: new Date(Date.now() - dayInMs),
	});
	await createFixtureNode({
		title: oldTitle,
		status: "done",
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [],
		dueDate: null,
		completedAt: new Date(Date.now() - (doneWithinDays + 10) * dayInMs),
	});

	await gotoOverview(page);
	await expect(page.getByText(recentTitle)).toBeVisible();
	await expect(page.getByText(oldTitle)).toHaveCount(0);
});

test("7: a root whose participantIds excludes the signed-in member appears in no section, and neither does that root's dated step", async ({
	page,
}) => {
	const anna = await memberUid("Anna Maria Berg");
	const rootTitle = `${PREFIX}someone else's project`;
	const stepTitle = `${PREFIX}someone else's step`;

	const rootId = await createFixtureNode({
		title: rootTitle,
		status: "execution",
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [anna],
		dueDate: null,
		completedAt: null,
	});
	await createFixtureNode({
		title: stepTitle,
		status: "backlog",
		parentId: rootId,
		ancestorIds: [rootId],
		visibility: "shared",
		participantIds: [],
		dueDate: calendarDay(1),
		completedAt: null,
	});

	await gotoOverview(page);
	await expect(page.getByText(rootTitle)).toHaveCount(0);
	await expect(page.getByText(stepTitle)).toHaveCount(0);
});

test("8: the Overview app bar shows the active home's name", async ({
	page,
}) => {
	await gotoOverview(page);
	await expect(page.getByRole("heading", { name: "Huset" })).toBeVisible();
});

test("9: a section holding more than five items shows five rows and a +N more control, and the control reveals the rest", async ({
	page,
}) => {
	const overflow = await fillColumn("execution", 6, `${PREFIX}overflow`);
	// Seeded roots already in execution — see the dump this claim was built
	// against; Ongoing projects' count is exact, so both count toward the cap.
	const seeded = ["Byt filter i ventilationen", "Bergvärme eller luft-vatten?"];
	const all = [...seeded, ...overflow];

	await gotoOverview(page);

	// Scoped to Ongoing projects, not the whole page: "Byt filter i
	// ventilationen" is both an ongoing root and a dated one, so it also has a
	// row under Coming up — a page-wide count would trip on its second,
	// legitimate row.
	const ongoingSection = page.getByTestId("overview-section-ongoing");

	// The section's own listener answers a moment after the FAB does, so wait
	// for the control that only exists once it has — `isVisible()` below does
	// not retry, and called too early it would count zero rows rather than
	// five.
	const more = ongoingSection.getByRole("button", {
		name: `+${all.length - 5} more`,
	});
	await expect(more).toBeVisible({ timeout: 30_000 });

	let visible = 0;
	for (const title of all) {
		if (await ongoingSection.getByText(title, { exact: true }).isVisible()) {
			visible++;
		}
	}
	expect(visible, "rows visible before expanding").toBe(5);

	await more.click();

	await expect(
		ongoingSection.getByRole("button", { name: enUS.overview.less }),
	).toBeVisible();
	for (const title of all) {
		await expect(
			ongoingSection.getByText(title, { exact: true }),
		).toBeVisible();
	}
});

test("10: the FAB creates a root project, which then appears in the To do column of the Projects board", async ({
	page,
}) => {
	const title = `${PREFIX}fab created`;

	await gotoOverview(page);
	await page.getByRole("button", { name: enUS.overview.add }).click();
	await page.getByRole("textbox").first().fill(title);
	await page.getByRole("button", { name: enUS.board.add, exact: true }).click();

	await gotoAndSettle(page, BOARD);
	await expect(
		page.locator(columnSelector("backlog")).getByText(title),
	).toBeVisible();
});

test("11: a home with no nodes shows the first-run line, and no section headings", async ({
	page,
}) => {
	const homeName = `${PREFIX}empty home ${Date.now()}`;
	await createThrowawayHome(page, homeName);

	expect(new URL(page.url()).pathname).toBe("/overview");
	await expect(page.getByText(enUS.overview.empty)).toBeVisible({
		timeout: 30_000,
	});
	await expect(page.getByText(enUS.overview.ongoing.title)).toHaveCount(0);
	await expect(page.getByText(enUS.overview.due.title)).toHaveCount(0);
	await expect(page.getByText(enUS.overview.done.title)).toHaveCount(0);

	await deleteThrowawayHome(page, homeName);
});

test("30: on a home with no nodes the first-run line still points at a FAB of at least touchTarget", async ({
	page,
}) => {
	// The empty state's sentence is prose pointing at a control. If the FAB
	// ever shrank, wrapped away, or stopped rendering on the one screen a new
	// household meets first, the sentence would point at nothing — so the box
	// it points at is measured alongside the line itself.
	const homeName = `${PREFIX}claim 30 throwaway ${Date.now()}`;
	await createThrowawayHome(page, homeName);

	await expect(page.getByText(enUS.overview.empty)).toBeVisible({
		timeout: 30_000,
	});
	const fab = await page.locator('[data-testid="fab-container"]').boundingBox();
	expect(fab, "the FAB the first-run line points at").not.toBeNull();
	expect(fab?.width ?? 0).toBeGreaterThanOrEqual(touchTarget);
	expect(fab?.height ?? 0).toBeGreaterThanOrEqual(touchTarget);

	await deleteThrowawayHome(page, homeName);
});

test("17: a home whose projects are all in To do still shows the sections, not the first-run line", async ({
	page,
}) => {
	// The state the first-run line is most often wrong about, and the reason it
	// is gated on the root count rather than on the three sections: everything
	// in To do, undated, nothing finished this month empties all three while the
	// house is full. A "nothing here yet" on a home with a project in it is the
	// kind of lie people stop trusting a screen for.
	const homeName = `${PREFIX}claim 17 throwaway ${Date.now()}`;
	const projectTitle = `${PREFIX}untouched project`;

	await createThrowawayHome(page, homeName);

	await page.getByRole("button", { name: enUS.overview.add }).click();
	await page.getByRole("textbox").first().fill(projectTitle);
	await page.getByRole("button", { name: enUS.board.add, exact: true }).click();

	// Left exactly where the FAB put it: To do, no due date, not done.
	await gotoOverview(page);

	await expect(page.getByText(enUS.overview.ongoing.title)).toBeVisible({
		timeout: 30_000,
	});
	await expect(page.getByText(enUS.overview.ongoing.empty)).toBeVisible();
	await expect(page.getByText(enUS.overview.due.empty)).toBeVisible();
	await expect(page.getByText(enUS.overview.empty)).toHaveCount(0);

	await deleteThrowawayHome(page, homeName);
});

test("12: with an ongoing project but nothing due and nothing completed, Coming up says it is empty and Recently done is not rendered", async ({
	page,
}) => {
	// A name that shares no substring with `projectTitle` — the app bar shows
	// it on the very screen `projectTitle` is asserted on, and Playwright's
	// text matcher is a substring match unless told otherwise.
	const homeName = `${PREFIX}claim 12 throwaway ${Date.now()}`;
	const projectTitle = `${PREFIX}solo project`;

	await createThrowawayHome(page, homeName);

	await page.getByRole("button", { name: enUS.overview.add }).click();
	await page.getByRole("textbox").first().fill(projectTitle);
	await page.getByRole("button", { name: enUS.board.add, exact: true }).click();

	// A fresh, undated project sits in To do, which is no Overview section at
	// all — the board is where its arrival can be checked.
	await page.goto("/projects");
	await page.waitForLoadState("networkidle");
	await expect(page.getByText(projectTitle, { exact: true })).toBeVisible();
	await moveCardTo(page, projectTitle, enUS.status.execution);

	await gotoOverview(page);
	await expect(page.getByText(projectTitle, { exact: true })).toBeVisible();
	await expect(page.getByText(enUS.overview.due.empty)).toBeVisible();
	await expect(page.getByText(enUS.overview.done.title)).toHaveCount(0);

	await deleteThrowawayHome(page, homeName);
});
