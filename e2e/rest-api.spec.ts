import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
	createFixtureNode,
	deleteNodesByTitlePrefix,
	homeId,
	homeMemberUids,
	memberUid,
} from "@/e2e/support/firestore";

/**
 * The two `#102` acceptance claims about the REST API — 13 and 18 — which
 * `docs/specs/rest-api.md` describes but nothing in `e2e/` had ever driven
 * before this file: the suite's REST coverage was unit tests against the
 * Express app in `functions/src/*.test.ts`, never a real HTTP round trip
 * through the emulator with a real bearer token.
 *
 * Minting that token means driving the Automations screen — the only writer
 * of an API key, by design (`data/api-keys.ts`). That is not a new fixture
 * layer: it is the one the feature already ships, used the way an agent's
 * owner would use it, and revoked the same way at the end of each test.
 *
 * The calls themselves go straight at the Functions emulator, bypassing
 * Hosting's `/api/**` rewrite the way `app.ts`'s own doc comment says a direct
 * call to the function arrives — `/v1/...`, not `/api/v1/...`. There is no
 * Hosting emulator in this stack (`firebase.json`'s `emulators` block has
 * none), so this is the only door available to a real request.
 */

const FUNCTIONS_BASE = "http://127.0.0.1:8064/home-backlog/europe-west1/api/v1";
const PREFIX = "E2E rest ";
const KEY_NAME = "E2E rest api key";

test.afterEach(async () => {
	await deleteNodesByTitlePrefix(PREFIX);
});

/**
 * Mints a real API key through the Automations screen, runs `use` with it,
 * then revokes it. The mint lives inside the `try`, so a key minted but never
 * surfaced (the secret dialog failing to render, say) is still revoked in the
 * `finally`. What a crashed run can still leave behind is a key — `afterEach`
 * sweeps only the cards — which is why every mint also gets a unique name: a
 * leaked key can never collide with a later mint's revoke locator.
 */
async function withApiKey<T>(
	page: Page,
	use: (token: string) => Promise<T>,
): Promise<T> {
	await page.goto("/automations");
	await page.waitForLoadState("networkidle");

	// Two keys can never share a name, so every mint gets a unique one;
	// `Date.now()` also keeps parallel workers and CI retries apart.
	const keyName = `${KEY_NAME} ${Date.now()}`;
	let minted = false;

	try {
		await page.getByRole("button", { name: "New API key" }).click();
		await page.getByRole("textbox").fill(keyName);
		await page.getByRole("button", { name: "Create", exact: true }).click();
		minted = true;

		// The secret `Text` carries the token as its own accessible name's target,
		// not a form control `getByLabel` would find — see `automations.tsx`.
		const secret = page.locator('[aria-label="Copy the key now"]');
		await expect(secret).toBeVisible();
		const token = (await secret.textContent())?.trim();
		if (!token) throw new Error("no token rendered in the secret dialog");
		await page.getByRole("button", { name: "Done" }).click();

		return await use(token);
	} finally {
		// Only a mint that got as far as `Create` can have produced a key; before
		// that there is nothing to revoke and revoking would hang on a locator.
		if (minted) {
			await page.getByRole("button", { name: `Revoke ${keyName}` }).click();
			await page.getByRole("button", { name: "Revoke", exact: true }).click();
		}
	}
}

test("13: PATCH /nodes/:id with parentId null promotes with the old root's participants", async ({
	page,
}) => {
	const marcus = await memberUid("Marcus");
	const anna = await memberUid("Anna Maria Berg");
	const rootId = await createFixtureNode({
		title: `${PREFIX}promote13 root`,
		parentId: null,
		ancestorIds: [],
		visibility: "shared",
		participantIds: [marcus, anna],
	});
	const stepId = await createFixtureNode({
		title: `${PREFIX}promote13 step`,
		parentId: rootId,
		ancestorIds: [rootId],
		visibility: "shared",
		participantIds: [],
	});

	const home = await homeId();
	await withApiKey(page, async (token) => {
		const response = await fetch(
			`${FUNCTIONS_BASE}/homes/${home}/nodes/${stepId}`,
			{
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ parentId: null }),
			},
		);

		expect(response.status, await response.clone().text()).toBe(200);
		const body = (await response.json()) as {
			parentId: string | null;
			participantIds: string[];
		};
		expect(body.parentId).toBeNull();
		expect([...body.participantIds].sort()).toEqual([marcus, anna].sort());
	});
});

