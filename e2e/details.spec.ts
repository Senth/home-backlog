import type { Page } from "@playwright/test";
import { chromium, expect, test } from "@playwright/test";
import { clickMenuItem, gotoAndSettle, ROUTES } from "@/e2e/support/app";
import { SECOND_ACCOUNT, signInAs } from "@/e2e/support/auth";
import {
	createFixtureNode,
	deleteNodesByTitlePrefix,
	homeMemberUids,
	memberUid,
	nodeFields,
	nodeIdByTitle,
	recountChildren,
	waitForNodeIdByTitle,
} from "@/e2e/support/firestore";

/**
 * The people, disclosure, promotion and rename claims from #102 — the phase-6
 * e2e pass over `docs/specs/wip/102-details-participants-rename.md`'s
 * Acceptance section. Claims 13, 18 (the REST API) live in
 * `rest-api.spec.ts`, and claim 19 (an invite, ticked or not) lives in
 * `invite.spec.ts` — both need machinery this file's claims do not.
 *
 * **Pinned to phone width**, like `board.spec.ts`: these are behaviour claims
 * about one card at a time, not about a layout that changes above
 * `compactBreakpoint`.
 */

test.use({ viewport: { width: 390, height: 844 } });

const BOARD = ROUTES[1];
const CARD = '[data-testid="card-container"]';

/** What every node this file creates is titled, so cleanup can find it. */
const PREFIX = "E2E details ";

test.afterEach(async () => {
	await deleteNodesByTitlePrefix(PREFIX);
	// Claim 12 demotes a throwaway root under this real, seeded project, so
	// the delete above just orphaned its counters — see `recountChildren`.
	// Cheap and idempotent for every other test in this file, which never
	// changes them.
	await recountChildren(await nodeIdByTitle("Renovera badrummet"));
});

/** Adds a card to the first column of whichever board is on screen. */
async function addCard(page: Page, title: string): Promise<void> {
	await page
		.getByRole("button", { name: /^Add to /i })
		.first()
		.click();
	await page.getByRole("textbox").first().fill(title);
	await page.getByRole("button", { name: "Add", exact: true }).click();
	await expect(page.getByText(title)).toBeVisible();
}

/** A node's own details, reached directly rather than by clicking a card. */
async function openDetails(
	page: Page,
	nodeId: string,
	readyText: string,
): Promise<void> {
	await page.goto(`/projects/${nodeId}/details`);
	await page.waitForLoadState("networkidle");
	await expect(page.getByText(readyText).first()).toBeVisible({
		timeout: 30_000,
	});
}

/** A node's own board, reached directly — it may have no steps yet. */
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

/** Promotes the named card through `CardMenu › Move under… › Top level`. */
async function promoteToTopLevel(page: Page, title: string): Promise<void> {
	const anchor = page
		.locator(CARD, { hasText: title })
		.getByRole("button", { name: "Card actions" });
	await clickMenuItem(page, anchor, /Move under/);
	await page.getByRole("menuitem", { name: "Top level" }).click();
}

test("1: a new project stores every current member, and every member sees it", async ({
	page,
}) => {
	const title = `${PREFIX}new project`;
	await gotoAndSettle(page, BOARD);
	await addCard(page, title);

	const members = await homeMemberUids();
	expect(members.length).toBeGreaterThan(1);

	const id = await waitForNodeIdByTitle(title);
	await expect
		.poll(
			async () =>
				[...((await nodeFields(id)).participantIds as string[])].sort(),
			{ timeout: 30_000 },
		)
		.toEqual([...members].sort());

	await withSecondAccount(async (annaPage) => {
		await gotoAndSettle(annaPage, BOARD);
		await expect(annaPage.getByText(title)).toBeVisible();
	});
});

test("2: a new step stores an empty participantIds", async ({ page }) => {
	// A throwaway project, not a seeded one: a step added here and then swept
	// by title prefix leaves nothing behind to corrupt. `deleteNodesByTitlePrefix`
	// is a raw Firestore delete — it does not run the app's own counter
	// bookkeeping, so a step deleted out from under a *real* seeded project
	// would leave that project's `childCount` permanently one too high. A
	// throwaway root has no such downstream: it is deleted whole.
	const projectTitle = `${PREFIX}root2`;
	const title = `${PREFIX}step2`;

	await gotoAndSettle(page, BOARD);
	await addCard(page, projectTitle);
	const projectId = await waitForNodeIdByTitle(projectTitle);

	await openBoard(page, projectId, projectTitle);
	await addCard(page, title);

	const id = await waitForNodeIdByTitle(title);
	expect((await nodeFields(id)).participantIds).toEqual([]);
});

