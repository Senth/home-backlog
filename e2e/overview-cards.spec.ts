import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { createThrowawayHome, deleteThrowawayHome } from "@/e2e/support/app";
import {
	createFixtureNode,
	deleteDocAt,
	deleteNodesByTitlePrefix,
	homeId,
	type Json,
	memberUid,
	readDocAt,
	waitForHomeId,
	writeDocAt,
} from "@/e2e/support/firestore";
import enUS from "@/i18n/locales/en-US.json";
import { toCalendarDay } from "@/models/due-date";

/**
 * `#166`'s claims 1–10 and 19 — Overview as an ordered list of filter cards
 * over one shared pool, with the seven seeds and their per-card empty
 * behaviour. Claims 11–18 are the editor's and export/import's, and land with
 * their phases.
 *
 * This is a `writes` spec. Fixture nodes go straight through
 * `createFixtureNode` — a card's effort or a backdated completion has no UI
 * path yet — and claim 1 drives the config doc itself, because seeding is
 * exactly what it claims: a write that runs once, on a first read, and never
 * re-adds a seed the user removed. The effort-card claims need a home whose
 * contents the test controls, so they make and delete a throwaway one, the
 * same trade `overview.spec.ts` already accepts: a run killed mid-test leaves
 * the home behind.
 */

/** What every node this file creates is titled, so cleanup can find it. */
const PREFIX = "E2E cards ";

const dayInMs = 24 * 60 * 60 * 1000;

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
 * Overview, waited for by its FAB rather than by anything home-specific —
 * the throwaway homes the effort-card claims use never show "Huset".
 */
async function gotoOverview(page: Page): Promise<void> {
	await page.goto("/overview");
	await page.waitForLoadState("networkidle");
	await page
		.getByRole("button", { name: enUS.overview.add })
		.waitFor({ state: "visible", timeout: 30_000 });
}

/** One card on the screen, by the id the config stored it under. */
function section(page: Page, id: string): Locator {
	return page.getByTestId(`overview-section-${id}`);
}

/** A root project in the home `toHome`, fixture-written like every node here. */
async function throwawayRoot(toHome: string, title: string): Promise<string> {
	return createFixtureNode(
		{
			title,
			status: "execution",
			parentId: null,
			ancestorIds: [],
			visibility: "shared",
			participantIds: [],
			dueDate: null,
			completedAt: null,
		},
		toHome,
	);
}

/** A task under `rootId`, with the overrides a claim needs on top. */
async function taskOf(
	toHome: string,
	rootId: string,
	title: string,
	overrides: Record<string, Json> = {},
): Promise<string> {
	return createFixtureNode(
		{
			title,
			status: "backlog",
			parentId: rootId,
			ancestorIds: [rootId],
			participantIds: [],
			dueDate: null,
			completedAt: null,
			...overrides,
		},
		toHome,
	);
}

/**
 * Row order, measured: the cards sort client-side, so what the claim is about
 * is which row sits above which. The screen's sections answer as their
 * listeners land, so the comparison is polled — two boxes measured at two
 * instants of a settling layout can disagree with the order both had a moment
 * later.
 */
async function ordered(
	scope: Locator,
	above: string,
	below: string,
): Promise<boolean> {
	const aboveBox = await scope.getByText(above, { exact: true }).boundingBox();
	const belowBox = await scope.getByText(below, { exact: true }).boundingBox();
	expect(aboveBox, `"${above}" was not on screen`).not.toBeNull();
	expect(belowBox, `"${below}" was not on screen`).not.toBeNull();
	return (aboveBox?.y ?? 0) < (belowBox?.y ?? 0);
}

test("1: opening Overview with no card config seeds the seven cards once, writes the marker, and a seed the user removed never comes back on later reads", async ({
	page,
}) => {
	const marcus = await memberUid("Marcus");
	const configPath = `/users/${marcus}/dashboard/config`;
	await deleteDocAt(configPath);

	await gotoOverview(page);

	// The seeds land in the cross-home doc, with the marker saying the one
	// write ran.
	let config: Record<string, unknown> | null = null;
	await expect
		.poll(async () => readDocAt(configPath), { timeout: 30_000 })
		.toBeTruthy();
	config = await readDocAt(configPath);
	const cards = config?.cards as Record<string, unknown>;
	expect(Object.keys(cards).sort()).toEqual([
		"aFewHours",
		"comingUp",
		"needsEstimate",
		"needsSplitting",
		"ongoing",
		"quickWins",
		"recentlyDone",
	]);
	expect(config?.seededAt).toBeTruthy();

	// A seed the user removed is removed for good: the config is rewritten
	// without it, the way the editor will rewrite it, and no later read
	// re-seeds.
	delete cards.quickWins;
	await writeDocAt(configPath, {
		cards: cards as Record<string, Json>,
		seededAt: new Date(config?.seededAt as string),
	});
	await page.reload();
	await expect(section(page, "quickWins")).toHaveCount(0);
	await expect(section(page, "ongoing")).toBeVisible();

	// Leave no config behind: the next test's first open re-seeds, which is
	// exactly the path this claim proved.
	await deleteDocAt(configPath);
});

