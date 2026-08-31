import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { FUNCTIONS_BASE, withApiKey } from "@/e2e/support/api";
import { clickMenuItem, gotoAndSettle, ROUTES } from "@/e2e/support/app";
import {
	createFixtureLocation,
	createFixtureNode,
	deleteLocationsByTitlePrefix,
	deleteNodesByTitlePrefix,
	homeId,
	locationFields,
	locationTitles,
	memberUid,
	nodeFields,
	waitForLocationIdByTitle,
} from "@/e2e/support/firestore";

/**
 * The eight `[test]` acceptance claims of #50 — the location tree.
 *
 * Claims 1–6 walk the Locations tab the way Ingrid does: add, nest, move,
 * delete, rename, and the same flows with the network cut. Claim 7 plants an
 * anchored node through the emulator's superuser path (the rules do not apply
 * to those writes, which is the point — the node-maintenance trigger is the
 * only rule-respecting writer of the node fields), then moves and deletes the
 * place through the UI and asks the backend what happened to the node's path.
 * Claim 8 drives the location verbs over REST with a real API key.
 *
 * Every place a test creates is titled `E2E loc …` and swept in the
 * `afterEach`, and the fixture setup sweeps the same prefix before the suite
 * starts, for the run that was killed before its `finally` could. A place
 * left behind empties no board, but it would leave the Locations screen
 * waiting on an empty state that never comes — `screen.locations`' ready
 * marker only exists while the tree is empty.
 */

const LOCATIONS = ROUTES[2];
const PREFIX = "E2E loc ";

const ACTIONS = "Location actions";

test.afterEach(async () => {
	await deleteLocationsByTitlePrefix("E2E loc");
	await deleteNodesByTitlePrefix("E2E loc");
});

/**
 * A tree row: the innermost box holding the place's name and its actions
 * button. The row is the one box no visible string identifies by id — the
 * name and the `aria-label` on the overflow button are what it has.
 */
function row(page: Page, title: string): Locator {
	return page
		.locator("div")
		.filter({ has: page.getByText(title, { exact: true }) })
		.filter({ has: page.getByRole("button", { name: ACTIONS }) })
		.last();
}

/** A row's overflow-menu anchor. */
function menuAnchor(page: Page, title: string): Locator {
	return row(page, title).getByRole("button", { name: ACTIONS });
}

/** The row's indent, in px — nesting made exact rather than eyeballed. */
async function indentOf(locator: Locator): Promise<number> {
	return locator.evaluate((element) =>
		parseFloat(element.style.paddingLeft || "0"),
	);
}

/**
 * Creates a root place from the empty state's button or the FAB, whichever
 * this screen is showing, and waits until the row is on it.
 */
async function addRoot(page: Page, title: string): Promise<void> {
	await page.getByRole("button", { name: "Add location" }).click();
	await page.getByRole("textbox").fill(title);
	await page.getByRole("button", { name: "Add", exact: true }).click();
	await expect(row(page, title)).toBeVisible();
}

/** Nests a place under a row via its menu's Add under…, and waits for the row. */
async function addUnder(
	page: Page,
	parent: string,
	title: string,
): Promise<void> {
	await clickMenuItem(page, menuAnchor(page, parent), "Add under…");
	await page.getByRole("textbox").fill(title);
	await page.getByRole("button", { name: "Add", exact: true }).click();
	await expect(row(page, title)).toBeVisible();
}

/**
 * Opens a row's menu without choosing anything, and leaves it open.
 *
 * The settle-and-retry shape `clickMenuItem` documents for Paper's Menu race,
 * with a visibility wait instead of an item click — the claims that need this
 * read the menu's disabled state before anything is chosen.
 */
async function openMenu(page: Page, anchor: Locator): Promise<void> {
	await page.waitForTimeout(2_500);
	for (let attempt = 1; attempt <= 4; attempt++) {
		await anchor.click();
		try {
			await page
				.getByRole("menuitem", { name: "Add under…" })
				.first()
				.waitFor({ state: "visible", timeout: 4_000 });
			return;
		} catch (reason) {
			if (attempt === 4) throw reason;
		}
	}
}