test("3: unticking participants down to one locks the last row", async ({
	page,
}) => {
	const title = `${PREFIX}lock test`;
	await gotoAndSettle(page, BOARD);
	await addCard(page, title);
	await page.getByText(title).click();
	await page.waitForURL(/\/projects\/[^/]+\/details$/);

	// The participants field renders first, before the assignees field, so
	// `.first()` is the participants row and not the identically-named one
	// below it.
	await page.getByRole("checkbox", { name: "Anna Maria Berg" }).first().click();

	const last = page.getByRole("checkbox", { name: "Marcus" }).first();
	await expect(last).toHaveAttribute("aria-checked", "true");
	await expect(last).toHaveAttribute("aria-disabled", "true");
	await expect(
		page.getByText("At least one person has to be in on a project."),
	).toBeVisible();
});

test("4: a project narrowed to one member is absent from another member's board, and still opens by direct link", async ({
	page,
}) => {
	const title = `${PREFIX}narrowed`;
	await gotoAndSettle(page, BOARD);
	await addCard(page, title);
	await page.getByText(title).click();
	await page.waitForURL(/\/projects\/([^/]+)\/details$/);
	const nodeId = new URL(page.url()).pathname.split("/")[2] as string;

	await page.getByRole("checkbox", { name: "Anna Maria Berg" }).first().click();
	await expect
		.poll(
			async () =>
				((await nodeFields(nodeId)).participantIds as string[]).length,
			{ timeout: 30_000 },
		)
		.toBe(1);

	await withSecondAccount(async (annaPage) => {
		await gotoAndSettle(annaPage, BOARD);
		await expect(annaPage.getByText(title)).toHaveCount(0);

		await annaPage.goto(`/projects/${nodeId}/details`);
		await annaPage.waitForLoadState("networkidle");
		await expect(annaPage.getByText(title).first()).toBeVisible({
			timeout: 30_000,
		});
	});
});

test("5: nobody assigned on a one-participant step hides Who's doing it?", async ({
	page,
}) => {
	const marcus = await memberUid("Marcus");
	const rootId = await createFixtureNode({
		title: `${PREFIX}root5`,
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [marcus],
		assigneeIds: [],
	});
	const stepTitle = `${PREFIX}step5`;
	const stepId = await createFixtureNode({
		title: stepTitle,
		parentId: rootId,
		ancestorIds: [rootId],
		visibility: "shared",
		participantIds: [],
		assigneeIds: [],
	});

	await openDetails(page, stepId, stepTitle);
	await expect(page.getByText("Who's doing it?")).toHaveCount(0);
});

test("6: an assigned step shows Who's doing it?, and unticking them clears assigneeIds", async ({
	page,
}) => {
	const marcus = await memberUid("Marcus");
	const rootId = await createFixtureNode({
		title: `${PREFIX}root6`,
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [marcus],
		assigneeIds: [],
	});
	const stepTitle = `${PREFIX}step6`;
	const stepId = await createFixtureNode({
		title: stepTitle,
		parentId: rootId,
		ancestorIds: [rootId],
		visibility: "shared",
		participantIds: [],
		assigneeIds: [marcus],
	});

	await openDetails(page, stepId, stepTitle);
	const control = page.getByRole("checkbox", { name: "Marcus" });
	await expect(control).toBeVisible();
	await control.click();

	await expect
		.poll(async () => (await nodeFields(stepId)).assigneeIds, {
			timeout: 30_000,
		})
		.toEqual([]);
});

test("7: a stale assignee still renders their sentence, and Remove clears them", async ({
	page,
}) => {
	const marcus = await memberUid("Marcus");
	const anna = await memberUid("Anna Maria Berg");
	const rootTitle = `${PREFIX}root7`;
	const rootId = await createFixtureNode({
		title: rootTitle,
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [marcus],
		assigneeIds: [],
	});
	const stepTitle = `${PREFIX}step7`;
	const stepId = await createFixtureNode({
		title: stepTitle,
		parentId: rootId,
		ancestorIds: [rootId],
		visibility: "shared",
		participantIds: [],
		assigneeIds: [anna],
	});

	await openDetails(page, stepId, stepTitle);
	await expect(
		page.getByText(
			`Anna Maria Berg is doing this but is no longer in ${rootTitle}.`,
		),
	).toBeVisible();

	await page.getByRole("button", { name: "Remove Anna Maria Berg" }).click();

	await expect
		.poll(async () => (await nodeFields(stepId)).assigneeIds, {
			timeout: 30_000,
		})
		.toEqual([]);
});