test("2: Ongoing projects shows roots in execution in board order — the same rows the fixed section showed, now through the card renderer", async ({
	page,
}) => {
	const first = `${PREFIX}ongoing first`;
	const second = `${PREFIX}ongoing second`;
	await createFixtureNode({
		title: first,
		status: "execution",
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [],
		rank: "zz001",
		dueDate: null,
		completedAt: null,
	});
	await createFixtureNode({
		title: second,
		status: "execution",
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [],
		rank: "zz002",
		dueDate: null,
		completedAt: null,
	});

	await gotoOverview(page);
	const ongoing = section(page, "ongoing");
	await expect(ongoing.getByText(first)).toBeVisible();
	await expect.poll(() => ordered(ongoing, first, second)).toBe(true);
});

test("3: Coming up shows every open node that is late or due within 7 days, earliest first, including a row Ongoing projects also shows", async ({
	page,
}) => {
	const lateRoot = `${PREFIX}late ongoing root`;
	const soon = `${PREFIX}due in two days`;
	await createFixtureNode({
		title: lateRoot,
		status: "execution",
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [],
		dueDate: calendarDay(-1),
		completedAt: null,
	});
	await createFixtureNode({
		title: soon,
		status: "backlog",
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [],
		dueDate: calendarDay(2),
		completedAt: null,
	});

	await gotoOverview(page);
	const comingUp = section(page, "comingUp");
	await expect(comingUp.getByText(lateRoot)).toBeVisible();
	await expect(comingUp.getByText(soon)).toBeVisible();
	await expect.poll(() => ordered(comingUp, lateRoot, soon)).toBe(true);

	// The overlap the spec accepts: the late root is in execution, so Ongoing
	// projects shows it too, and Coming up no longer hides it for that.
	await expect(section(page, "ongoing").getByText(lateRoot)).toBeVisible();
});

test("4: Quick wins shows at most 3 non-root childless quick tasks, highest priority first, and offers no expander", async ({
	page,
}) => {
	const homeName = `${PREFIX}quick home ${Date.now()}`;
	await createThrowawayHome(page, homeName);
	const home = await waitForHomeId(homeName);
	const root = await throwawayRoot(home, `${PREFIX}quick pool root`);
	for (const priority of ["urgent", "high", "normal", "low"]) {
		await taskOf(home, root, `${PREFIX}quick ${priority}`, {
			effort: "quick",
			priority,
		});
	}

	await gotoOverview(page);
	const quickWins = section(page, "quickWins");
	await expect(quickWins.getByText(`${PREFIX}quick urgent`)).toBeVisible();
	await expect(quickWins.getByText(`${PREFIX}quick high`)).toBeVisible();
	await expect(quickWins.getByText(`${PREFIX}quick normal`)).toBeVisible();
	await expect
		.poll(
			async () =>
				(await ordered(
					quickWins,
					`${PREFIX}quick urgent`,
					`${PREFIX}quick high`,
				)) &&
				(await ordered(
					quickWins,
					`${PREFIX}quick high`,
					`${PREFIX}quick normal`,
				)),
		)
		.toBe(true);

	// Three shown, three held: the fourth exists but the card holds no more,
	// so there is nothing to expand.
	await expect(quickWins.getByText(`${PREFIX}quick low`)).toHaveCount(0);
	await expect(
		quickWins.getByRole("button", { name: /\d+ more|Show less/i }),
	).toHaveCount(0);

	await deleteThrowawayHome(page, homeName);
});

test("5: A few hours shows tasks with effort under 2 h or an evening, at most 3, priority first", async ({
	page,
}) => {
	const homeName = `${PREFIX}hours home ${Date.now()}`;
	await createThrowawayHome(page, homeName);
	const home = await waitForHomeId(homeName);
	const root = await throwawayRoot(home, `${PREFIX}hours pool root`);
	for (const priority of ["urgent", "high", "normal", "low"]) {
		await taskOf(home, root, `${PREFIX}hours ${priority}`, {
			effort: "hours",
			priority,
		});
	}

	await gotoOverview(page);
	const aFewHours = section(page, "aFewHours");
	await expect(aFewHours.getByText(`${PREFIX}hours urgent`)).toBeVisible();
	await expect(aFewHours.getByText(`${PREFIX}hours high`)).toBeVisible();
	await expect(aFewHours.getByText(`${PREFIX}hours normal`)).toBeVisible();
	await expect
		.poll(() =>
			ordered(aFewHours, `${PREFIX}hours urgent`, `${PREFIX}hours high`),
		)
		.toBe(true);
	await expect(aFewHours.getByText(`${PREFIX}hours low`)).toHaveCount(0);

	await deleteThrowawayHome(page, homeName);
});