/** Closes an open row menu by choosing nothing — a tap on the overlay. */
async function closeMenu(page: Page): Promise<void> {
	await page.mouse.click(10, 300);
	await expect(
		page.getByRole("menuitem", { name: "Add under…" }).first(),
	).toHaveCount(0);
}

test("1: Add location at the top level creates a root place, Add under… from a row nests a place under that row, and both are in the tree after a reload", async ({
	page,
}) => {
	const root = `${PREFIX}garden ${Date.now()}`;
	const child = `${PREFIX}greenhouse ${Date.now()}`;

	await gotoAndSettle(page, LOCATIONS);
	await addRoot(page, root);
	await addUnder(page, root, child);

	const rootId = await waitForLocationIdByTitle(root);
	const childId = await waitForLocationIdByTitle(child);

	await page.reload();
	await expect(row(page, root)).toBeVisible();
	await expect(row(page, child)).toBeVisible();

	// The nesting is on the page, not only in the documents: the child sits
	// one indent step in, and after it in the tree order.
	expect(await indentOf(row(page, root))).toBe(0);
	expect(await indentOf(row(page, child))).toBeGreaterThan(0);

	const rootFields = await locationFields(rootId);
	expect(rootFields.parentId).toBeNull();
	const childFields = await locationFields(childId);
	expect(childFields.parentId).toBe(rootId);
	expect(childFields.ancestorIds).toEqual([rootId]);
});

test("2: Move under… re-homes a place and its whole subtree: after a reload the moved place and its descendants hang from the new parent", async ({
	page,
}) => {
	const target = `${PREFIX}garage ${Date.now()}`;
	const moved = `${PREFIX}garden ${Date.now()}`;
	const deep = `${PREFIX}orchard ${Date.now()}`;

	await gotoAndSettle(page, LOCATIONS);
	await addRoot(page, target);
	await addRoot(page, moved);
	await addUnder(page, moved, deep);

	const targetId = await waitForLocationIdByTitle(target);
	const movedId = await waitForLocationIdByTitle(moved);
	const deepId = await waitForLocationIdByTitle(deep);

	await clickMenuItem(page, menuAnchor(page, moved), "Move under…");
	await page.getByRole("menuitem", { name: target }).click();

	await expect
		.poll(async () => (await locationFields(movedId)).ancestorIds, {
			timeout: 30_000,
		})
		.toEqual([targetId]);
	const movedFields = await locationFields(movedId);
	expect(movedFields.parentId).toBe(targetId);

	await page.reload();
	await expect(row(page, moved)).toBeVisible();
	await expect(row(page, deep)).toBeVisible();

	// The descendant hangs from the moved place under its new parent: its own
	// parent did not change, its path did.
	const deepFields = await locationFields(deepId);
	expect(deepFields.parentId).toBe(movedId);
	expect(deepFields.ancestorIds).toEqual([targetId, movedId]);
});

test("3: The destination picker offers Top level and renders the moved place's own subtree as disabled; choosing a place inside it writes nothing", async ({
	page,
}) => {
	const root = `${PREFIX}garden ${Date.now()}`;
	const child = `${PREFIX}greenhouse ${Date.now()}`;

	await gotoAndSettle(page, LOCATIONS);
	await addRoot(page, root);
	await addUnder(page, root, child);
	const rootId = await waitForLocationIdByTitle(root);

	await clickMenuItem(page, menuAnchor(page, root), "Move under…");

	await expect(page.getByRole("menuitem", { name: "Top level" })).toBeVisible();

	// The moved place itself and everything under it refuse the move before it
	// is committed.
	await expect(page.getByRole("menuitem", { name: root })).toHaveAttribute(
		"aria-disabled",
		"true",
	);
	await expect(page.getByRole("menuitem", { name: child })).toHaveAttribute(
		"aria-disabled",
		"true",
	);

	// Choosing inside the subtree does nothing: the tap lands on a disabled
	// item, the menu stays, and no write happens anywhere.
	await page
		.getByRole("menuitem", { name: child })
		.click({ force: true, timeout: 4_000 })
		.catch(() => {});
	// Long enough that a real write, had the refusal leaked, would have landed.
	await page.waitForTimeout(1_500);
	expect((await locationFields(rootId)).parentId).toBeNull();

	await closeMenu(page);
});

