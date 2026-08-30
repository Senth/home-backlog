import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { createThrowawayHome, deleteThrowawayHome } from "@/e2e/support/app";
import { SECOND_ACCOUNT, signInAs } from "@/e2e/support/auth";
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

/*
 * ---------------------------------------------------------------------------
 * Phase 3 — the editor. Claims 11–16 and 18: scopes, reorder, hide, create,
 * edit, remove, restore, and the privacy predicate on a composed card.
 * ---------------------------------------------------------------------------
 */

/** The tune action's name, which is the editor's own title. */
const EDITOR = enUS.overview.cards.editor.title;
/** What a menu says, from the file both locales are checked against. */
const MENU = enUS.overview.cards.menu;

/**
 * Overview, then the editor behind the tune action. The editor is ready when
 * any card row is up — the list is never empty, because the seeds are there
 * unless a test replaced the config with cards of its own.
 */
async function gotoEditor(page: Page): Promise<void> {
	await gotoOverview(page);
	await page.getByRole("button", { name: EDITOR }).click();
	await page
		.locator('[data-testid^="overview-editor-card-"]')
		.first()
		.waitFor({ state: "visible", timeout: 30_000 });
}

/**
 * `clickMenuItem`, hardened for the editor: the screens here hold live
 * listeners that keep settling after their own readiness marker, so a menu
 * opened too early either never renders its items or swallows the next
 * anchor click — the state that left `clickMenuItem` retrying against its
 * own open menu. Between attempts, any menu left open is dismissed with
 * Escape, the way a person would close one.
 */
async function openCardMenu(
	page: Page,
	anchor: Locator,
	itemName: string | RegExp,
	attempts = 8,
): Promise<void> {
	for (let attempt = 1; attempt <= attempts; attempt++) {
		await page.keyboard.press("Escape").catch(() => undefined);
		await page.waitForTimeout(400);
		try {
			await anchor.click({ timeout: 2_500 });
		} catch {
			continue;
		}
		try {
			const item = page.getByRole("menuitem", { name: itemName });
			await item.waitFor({ state: "visible", timeout: 2_500 });
			await item.click();
			return;
		} catch {
			// The menu opened without its items, or not at all. Again.
		}
	}
	throw new Error(
		`the menu item ${String(itemName)} never appeared for ${anchor}`,
	);
}

/** Two sections' order on the read screen, polled the way `ordered` is. */
function sectionOrder(
	page: Page,
	above: string,
	below: string,
): Promise<boolean> {
	return ordered2(section(page, above), section(page, below));
}

/** `ordered` over two locators already resolved. */
async function ordered2(above: Locator, below: Locator): Promise<boolean> {
	const aboveBox = await above.boundingBox();
	const belowBox = await below.boundingBox();
	expect(aboveBox, "the card above was not on screen").not.toBeNull();
	expect(belowBox, "the card below was not on screen").not.toBeNull();
	return (aboveBox?.y ?? 0) < (belowBox?.y ?? 0);
}

/** One filter card's stored shape, with what a fixture needs to render it. */
function storedCard(
	id: string,
	title: string,
	overrides: Record<string, Json> = {},
): Record<string, Json> {
	return {
		id,
		kind: "filter",
		seedId: null,
		title,
		conditions: [],
		sort: null,
		shown: 20,
		max: 20,
		empty: { mode: "say", key: "overview.cards.empty.generic" },
		rank: "VA",
		...overrides,
	};
}