test("6: Needs splitting shows tasks with effort a weekend or multi-week, 5 shown and up to 10 held", async ({
	page,
}) => {
	const homeName = `${PREFIX}split home ${Date.now()}`;
	await createThrowawayHome(page, homeName);
	const home = await waitForHomeId(homeName);
	const root = await throwawayRoot(home, `${PREFIX}split pool root`);
	const titles: string[] = [];
	for (const [index, title] of [
		`${PREFIX}split one`,
		`${PREFIX}split two`,
		`${PREFIX}split three`,
		`${PREFIX}split four`,
		`${PREFIX}split five`,
		`${PREFIX}split six`,
	].entries()) {
		titles.push(title);
		await taskOf(home, root, title, {
			effort: "weekend",
			rank: `zz00${index + 1}`,
		});
	}

	await gotoOverview(page);
	const needsSplitting = section(page, "needsSplitting");
	for (const title of titles.slice(0, 5)) {
		await expect(needsSplitting.getByText(title)).toBeVisible();
	}
	await expect(needsSplitting.getByText(titles[5])).toHaveCount(0);

	const more = needsSplitting.getByRole("button", { name: "+1 more" });
	await expect(more).toBeVisible({ timeout: 30_000 });
	await more.click();
	await expect(
		needsSplitting.getByRole("button", { name: enUS.overview.less }),
	).toBeVisible();
	await expect(needsSplitting.getByText(titles[5])).toBeVisible();

	await deleteThrowawayHome(page, homeName);
});

test("7: Needs an estimate shows tasks with no effort set, 5 shown and up to 10 held", async ({
	page,
}) => {
	const homeName = `${PREFIX}estimate home ${Date.now()}`;
	await createThrowawayHome(page, homeName);
	const home = await waitForHomeId(homeName);
	const root = await throwawayRoot(home, `${PREFIX}estimate pool root`);
	const titles: string[] = [];
	for (const [index, title] of [
		`${PREFIX}estimate one`,
		`${PREFIX}estimate two`,
		`${PREFIX}estimate three`,
		`${PREFIX}estimate four`,
		`${PREFIX}estimate five`,
		`${PREFIX}estimate six`,
	].entries()) {
		titles.push(title);
		await taskOf(home, root, title, { rank: `zz00${index + 1}` });
	}

	await gotoOverview(page);
	const needsEstimate = section(page, "needsEstimate");
	// The root has no effort either, so it is a row like the rest.
	for (const title of titles.slice(0, 4)) {
		await expect(needsEstimate.getByText(title)).toBeVisible();
	}
	await expect(needsEstimate.getByText(titles[4])).toHaveCount(0);

	const more = needsEstimate.getByRole("button", { name: "+2 more" });
	await expect(more).toBeVisible({ timeout: 30_000 });
	await more.click();
	await expect(needsEstimate.getByText(titles[5])).toBeVisible();

	await deleteThrowawayHome(page, homeName);
});

test("8: a task with an effort appears in exactly one of the four effort cards", async ({
	page,
}) => {
	const homeName = `${PREFIX}partition home ${Date.now()}`;
	await createThrowawayHome(page, homeName);
	const home = await waitForHomeId(homeName);
	const root = await throwawayRoot(home, `${PREFIX}partition pool root`);
	const quick = `${PREFIX}partition quick task`;
	await taskOf(home, root, quick, { effort: "quick", priority: "normal" });

	await gotoOverview(page);
	await expect(section(page, "quickWins").getByText(quick)).toBeVisible();
	for (const id of ["aFewHours", "needsSplitting", "needsEstimate"]) {
		await expect(section(page, id).getByText(quick)).toHaveCount(0);
	}

	await deleteThrowawayHome(page, homeName);
});