test("4: Deleting a place that has children asks first, naming the place; cancelling writes nothing; confirming removes the place and every place under it and nothing else, and the tree is still correct after a reload", async ({
	page,
}) => {
	const doomed = `${PREFIX}doomed shed ${Date.now()}`;
	const under = `${PREFIX}tool wall ${Date.now()}`;
	const survivor = `${PREFIX}surviving shed ${Date.now()}`;

	await gotoAndSettle(page, LOCATIONS);
	await addRoot(page, doomed);
	await addRoot(page, survivor);
	await addUnder(page, doomed, under);

	// Both places are on the server before the ask, so the cancel branch
	// below cannot pass against a half-landed fixture.
	await waitForLocationIdByTitle(doomed);
	await waitForLocationIdByTitle(under);

	await clickMenuItem(page, menuAnchor(page, doomed), "Delete");

	// The ask names the place, in the title and in the body.
	await expect(page.getByText(`Delete ${doomed}?`)).toBeVisible();
	await expect(
		page.getByText(
			`${doomed}, and everything under it, will be deleted. This cannot be undone.`,
		),
	).toBeVisible();

	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(page.getByText(`Delete ${doomed}?`)).not.toBeVisible();
	await expect(row(page, doomed)).toBeVisible();
	await expect(row(page, under)).toBeVisible();

	// Cancelling wrote nothing: both places are still on the server.
	await expect.poll(locationTitles).toContain(doomed);
	await expect.poll(locationTitles).toContain(under);

	await clickMenuItem(page, menuAnchor(page, doomed), "Delete");
	await expect(page.getByText(`Delete ${doomed}?`)).toBeVisible();
	await page.getByRole("button", { name: "Delete", exact: true }).click();

	await expect(page.getByText(doomed)).toHaveCount(0);
	await expect(page.getByText(under)).toHaveCount(0);
	await expect(row(page, survivor)).toBeVisible();

	await page.reload();
	await expect(row(page, survivor)).toBeVisible();
	await expect(page.getByText(doomed)).toHaveCount(0);
	await expect(page.getByText(under)).toHaveCount(0);

	// The subtree went with it, and only the subtree: the survivor keeps its
	// place as a root.
	const titles = await locationTitles();
	expect(titles).not.toContain(doomed);
	expect(titles).not.toContain(under);
	expect(titles).toContain(survivor);
	const survivorId = await waitForLocationIdByTitle(survivor);
	expect((await locationFields(survivorId)).parentId).toBeNull();
});

test("5: A rename shows on the row immediately and survives a reload", async ({
	page,
}) => {
	const original = `${PREFIX}garden ${Date.now()}`;
	const renamed = `${PREFIX}kitchen garden ${Date.now()}`;

	await gotoAndSettle(page, LOCATIONS);
	await addRoot(page, original);
	const id = await waitForLocationIdByTitle(original);

	await clickMenuItem(page, menuAnchor(page, original), "Rename");
	await expect(page.getByRole("textbox")).toHaveValue(original);
	await page.getByRole("textbox").fill(renamed);
	await page.getByRole("button", { name: "Rename", exact: true }).click();

	// Immediately: the row shows the new name from the local cache.
	await expect(page.getByText(renamed)).toBeVisible();

	await page.reload();
	await expect(page.getByText(renamed)).toBeVisible();

	await expect
		.poll(async () => (await locationFields(id)).title, { timeout: 30_000 })
		.toBe(renamed);
});