test("18: POST /nodes without participantIds carries every member, participantIds: [me] narrows it, and PATCH still refuses the field", async ({
	page,
}) => {
	const marcus = await memberUid("Marcus");
	const members = await homeMemberUids();
	const home = await homeId();

	await withApiKey(page, async (token) => {
		const headers = {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		};

		const everyone = await fetch(`${FUNCTIONS_BASE}/homes/${home}/nodes`, {
			method: "POST",
			headers,
			body: JSON.stringify({ title: `${PREFIX}post everyone` }),
		});
		expect(everyone.status, await everyone.clone().text()).toBe(201);
		const everyoneBody = (await everyone.json()) as {
			participantIds: string[];
		};
		expect([...everyoneBody.participantIds].sort()).toEqual(
			[...members].sort(),
		);

		const narrowed = await fetch(`${FUNCTIONS_BASE}/homes/${home}/nodes`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				title: `${PREFIX}post narrowed`,
				participantIds: [marcus],
			}),
		});
		expect(narrowed.status, await narrowed.clone().text()).toBe(201);
		const narrowedBody = (await narrowed.json()) as {
			id: string;
			participantIds: string[];
		};
		expect(narrowedBody.participantIds).toEqual([marcus]);

		const patched = await fetch(
			`${FUNCTIONS_BASE}/homes/${home}/nodes/${narrowedBody.id}`,
			{
				method: "PATCH",
				headers,
				body: JSON.stringify({ participantIds: [marcus] }),
			},
		);
		expect(patched.status).toBe(400);
		const patchedBody = (await patched.json()) as {
			error: { code: string };
		};
		expect(patchedBody.error.code).toBe("participants_immutable");
	});
});

test("22: POST /nodes:bulk gives its new root every member, and refuses participants below it", async ({
	page,
}) => {
	const members = await homeMemberUids();
	const home = await homeId();

	await withApiKey(page, async (token) => {
		const headers = {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		};

		const created = await fetch(`${FUNCTIONS_BASE}/homes/${home}/nodes:bulk`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				nodes: [
					{ ref: "root", title: `${PREFIX}bulk root` },
					{ ref: "step", parentRef: "root", title: `${PREFIX}bulk step` },
				],
			}),
		});
		expect(created.status, await created.clone().text()).toBe(201);
		const createdBody = (await created.json()) as {
			rootId: string;
			ids: Record<string, string>;
		};

		const participantsOf = async (id: string): Promise<string[]> => {
			const got = await fetch(`${FUNCTIONS_BASE}/homes/${home}/nodes/${id}`, {
				headers,
			});
			expect(got.status, await got.clone().text()).toBe(200);
			return ((await got.json()) as { participantIds: string[] })
				.participantIds;
		};

		// `[]` on a root is refused by the rules, so a bulk-written one holding it
		// would be frozen against every later update.
		expect([...(await participantsOf(createdBody.rootId))].sort()).toEqual(
			[...members].sort(),
		);
		expect(await participantsOf(createdBody.ids.step)).toEqual([]);

		const below = await fetch(`${FUNCTIONS_BASE}/homes/${home}/nodes:bulk`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				nodes: [
					{ ref: "root", title: `${PREFIX}bulk refused` },
					{
						ref: "step",
						parentRef: "root",
						title: `${PREFIX}bulk refused step`,
						participantIds: members,
					},
				],
			}),
		});
		expect(below.status).toBe(400);
		const belowBody = (await below.json()) as { error: { code: string } };
		expect(belowBody.error.code).toBe("participants_immutable");
	});
});

test("32: two sequential mints never share a name, and both are revoked with no key left behind", async ({
	page,
}) => {
	const names: string[] = [];

	// A key's row exists only while the key does, so the single revoke button
	// carrying the `KEY_NAME` prefix mid-mint is this mint's — its accessible
	// name records the name the helper actually gave the key.
	const mintedName = async (): Promise<string> => {
		const revoke = page.getByRole("button", {
			name: new RegExp(`^Revoke ${KEY_NAME} `),
		});
		await expect(revoke).toHaveCount(1);
		const label = await revoke.getAttribute("aria-label");
		if (!label) throw new Error("no aria-label on the revoke button");
		return label;
	};

	await withApiKey(page, async () => {
		names.push(await mintedName());
	});
	await withApiKey(page, async () => {
		// The first key is already gone here: were it not, this count would be
		// 2 and the helper's own exact-name revoke would refuse to click.
		names.push(await mintedName());
	});

	expect(names[1]).not.toBe(names[0]);
	await expect(
		page.getByRole("button", { name: `Revoke ${names[0]}` }),
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: `Revoke ${names[1]}` }),
	).toHaveCount(0);
});