test("11: a card marked All my homes renders in every home the account belongs to, and reordering it in one home reorders it in the other", async ({
	page,
}) => {
	const marcus = await memberUid("Marcus");
	const configPath = `/users/${marcus}/dashboard/config`;

	// Two global cards, the second ranked below the first. Reorder moves the
	// second above the first — through the menu, which is the accessible
	// alternative the editor exists to offer.
	await writeDocAt(configPath, {
		cards: {
			e2eFirst: storedCard("e2eFirst", `${PREFIX}first`, { rank: "VA" }),
			e2eSecond: storedCard("e2eSecond", `${PREFIX}second`, { rank: "VB" }),
		},
		seededAt: new Date(),
	});

	await gotoOverview(page);
	await expect(section(page, "e2eFirst")).toBeVisible();
	await expect
		.poll(() => sectionOrder(page, "e2eFirst", "e2eSecond"))
		.toBe(true);

	// Move the second card up, and wait for the write to reach the config the
	// other home will read it from.
	await gotoEditor(page);
	await openCardMenu(
		page,
		page.getByTestId("overview-editor-menu-e2eSecond"),
		MENU.moveUp,
	);
	await expect
		.poll(
			async () => {
				const config = await readDocAt(configPath);
				const cards = config?.cards as Record<string, { rank?: string }> | null;
				return (cards?.e2eSecond?.rank ?? "") < (cards?.e2eFirst?.rank ?? "");
			},
			{ timeout: 30_000 },
		)
		.toBe(true);

	// The screen agrees, here…
	await gotoOverview(page);
	await expect
		.poll(() => sectionOrder(page, "e2eSecond", "e2eFirst"))
		.toBe(true);

	// …and in the other home, because a global card has one rank.
	const homeName = `${PREFIX}global home ${Date.now()}`;
	await createThrowawayHome(page, homeName);
	await gotoOverview(page);
	await expect(section(page, "e2eSecond")).toBeVisible();
	await expect(section(page, "e2eFirst")).toBeVisible();
	await expect
		.poll(() => sectionOrder(page, "e2eSecond", "e2eFirst"))
		.toBe(true);

	await deleteThrowawayHome(page, homeName);
	await deleteDocAt(configPath);
});

test("12: a card marked Only this home renders in that home only", async ({
	page,
}) => {
	const home = await homeId();
	const marcus = await memberUid("Marcus");
	const dashPath = `/homes/${home}/dashboards/${marcus}`;

	await writeDocAt(dashPath, {
		cards: {
			e2eHomeCard: storedCard("e2eHomeCard", `${PREFIX}home only`, {
				rank: "V8",
			}),
		},
		hiddenSharedIds: [],
	});

	await gotoOverview(page);
	await expect(section(page, "e2eHomeCard")).toBeVisible();

	const homeName = `${PREFIX}elsewhere home ${Date.now()}`;
	await createThrowawayHome(page, homeName);
	await gotoOverview(page);
	await expect(section(page, "e2eHomeCard")).toHaveCount(0);

	await deleteThrowawayHome(page, homeName);
	await deleteDocAt(dashPath);
});

test("13: a card marked Everyone here renders for every member; hiding it removes it from that member's screen alone, and the others still see it", async ({
	page,
	browser,
}) => {
	const home = await homeId();
	const marcus = await memberUid("Marcus");
	const sharedPath = `/homes/${home}/dashboardCards/e2eShared`;
	const dashPath = `/homes/${home}/dashboards/${marcus}`;

	await writeDocAt(sharedPath, storedCard("e2eShared", `${PREFIX}shared`));

	await gotoOverview(page);
	await expect(section(page, "e2eShared")).toBeVisible();

	// Anna, on her own fresh page, sees the same card — it is shared with the
	// home, and she is a member of it.
	const annaContext = await browser.newContext();
	const annaPage = await annaContext.newPage();
	await signInAs(annaPage, SECOND_ACCOUNT);
	await gotoOverview(annaPage);
	await expect(section(annaPage, "e2eShared")).toBeVisible();

	// Marcus hides it from his own screen. His write lands on his own
	// dashboards doc, never on the shared card.
	await openCardMenu(
		page,
		page.getByTestId("overview-card-menu-e2eShared"),
		MENU.hide,
	);
	await expect(section(page, "e2eShared")).toHaveCount(0);
	await page.reload();
	await expect(section(page, "e2eShared")).toHaveCount(0);
	await expect
		.poll(async () => (await readDocAt(dashPath))?.hiddenSharedIds)
		.toEqual(["e2eShared"]);

	// Anna still sees it, and the card itself never changed.
	await expect(section(annaPage, "e2eShared")).toBeVisible();
	const shared = await readDocAt(sharedPath);
	expect(shared?.title).toBe(`${PREFIX}shared`);

	await annaContext.close();
	await deleteDocAt(sharedPath);
	await deleteDocAt(dashPath);
});

