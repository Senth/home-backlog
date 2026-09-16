import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
	clickMenuItem,
	createThrowawayHome,
	deleteThrowawayHome,
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
import { stackPorts } from "@/e2e/support/stack";
import enUS from "@/i18n/locales/en-US.json";
import { soonInDays, toCalendarDay } from "@/models/due-date";
import { doneWithinDays } from "@/models/overview";

/**
 * The dashboard renders what is outstanding: where the app opens, which
 * sections the household's work lands in, and that the config behind the
 * cards seeds once and never re-adds a removed seed.
 *
 * This is a `writes` spec: the overdue, far-out and backdated fixtures have
 * no UI path, so they go straight through `createFixtureNode`. What is
 * deliberately *not* here is the card logic itself — which rows match which
 * card, the sort inside a card, the effort partitioning, the scoping and
 * hiding — all of that is `models/overview-cards.test.ts` territory. This
 * file proves the browser renders it and persists it.
 */

const BOARD = ROUTES[1];
const CARD = '[data-testid="card-container"]';

/**
 * The strip chip that switches the phone-width board to its In progress pane
 * — `defaultColumns` order. A card created straight into `execution` is off
 * the default pane until this is clicked.
 */
const EXECUTION_CHIP = 2;

/** What every node this file creates is titled, so cleanup can find it. */
const PREFIX = "E2E overview ";

/** The seven cards a missing config seeds, by their stored ids. */
const SEED_IDS = [
	"aFewHours",
	"comingUp",
	"needsEstimate",
	"needsSplitting",
	"ongoing",
	"quickWins",
	"recentlyDone",
] as const;

const OWNER = { Authorization: "Bearer owner" };

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
 * The dashboard config document, over the emulator's REST API.
 *
 * The one claim that needs a non-node document reset — seeding is exactly
 * what it claims, a write that runs once on a first read with no config —
 * and `e2e/support/firestore.ts`'s helpers are all node-scoped.
 */
function dashboardConfigUrl(uid: string): string {
	return `http://localhost:${stackPorts().firestore}/v1/projects/home-backlog/databases/(default)/documents/users/${uid}/dashboard/config`;
}

/** Deletes the config doc; a 404 is the wanted state, anything else is not. */
async function deleteDashboardConfig(uid: string): Promise<void> {
	const response = await fetch(dashboardConfigUrl(uid), {
		method: "DELETE",
		headers: OWNER,
	});
	if (!response.ok && response.status !== 404) {
		throw new Error(
			`could not reset the dashboard config: ${response.status} ${response.statusText}`,
		);
	}
}