test("6: With the network cut, Add location still adds the place (queued), Move under… and Delete are disabled with an offline hint, and both work again once the connection returns", async ({
	page,
	context,
}) => {
	const anchor = `${PREFIX}offline house ${Date.now()}`;
	const queued = `${PREFIX}offline shed ${Date.now()}`;

	await gotoAndSettle(page, LOCATIONS);
	await addRoot(page, anchor);
	const anchorId = await waitForLocationIdByTitle(anchor);

	await context.setOffline(true);

	// Add queues: the row is on the screen at once, optimistically.
	await page.getByRole("button", { name: "Add location" }).click();
	await page.getByRole("textbox").fill(queued);
	await page.getByRole("button", { name: "Add", exact: true }).click();
	await expect(row(page, queued)).toBeVisible();

	// Move and delete read the server first, so the menu refuses them before
	// the tap rather than failing after it.
	await openMenu(page, menuAnchor(page, anchor));
	await expect(
		page.getByRole("menuitem", { name: "Move under…" }),
	).toHaveAttribute("aria-disabled", "true");
	await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveAttribute(
		"aria-disabled",
		"true",
	);
	await expect(
		page.getByRole("menuitem", { name: "Needs a connection" }),
	).toBeVisible();
	await closeMenu(page);

	// The connection returns, and the queued add lands.
	await context.setOffline(false);
	await expect
		.poll(locationTitles, {
			timeout: 30_000,
			message: `"${queued}" never reached Firestore — the write was queued and lost`,
		})
		.toContain(queued);
	const queuedId = await waitForLocationIdByTitle(queued);

	// Move works again.
	await clickMenuItem(page, menuAnchor(page, queued), "Move under…");
	await page.getByRole("menuitem", { name: anchor }).click();
	await expect
		.poll(async () => (await locationFields(queuedId)).parentId, {
			timeout: 30_000,
		})
		.toBe(anchorId);

	// And delete works again.
	await clickMenuItem(page, menuAnchor(page, queued), "Delete");
	await page.getByRole("button", { name: "Delete", exact: true }).click();
	await expect(page.getByText(queued)).toHaveCount(0);
	await expect.poll(locationTitles, { timeout: 30_000 }).not.toContain(queued);
	await expect(row(page, anchor)).toBeVisible();
});

test("7: A location move rewrites the paths of anchored nodes: with a node planted at a descendant of the moved place (planted through the emulator's superuser path), the node's locationAncestorIds carries the new path after the move, and a cascade delete leaves that node unfiled with locationId null", async ({
	page,
}) => {
	const root = `${PREFIX}moved place ${Date.now()}`;
	const deep = `${PREFIX}anchored place ${Date.now()}`;
	const target = `${PREFIX}move target ${Date.now()}`;
	const node = `${PREFIX}anchored card ${Date.now()}`;
	const createdBy = await memberUid("Marcus");

	const rootId = await createFixtureLocation({
		title: root,
		parentId: null,
		ancestorIds: [],
		rank: "a",
		createdBy,
	});
	const deepId = await createFixtureLocation({
		title: deep,
		parentId: rootId,
		ancestorIds: [rootId],
		rank: "ab",
		createdBy,
	});
	const targetId = await createFixtureLocation({
		title: target,
		parentId: null,
		ancestorIds: [],
		rank: "b",
		createdBy,
	});

	const nodeId = await createFixtureNode({
		title: node,
		locationId: deepId,
		locationAncestorIds: [rootId, deepId],
	});

	// The tree is not empty, so the screen has no empty state to be ready on:
	// the row is the marker.
	await page.goto("/locations");
	await page.waitForLoadState("networkidle");
	await expect(row(page, root)).toBeVisible({ timeout: 30_000 });

	await clickMenuItem(page, menuAnchor(page, root), "Move under…");
	await page.getByRole("menuitem", { name: target }).click();

	// The trigger rewrote the planted node's path to the new one, tail kept.
	await expect
		.poll(async () => (await nodeFields(nodeId)).locationAncestorIds, {
			timeout: 30_000,
		})
		.toEqual([targetId, rootId, deepId]);
	expect((await nodeFields(nodeId)).locationId).toBe(deepId);

	// The cascade delete unfilms it: filed nowhere.
	await clickMenuItem(page, menuAnchor(page, root), "Delete");
	await page.getByRole("button", { name: "Delete", exact: true }).click();

	await expect
		.poll(async () => (await nodeFields(nodeId)).locationId, {
			timeout: 30_000,
		})
		.toBeNull();
	expect((await nodeFields(nodeId)).locationAncestorIds).toEqual([]);
});