test("14: the editor creates a card from conditions and the card renders with matching rows on Overview", async ({
	page,
}) => {
	const home = await homeId();
	const marcus = await memberUid("Marcus");

	const root = await throwawayRoot(home, `${PREFIX}assign root`);
	await taskOf(home, root, `${PREFIX}assign mine`, {
		assigneeIds: [marcus],
	});
	await taskOf(home, root, `${PREFIX}assign other`, {
		assigneeIds: [await memberUid("Anna Maria Berg")],
	});

	await gotoEditor(page);
	await page
		.getByRole("button", { name: enUS.overview.cards.editor.add })
		.click();

	// A title, then the two conditions the claim names: assigned to me, and
	// not a root. Every choice is a chip in plain words.
	const sheet = page.getByTestId("overview-card-edit");
	await sheet.getByRole("textbox").first().fill(`${PREFIX}mine`);
	await sheet.getByRole("button", { name: enUS.detail.assignees }).click();
	await sheet
		.getByRole("button", { name: enUS.overview.cards.field.me, exact: true })
		.click();
	await sheet
		.getByRole("button", { name: enUS.overview.cards.field.root })
		.click();
	await sheet
		.getByRole("button", { name: enUS.overview.cards.field.isStep })
		.click();
	await sheet.getByRole("button", { name: enUS.manageHome.save }).click();

	// The card is in the editor's list. Paper's List.Item suffixes its own
	// `-content` test id from the row's, so the prefix matches two elements.
	await expect(
		page
			.locator(
				'[data-testid^="overview-editor-card-"]:not([data-testid$="-content"])',
			)
			.filter({ hasText: `${PREFIX}mine` }),
	).toBeVisible();

	// …and on the screen, holding the row the conditions match and not the
	// one they do not.
	await gotoOverview(page);
	const mine = page
		.locator('[data-testid^="overview-section-"]')
		.filter({ hasText: `${PREFIX}mine` });
	await expect(mine.getByText(`${PREFIX}assign mine`)).toBeVisible();
	await expect(mine.getByText(`${PREFIX}assign other`)).toHaveCount(0);

	// The card the editor just made is the only thing this test leaves in the
	// global config; wait for the write to reach the backend, then take the
	// config away so nothing leaks past this test.
	await expect
		.poll(async () => {
			const config = await readDocAt(`/users/${marcus}/dashboard/config`);
			const cards = (config?.cards ?? {}) as Record<string, { title?: string }>;
			return Object.values(cards).some(
				(card) => card.title === `${PREFIX}mine`,
			);
		})
		.toBe(true);
	await deleteDocAt(`/users/${marcus}/dashboard/config`);
});

test("15: editing a card's conditions changes its rows; removing a card takes it off the screen and it stays removed after a reload", async ({
	page,
}) => {
	const home = await homeId();
	const marcus = await memberUid("Marcus");
	const dashPath = `/homes/${home}/dashboards/${marcus}`;

	const root = await throwawayRoot(home, `${PREFIX}editroot root`);
	await taskOf(home, root, `${PREFIX}editroot step`, {});

	await writeDocAt(dashPath, {
		cards: {
			e2eEdit: storedCard("e2eEdit", `${PREFIX}editcard`, {
				rank: "V9",
				conditions: [{ field: "isRoot", is: true }],
			}),
		},
		hiddenSharedIds: [],
	});

	await gotoOverview(page);
	const edit = section(page, "e2eEdit");
	await expect(edit.getByText(`${PREFIX}editroot root`)).toBeVisible();

	// Edit: the project-or-step condition flips from project to step, so the
	// card's rows swap from the root to its step.
	await gotoEditor(page);
	await openCardMenu(
		page,
		page.getByTestId("overview-editor-menu-e2eEdit"),
		MENU.edit,
	);
	await page.waitForTimeout(2_500);
	const sheet = page.getByTestId("overview-card-edit");
	await sheet
		.getByRole("button", { name: enUS.overview.cards.field.root })
		.click();
	await sheet
		.getByRole("button", { name: enUS.overview.cards.field.isStep })
		.click();
	await sheet.getByRole("button", { name: enUS.manageHome.save }).click();

	await gotoOverview(page);
	const edited = section(page, "e2eEdit");
	await expect(edited.getByText(`${PREFIX}editroot step`)).toBeVisible();
	await expect(edited.getByText(`${PREFIX}editroot root`)).toHaveCount(0);

	// Remove, and the card is gone — here, and after a reload, because the
	// config no longer holds it.
	await gotoEditor(page);
	await openCardMenu(
		page,
		page.getByTestId("overview-editor-menu-e2eEdit"),
		MENU.remove,
	);
	await page.getByRole("button", { name: MENU.remove }).click();

	await gotoOverview(page);
	await expect(section(page, "e2eEdit")).toHaveCount(0);
	await page.reload();
	await expect(section(page, "e2eEdit")).toHaveCount(0);

	await deleteDocAt(dashPath);
});