test("8: no detail screen, at any depth, carries the retired sentences", async ({
	page,
}) => {
	const removed = [
		"Move to the top level",
		"Only a whole project can be kept to yourself",
		"Only people in",
	];

	const projectId = await nodeIdByTitle("Renovera badrummet");
	const stepId = await nodeIdByTitle("Mät upp rummet");

	await openDetails(page, projectId, "Renovera badrummet");
	const projectText = await page.locator("body").innerText();

	await openDetails(page, stepId, "Mät upp rummet");
	const stepText = await page.locator("body").innerText();

	for (const phrase of removed) {
		expect(
			projectText,
			`"${phrase}" on the project's own details`,
		).not.toContain(phrase);
		expect(stepText, `"${phrase}" on a step's details`).not.toContain(phrase);
	}
});

test("9: a step can still be promoted through Move under…, Top level", async ({
	page,
}) => {
	// A throwaway project, for the same reason test 2 uses one: promoting the
	// step out is what this claim is about, but a run that fails *before* the
	// promote lands would otherwise leave a raw-deleted child's count stuck on
	// a project this suite does not own.
	const projectTitle = `${PREFIX}root9`;
	const stepTitle = `${PREFIX}promote9`;
	await gotoAndSettle(page, BOARD);
	await addCard(page, projectTitle);
	const projectId = await waitForNodeIdByTitle(projectTitle);

	await openBoard(page, projectId, projectTitle);
	await addCard(page, stepTitle);
	const stepId = await waitForNodeIdByTitle(stepTitle);

	await promoteToTopLevel(page, stepTitle);

	await expect
		.poll(async () => (await nodeFields(stepId)).parentId, { timeout: 30_000 })
		.toBeNull();
});

test("10: promoting a step out of a narrowed project gives the new root that participant", async ({
	page,
}) => {
	// A throwaway narrowed project rather than a seeded one — see test 2's
	// comment on why a real project never hosts a throwaway child here.
	const projectTitle = `${PREFIX}root10`;
	const stepTitle = `${PREFIX}promote10`;
	const marcus = await memberUid("Marcus");

	const projectId = await createFixtureNode({
		title: projectTitle,
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [marcus],
		assigneeIds: [],
	});
	await openBoard(page, projectId, projectTitle);
	await addCard(page, stepTitle);
	const stepId = await waitForNodeIdByTitle(stepTitle);

	await promoteToTopLevel(page, stepTitle);

	await expect
		.poll(async () => (await nodeFields(stepId)).participantIds, {
			timeout: 30_000,
		})
		.toEqual([marcus]);
});

test("11: promoting a step out of a private project keeps it private, with the same participants", async ({
	page,
}) => {
	// A throwaway private project rather than a seeded one — see test 2's
	// comment on why a real project never hosts a throwaway child here.
	const projectTitle = `${PREFIX}root11`;
	const stepTitle = `${PREFIX}promote11`;
	const marcus = await memberUid("Marcus");
	const anna = await memberUid("Anna Maria Berg");

	const projectId = await createFixtureNode({
		title: projectTitle,
		parentId: null,
		ancestorIds: [],
		visibility: "private",
		participantIds: [marcus, anna],
		assigneeIds: [],
	});
	const rootFields = await nodeFields(projectId);

	await openBoard(page, projectId, projectTitle);
	await addCard(page, stepTitle);
	const stepId = await waitForNodeIdByTitle(stepTitle);

	await promoteToTopLevel(page, stepTitle);

	await expect
		.poll(async () => (await nodeFields(stepId)).parentId, { timeout: 30_000 })
		.toBeNull();

	const stepFields = await nodeFields(stepId);
	expect(stepFields.visibility).toBe("private");
	expect([...(stepFields.participantIds as string[])].sort()).toEqual(
		[...(rootFields.participantIds as string[])].sort(),
	);
});

test("12: demoting a shared root under a project clears its participantIds", async ({
	page,
}) => {
	const marcus = await memberUid("Marcus");
	const rootTitle = `${PREFIX}demote12`;
	const rootId = await createFixtureNode({
		title: rootTitle,
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [marcus],
		assigneeIds: [],
		status: "backlog",
	});

	await gotoAndSettle(page, BOARD);
	await expect(page.locator(CARD, { hasText: rootTitle })).toBeVisible();

	const anchor = page
		.locator(CARD, { hasText: rootTitle })
		.getByRole("button", { name: "Card actions" });
	await clickMenuItem(page, anchor, /Move under/);
	await page
		.getByRole("menuitem", { name: "Renovera badrummet", exact: true })
		.click();

	await expect
		.poll(async () => (await nodeFields(rootId)).participantIds, {
			timeout: 30_000,
		})
		.toEqual([]);
});