test("8: Over REST: POST creates a location, PATCH renames and re-parents, DELETE without cascade returns 409 has_children and with ?cascade=true deletes the subtree, and a node write carrying locationId still returns 400 locations_unavailable", async ({
	page,
}) => {
	const home = await homeId();
	const root = `${PREFIX}rest root ${Date.now()}`;
	const renamedTitle = `${PREFIX}rest renamed ${Date.now()}`;
	const other = `${PREFIX}rest other ${Date.now()}`;
	const child = `${PREFIX}rest child ${Date.now()}`;
	const filedCard = `${PREFIX}rest filed card ${Date.now()}`;

	await withApiKey(page, async (token) => {
		const headers = {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		};

		const created = await fetch(`${FUNCTIONS_BASE}/homes/${home}/locations`, {
			method: "POST",
			headers,
			body: JSON.stringify({ title: root }),
		});
		expect(created.status, await created.clone().text()).toBe(201);
		const place = (await created.json()) as {
			id: string;
			title: string;
			parentId: string | null;
			ancestorIds: string[];
		};
		expect(place.title).toBe(root);
		expect(place.parentId).toBeNull();
		expect(place.ancestorIds).toEqual([]);

		const otherCreated = await fetch(
			`${FUNCTIONS_BASE}/homes/${home}/locations`,
			{
				method: "POST",
				headers,
				body: JSON.stringify({ title: other }),
			},
		);
		expect(otherCreated.status, await otherCreated.clone().text()).toBe(201);
		const otherBody = (await otherCreated.json()) as { id: string };

		// One PATCH owns rename and move.
		const patched = await fetch(
			`${FUNCTIONS_BASE}/homes/${home}/locations/${place.id}`,
			{
				method: "PATCH",
				headers,
				body: JSON.stringify({ title: renamedTitle, parentId: otherBody.id }),
			},
		);
		expect(patched.status, await patched.clone().text()).toBe(200);
		const patchedBody = (await patched.json()) as {
			title: string;
			parentId: string | null;
			ancestorIds: string[];
		};
		expect(patchedBody.title).toBe(renamedTitle);
		expect(patchedBody.parentId).toBe(otherBody.id);
		expect(patchedBody.ancestorIds).toEqual([otherBody.id]);

		const childCreated = await fetch(
			`${FUNCTIONS_BASE}/homes/${home}/locations`,
			{
				method: "POST",
				headers,
				body: JSON.stringify({ title: child, parentId: place.id }),
			},
		);
		expect(childCreated.status, await childCreated.clone().text()).toBe(201);
		const childBody = (await childCreated.json()) as {
			id: string;
			ancestorIds: string[];
		};
		expect(childBody.ancestorIds).toEqual([otherBody.id, place.id]);

		// The API's confirmation dialog: a subtree is not deleted by accident.
		const refused = await fetch(
			`${FUNCTIONS_BASE}/homes/${home}/locations/${place.id}`,
			{ method: "DELETE", headers },
		);
		expect(refused.status, await refused.clone().text()).toBe(409);
		const refusedBody = (await refused.json()) as {
			error: { code: string };
		};
		expect(refusedBody.error.code).toBe("has_children");

		const cascaded = await fetch(
			`${FUNCTIONS_BASE}/homes/${home}/locations/${place.id}?cascade=true`,
			{ method: "DELETE", headers },
		);
		expect(cascaded.status, await cascaded.clone().text()).toBe(200);
		const cascadedBody = (await cascaded.json()) as { deleted: number };
		expect(cascadedBody.deleted).toBe(2);

		// The subtree is gone, the re-parent target is not.
		const titles = await locationTitles();
		expect(titles).not.toContain(renamedTitle);
		expect(titles).not.toContain(child);
		expect(titles).toContain(other);

		// Filing work in a place is still refused until #51 gives it semantics.
		const filed = await fetch(`${FUNCTIONS_BASE}/homes/${home}/nodes`, {
			method: "POST",
			headers,
			body: JSON.stringify({ title: filedCard, locationId: otherBody.id }),
		});
		expect(filed.status).toBe(400);
		const filedBody = (await filed.json()) as { error: { code: string } };
		expect(filedBody.error.code).toBe("locations_unavailable");
	});
});