/**
 * Overview, waited for by its FAB rather than by anything home-specific —
 * the throwaway home the empty claim uses never shows "Huset".
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

test("2: a missing config seeds the seven cards once, and a seed removed in the app never returns", async ({
	page,
}) => {
	const uid = await memberUid("Marcus");
	await deleteDashboardConfig(uid);

	// The recently-done section hides itself when it is empty, and the only
	// recently completed card in the emulator seed carries a fixed date that
	// has aged past `doneWithinDays`. The section's own fixture completes
	// relative to now, the way test 5's do.
	const dayInMs = 24 * 60 * 60 * 1000;
	await createFixtureNode({
		title: `${PREFIX}seed recently done`,
		status: "done",
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [],
		dueDate: null,
		completedAt: new Date(Date.now() - dayInMs),
	});

	await gotoOverview(page);
	for (const id of SEED_IDS) {
		await expect(page.getByTestId(`overview-section-${id}`)).toBeVisible();
	}

	// Seeding is a write: the config document exists behind the sections, so
	// no later read can mistake "never seeded" for "user removed everything".
	await expect
		.poll(
			async () => {
				const response = await fetch(dashboardConfigUrl(uid), {
					headers: OWNER,
				});
				return response.ok;
			},
			{ timeout: 30_000 },
		)
		.toBe(true);

	// Remove a seed the way a person does, and it stays removed across a
	// reload — nothing re-seeds what the user took away. The menu open goes
	// through `clickMenuItem` because this is a Paper `Menu` under a synthetic
	// click, the same race every other menu in the suite works around.
	await clickMenuItem(
		page,
		page.getByTestId("overview-card-menu-quickWins"),
		enUS.overview.cards.menu.remove,
	);
	await page
		.getByRole("button", { name: enUS.overview.cards.menu.remove, exact: true })
		.click();

	await gotoOverview(page);
	await expect(page.getByTestId("overview-section-quickWins")).toHaveCount(0);
	await expect(page.getByTestId("overview-section-ongoing")).toBeVisible();

	// Leave no config behind, the way the seed has none: the next run's first
	// open re-seeds, which is the path this claim just proved.
	await deleteDashboardConfig(uid);
});

test("3: a root card in In progress appears under Ongoing projects, and leaves the section when it is moved to To do", async ({
	page,
}) => {
	const title = `${PREFIX}ongoing`;
	// Every member, not `[]` — this root is moved through the real app below,
	// which writes through `firestore.rules`, and the rules refuse an empty
	// `participantIds` on a root (`models/node.ts`). The other fixtures in
	// this file are read-only and never hit that rule.
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

	// Scoped to Ongoing projects: the same node can also render in other
	// cards — an undated root lands in Needs an estimate — so a page-wide
	// locator would meet it twice.
	const ongoing = page.getByTestId("overview-section-ongoing");

	await gotoOverview(page);
	await expect(ongoing.getByText(title)).toBeVisible();

	await gotoAndSettle(page, BOARD);
	await page.getByTestId("chip").nth(EXECUTION_CHIP).click();
	await moveCardTo(page, title, enUS.status.backlog);

	await gotoOverview(page);
	await expect(ongoing.getByText(title)).toHaveCount(0);
});

test("4: under Coming up, a late node sorts above one due in three days, and one beyond soonInDays is absent", async ({
	page,
}) => {
	const lateTitle = `${PREFIX}overdue`;
	const soonTitle = `${PREFIX}due in three days`;
	const farTitle = `${PREFIX}far out`;

	for (const [title, dueDate] of [
		[lateTitle, calendarDay(-1)],
		[soonTitle, calendarDay(3)],
		[farTitle, calendarDay(soonInDays + 3)],
	] as const) {
		await createFixtureNode({
			title,
			status: "backlog",
			parentId: null,
			ancestorIds: [],
			visibility: "shared",
			participantIds: [],
			completedAt: null,
			dueDate,
		});
	}

	// Scoped to Coming up: the two dated fixtures are undated roots too, so
	// they render in Needs an estimate as well, and a page-wide box would be
	// ambiguous.
	const comingUp = page.getByTestId("overview-section-comingUp");

	await gotoOverview(page);
	// Polled: two boxes measured at two instants of a settling layout can
	// disagree with the order both had a moment later.
	await expect
		.poll(async () => {
			const lateBox = await comingUp.getByText(lateTitle).boundingBox();
			const soonBox = await comingUp.getByText(soonTitle).boundingBox();
			expect(lateBox, `"${lateTitle}" was not on screen`).not.toBeNull();
			expect(soonBox, `"${soonTitle}" was not on screen`).not.toBeNull();
			return (lateBox?.y ?? 0) < (soonBox?.y ?? 0);
		})
		.toBe(true);
	await expect(comingUp.getByText(farTitle)).toHaveCount(0);

	// A step under a project names that project on its row: the card face's
	// path eyebrow, rendered for real. Scoped to Coming up — the undated
	// parent is a root, so it has rows of its own on other cards, and here
	// its name appears only as the step's path.
	const parentId = await createFixtureNode({
		title: `${PREFIX}nested parent`,
		status: "backlog",
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [],
		completedAt: null,
		dueDate: null,
	});
	await createFixtureNode({
		title: `${PREFIX}nested step`,
		status: "backlog",
		parentId,
		ancestorIds: [parentId],
		visibility: "shared",
		participantIds: [],
		completedAt: null,
		dueDate: calendarDay(2),
	});
	await gotoOverview(page);
	await expect(comingUp.getByText(`${PREFIX}nested parent`)).toBeVisible();
});

test("5: a node completed yesterday appears under Recently done; one completed 40 days ago does not", async ({
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

test("6: a section holding more than five items shows five rows and a +N more control, and the control reveals the rest", async ({
	page,
}) => {
	const overflow = await fillColumn("execution", 6, `${PREFIX}overflow`);
	// Seeded roots already in execution: Ongoing projects' count is exact, so
	// they count toward the cap alongside the throwaway ones.
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

test("7: a home with no nodes shows the first-run line, and no section headings", async ({
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