test("9: Recently done shows what completed in the last 30 days, newest first, and disappears entirely when nothing matches", async ({
	page,
}) => {
	const yesterday = `${PREFIX}done yesterday`;
	const tenDays = `${PREFIX}done ten days ago`;
	await createFixtureNode({
		title: yesterday,
		status: "done",
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [],
		dueDate: null,
		completedAt: new Date(Date.now() - 1 * dayInMs),
	});
	await createFixtureNode({
		title: tenDays,
		status: "done",
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [],
		dueDate: null,
		completedAt: new Date(Date.now() - 10 * dayInMs),
	});

	await gotoOverview(page);
	const done = section(page, "recentlyDone");
	await expect(done.getByText(yesterday)).toBeVisible();
	await expect(done.getByText(tenDays)).toBeVisible();
	await expect.poll(() => ordered(done, yesterday, tenDays)).toBe(true);

	// The seed's own empty mode is hide: a home with nothing finished in the
	// window does not render the card at all — not even its heading.
	const homeName = `${PREFIX}done-less home ${Date.now()}`;
	await createThrowawayHome(page, homeName);
	await gotoOverview(page);
	await expect(section(page, "recentlyDone")).toHaveCount(0);
	await expect(section(page, "ongoing")).toBeVisible();

	await deleteThrowawayHome(page, homeName);
});

test("10: +N more expands a card in place and Show less collapses it", async ({
	page,
}) => {
	// Huset's own board already holds two ongoing roots, so four more put the
	// card at six rows: five shown, one held.
	const titles: string[] = [];
	for (const index of [1, 2, 3, 4]) {
		const title = `${PREFIX}expand ${index}`;
		titles.push(title);
		await createFixtureNode({
			title,
			status: "execution",
			parentId: null,
			ancestorIds: [],
			visibility: "shared",
			participantIds: [],
			rank: `zz010${index}`,
			dueDate: null,
			completedAt: null,
		});
	}

	await gotoOverview(page);
	const ongoing = section(page, "ongoing");
	const more = ongoing.getByRole("button", { name: "+1 more" });
	await expect(more).toBeVisible({ timeout: 30_000 });
	await expect(ongoing.getByText(titles[3])).toHaveCount(0);

	await more.click();
	await expect(
		ongoing.getByRole("button", { name: enUS.overview.less }),
	).toBeVisible();
	for (const title of titles) {
		await expect(ongoing.getByText(title)).toBeVisible();
	}

	await ongoing.getByRole("button", { name: enUS.overview.less }).click();
	await expect(more).toBeVisible();
	await expect(ongoing.getByText(titles[3])).toHaveCount(0);
});

test("19: a card whose rows have no priority set still renders, and unset priority or effort sorts last whatever the direction", async ({
	page,
}) => {
	const home = await homeId();
	const marcus = await memberUid("Marcus");
	const dashPath = `/homes/${home}/dashboards/${marcus}`;

	const root = await throwawayRoot(home, `${PREFIX}sort pool root`);
	const low = `${PREFIX}sort low`;
	const urgent = `${PREFIX}sort urgent`;
	const noPriority = `${PREFIX}sort no priority`;
	const noEffort = `${PREFIX}sort no effort`;
	await taskOf(home, root, low, {
		priority: "low",
		effort: "quick",
		rank: "zz001",
	});
	await taskOf(home, root, urgent, {
		priority: "urgent",
		effort: "quick",
		rank: "zz002",
	});
	await taskOf(home, root, noPriority, { effort: "quick", rank: "zz003" });
	await taskOf(home, root, noEffort, { rank: "zz004" });

	// Two cards in the home scope, one per direction: ascending is the one
	// that would read "unset is lowest" and put it *first*, descending is the
	// one that would drop it behind everything by luck.
	await writeDocAt(dashPath, {
		cards: {
			priorityAsc: {
				id: "priorityAsc",
				kind: "filter",
				seedId: null,
				title: `${PREFIX}priority asc`,
				conditions: [{ field: "isRoot", is: false }],
				sort: { field: "priority", direction: "asc" },
				shown: 20,
				max: 20,
				empty: { mode: "say", key: "overview.cards.empty.generic" },
				rank: "zz001",
			},
			effortDesc: {
				id: "effortDesc",
				kind: "filter",
				seedId: null,
				title: `${PREFIX}effort desc`,
				conditions: [{ field: "isRoot", is: false }],
				sort: { field: "effort", direction: "desc" },
				shown: 20,
				max: 20,
				empty: { mode: "say", key: "overview.cards.empty.generic" },
				rank: "zz002",
			},
		},
		hiddenSharedIds: [],
	});

	await gotoOverview(page);

	const ascending = section(page, "priorityAsc");
	await expect(ascending.getByText(low)).toBeVisible();
	await expect(ascending.getByText(urgent)).toBeVisible();
	// Unset priority renders — below both set ones, not first.
	await expect(ascending.getByText(noPriority)).toBeVisible();
	await expect
		.poll(
			async () =>
				(await ordered(ascending, low, urgent)) &&
				(await ordered(ascending, urgent, noPriority)),
		)
		.toBe(true);

	const descending = section(page, "effortDesc");
	await expect(descending.getByText(noEffort)).toBeVisible();
	await expect.poll(() => ordered(descending, low, noEffort)).toBe(true);

	await deleteDocAt(dashPath);
});