test("14: Who can see what? opens two headed sections and a link to the project's own details", async ({
	page,
}) => {
	const stepId = await nodeIdByTitle("Mät upp rummet");
	const projectId = await nodeIdByTitle("Renovera badrummet");

	await openDetails(page, stepId, "Mät upp rummet");

	// Paper's `List.Accordion` announced this as a button that never said whether
	// it was open — the third compound component in this codebase to do it — so
	// the row carries the semantics itself and the browser has to agree.
	const disclosure = page.getByRole("button", { name: "Who can see what?" });
	await expect(disclosure).toHaveAttribute("aria-expanded", "false");
	await disclosure.click();
	await expect(disclosure).toHaveAttribute("aria-expanded", "true");
	await expect(page.getByText("Who's in on a project")).toBeVisible();
	await expect(page.getByText("Who's doing a step")).toBeVisible();

	const action = page.getByRole("button", {
		name: "Change who's in on Renovera badrummet",
	});
	await expect(action).toBeVisible();
	await action.click();

	await page.waitForURL(new RegExp(`/projects/${projectId}/details$`));
});

test("15: renaming from the details app bar updates the screen and the board behind it, and survives a reload", async ({
	page,
}) => {
	const title = `${PREFIX}rename15 start`;
	const renamed = `${PREFIX}rename15 renamed`;
	await gotoAndSettle(page, BOARD);
	await addCard(page, title);
	await page.getByText(title).click();
	await page.waitForURL(/\/projects\/[^/]+\/details$/);

	await clickMenuItem(
		page,
		page.getByRole("button", { name: "Card actions" }),
		"Rename",
	);
	// `.last()`: the details screen behind the dialog has a textbox of its
	// own — the notes field — so the plain locator is ambiguous here, unlike
	// on a board.
	await page.getByRole("textbox").last().fill(renamed);
	await page.getByRole("button", { name: "Rename", exact: true }).click();

	await expect(page.getByText(renamed).first()).toBeVisible();

	await page.reload();
	await expect(page.getByText(renamed).first()).toBeVisible({
		timeout: 30_000,
	});

	await page.goBack();
	await expect(page.locator(CARD, { hasText: renamed })).toBeVisible();
});

test("16: renaming from a board's own app bar updates the app bar and the breadcrumb", async ({
	page,
}) => {
	const title = `${PREFIX}rename16 start`;
	const renamed = `${PREFIX}rename16 renamed`;
	await gotoAndSettle(page, BOARD);
	await addCard(page, title);
	const id = await waitForNodeIdByTitle(title);

	await openBoard(page, id, title);

	await clickMenuItem(
		page,
		page.getByRole("button", { name: "Board actions" }),
		"Rename",
	);
	await page.getByRole("textbox").fill(renamed);
	await page.getByRole("button", { name: "Rename", exact: true }).click();

	// The app-bar title and the breadcrumb's current crumb are the same string,
	// rendered twice — so both having updated is both of them being on screen.
	await expect(page.getByText(renamed)).toHaveCount(2);
});

/**
 * Runs a check as a second account, in a browser of its own — see
 * `e2e/support/auth.ts`'s doc comment for why a second identity needs one.
 *
 * A dedicated `chromium.launch()` rather than `browser.newContext()` on the
 * worker's shared browser: IndexedDB — which is where Firebase keeps the
 * signed-in session — was observed leaking across contexts of the same
 * `chrome-headless-shell` process in this stack, so a context alone signed
 * a "fresh" page in as Marcus. A second OS process is the isolation that
 * actually holds.
 */
async function withSecondAccount(
	run: (page: Page) => Promise<void>,
): Promise<void> {
	const browser = await chromium.launch();
	try {
		const context = await browser.newContext();
		const annaPage = await context.newPage();
		// Anna is a member of `Huset` alone, so `signInAs` already lands her
		// there — nothing left to navigate before `run` gets its own route.
		await signInAs(annaPage, SECOND_ACCOUNT);
		await run(annaPage);
	} finally {
		await browser.close();
	}
}

test("23: the board's overflow carries a mark when the card behind it has details", async ({
	page,
}) => {
	// The mark used to sit on a dedicated info action, which #102 folded into the
	// overflow to give the title room at 200%. It is the only thing that says
	// there is something in that menu, so it moved with the action rather than
	// being dropped.
	const withDetails = await nodeIdByTitle("Byt badrumsfläkten");
	const without = await nodeIdByTitle("Renovera badrummet");

	await openBoard(page, withDetails, "Byt badrumsfläkten");
	await expect(page.getByTestId("board-details-mark")).toBeVisible();

	await openBoard(page, without, "Renovera badrummet");
	await expect(page.getByTestId("board-details-mark")).toHaveCount(0);
});