test("16: a removed seed restored from the editor returns with its original settings", async ({
	page,
}) => {
	const marcus = await memberUid("Marcus");
	const configPath = `/users/${marcus}/dashboard/config`;

	// From the seeds: open Overview once with no config, so the seven are
	// written, then remove one through the editor.
	await deleteDocAt(configPath);
	await gotoOverview(page);
	await expect(section(page, "quickWins")).toBeVisible();

	await gotoEditor(page);
	await openCardMenu(
		page,
		page.getByTestId("overview-editor-menu-quickWins"),
		MENU.remove,
	);
	await page.getByRole("button", { name: MENU.remove }).click();

	// The editor is pushed over the read screen, whose sections are still in
	// the DOM under it — so "removed" is asserted on the editor's own list,
	// where the row goes and the Removed originals section appears.
	await expect(page.getByTestId("overview-editor-card-quickWins")).toHaveCount(
		0,
	);

	// The editor keeps the deleted original, named, under Removed originals.
	const removed = page.getByTestId("overview-editor-removed");
	await expect(
		removed.getByText(enUS.overview.cards.title.quickWins),
	).toBeVisible();

	// Restore puts it back with the seed's own settings — not a fresh copy.
	await removed
		.getByRole("button", { name: enUS.overview.cards.editor.restore })
		.click();
	await expect(
		page.getByTestId("overview-editor-card-quickWins"),
	).toBeVisible();

	await gotoOverview(page);
	await expect(section(page, "quickWins")).toBeVisible();
	await expect
		.poll(async () => {
			const config = await readDocAt(configPath);
			return (config?.cards as Record<string, Record<string, Json>> | undefined)
				?.quickWins?.max;
		})
		.toBe(3);
	const config = await readDocAt(configPath);
	const restored = (config?.cards as Record<string, Record<string, Json>>)
		.quickWins;
	expect(restored.shown).toBe(3);
	expect(restored.title).toBeNull();
	expect(restored.empty).toEqual({
		mode: "say",
		key: "overview.cards.empty.quickWins",
	});

	await deleteDocAt(configPath);
});

test("18: with another member's private project present that matches a card's conditions, Overview still loads, and that project appears only for its participant", async ({
	page,
	browser,
}) => {
	const home = await homeId();
	const anna = await memberUid("Anna Maria Berg");

	await writeDocAt(
		`/homes/${home}/dashboardCards/e2ePrivate`,
		storedCard("e2ePrivate", `${PREFIX}privatecard`, {
			rank: "VA",
			conditions: [{ field: "isRoot", is: true }],
		}),
	);

	// Anna's private project matches the shared card's conditions on the
	// fields themselves — but the pool's privacy predicate still decides who
	// sees it.
	await createFixtureNode({
		title: `${PREFIX}private project`,
		status: "execution",
		parentId: null,
		ancestorIds: [],
		visibility: "private",
		participantIds: [anna],
		dueDate: null,
		completedAt: null,
	});

	await gotoOverview(page);
	// Marcus's screen loads and renders his cards…
	await expect(section(page, "e2ePrivate")).toBeVisible();
	// …and Anna's private work is not on it.
	await expect(page.getByText(`${PREFIX}private project`)).toHaveCount(0);

	const annaContext = await browser.newContext();
	const annaPage = await annaContext.newPage();
	await signInAs(annaPage, SECOND_ACCOUNT);
	await gotoOverview(annaPage);
	await expect(section(annaPage, "e2ePrivate")).toBeVisible();
	await expect(
		section(annaPage, "e2ePrivate").getByText(`${PREFIX}private project`),
	).toBeVisible();

	await annaContext.close();
	await deleteDocAt(`/homes/${home}/dashboardCards/e2ePrivate`);
});
