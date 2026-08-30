/**
 * The Firestore emulator's REST API, used to check and clean up what the app
 * wrote.
 *
 * Two jobs. First, proving a write actually **landed**: Firestore's offline
 * cache shows a pending write optimistically, so a card visible on screen — even
 * after a reload — is not evidence that anything reached the server. Only the
 * backend can settle that, and this is how the suite asks it.
 *
 * Second, cleaning up. A spec that creates a card and leaves it there makes the
 * local fixture drift a little further from `.emulator-seed` on every run, until
 * one day a screenshot is full of "E2E offline 1738…" and nobody knows why. Each
 * spec deletes what it made, and `fixture.setup.ts` sweeps the board before the
 * suite starts, for the run that was killed before its `finally` could.
 *
 * The emulator accepts `Authorization: Bearer owner` as a superuser, so these
 * calls bypass `firestore.rules` entirely. That is correct here — the rules have
 * their own suite in `tests/rules/`, and this is fixture plumbing, not a
 * security check.
 */

import { stackPorts } from "@/e2e/support/stack";

const PROJECT = "home-backlog";
const EMULATOR_PORT = stackPorts().firestore;
const BASE = `http://localhost:${EMULATOR_PORT}/v1/projects/${PROJECT}/databases/(default)/documents`;
const HEADERS = { Authorization: "Bearer owner" };

/** The seeded home the suite works inside; matches `auth.setup.ts`. */
const HOME_NAME = "Huset";

type Document = {
	name: string;
	fields?: Record<string, { stringValue?: string }>;
};

async function get(path: string): Promise<{ documents?: Document[] }> {
	const response = await fetch(`${BASE}${path}`, { headers: HEADERS });
	if (!response.ok) {
		throw new Error(
			`emulator REST ${path} responded ${response.status} ${response.statusText}`,
		);
	}
	return response.json() as Promise<{ documents?: Document[] }>;
}

let cachedHomeId: string | undefined;

/** The document id of the seeded home, resolved by name and then remembered. */
export async function homeId(): Promise<string> {
	if (cachedHomeId) return cachedHomeId;

	const { documents = [] } = await get("/homes");
	const home = documents.find(
		(document) => document.fields?.name?.stringValue === HOME_NAME,
	);
	if (!home) {
		throw new Error(
			`no home named ${HOME_NAME} in the emulator — is it running with --import .emulator-seed?`,
		);
	}

	cachedHomeId = home.name.split("/").pop();
	if (!cachedHomeId) throw new Error(`could not read an id from ${home.name}`);
	return cachedHomeId;
}

/** Every node title in the seeded home, straight from the backend. */
export async function nodeTitles(): Promise<string[]> {
	const { documents = [] } = await get(
		`/homes/${await homeId()}/nodes?pageSize=300`,
	);
	return documents
		.map((document) => document.fields?.title?.stringValue)
		.filter((title): title is string => typeof title === "string");
}

/**
 * Deletes every node whose title begins with this prefix. Best-effort in that
 * finding nothing is a normal outcome — a spec that failed before it created
 * anything still calls this — but a delete that is refused is not.
 */
export async function deleteNodesByTitlePrefix(prefix: string): Promise<void> {
	const { documents = [] } = await get(
		`/homes/${await homeId()}/nodes?pageSize=300`,
	);

	for (const document of documents) {
		const title = document.fields?.title?.stringValue;
		if (title === undefined || !title.startsWith(prefix)) continue;
		const response = await fetch(
			`http://localhost:${EMULATOR_PORT}/v1/${document.name}`,
			{
				method: "DELETE",
				headers: HEADERS,
			},
		);
		// A delete that quietly fails is the worst outcome available here: the
		// card stays on the board and the run that pays for it is a later spec in
		// a different project, failing on a card count with nothing in its output
		// to say where the extra card came from. Fail where the leak is instead.
		if (!response.ok) {
			throw new Error(
				`emulator REST could not delete "${title}": ${response.status} ${response.statusText}`,
			);
		}
	}
}

/**
 * Fills a root column with `count` throwaway cards, and answers with their
 * titles in the order they will appear.
 *
 * A claim about *a column full enough to scroll* cannot be made against the
 * fixture: the seeded home is a real household's board, six root cards across
 * four columns, and none of its columns overflows a phone. Padding the fixture
 * itself would push that noise into every other spec's screenshots and into
 * `browser-review`, so the cards are made for the one test that needs them and
 * deleted after it.
 *
 * Each card is a **copy of a stored node**, with only the title, rank, status
 * and parentage changed. Hand-writing the document is how a fixture drifts from
 * the schema: a field the app reads but this file never heard of would arrive as
 * `undefined` and the board would render a card with no title rather than fail.
 * The ranks sort after every seeded one, so the batch lands at the bottom of the
 * column where a scroll has to reach it.
 */
export async function fillColumn(
	status: string,
	count: number,
	titlePrefix: string,
): Promise<string[]> {
	const home = await homeId();
	const { documents = [] } = await get(`/homes/${home}/nodes?pageSize=1`);
	const template = documents[0];
	if (template === undefined) {
		throw new Error(
			`no node in ${HOME_NAME} to copy — is the emulator running with --import .emulator-seed?`,
		);
	}

	const titles: string[] = [];
	for (let index = 0; index < count; index++) {
		const title = `${titlePrefix} ${index + 1}`;
		const fields = {
			...(template.fields as Record<string, unknown>),
			title: { stringValue: title },
			// Lowercase, so it sorts after every fractional-index rank in the
			// fixture — those start at a capital letter.
			rank: { stringValue: `zz${String(index).padStart(3, "0")}` },
			status: { stringValue: status },
			parentId: { nullValue: null },
			ancestorIds: { arrayValue: {} },
			childCount: { integerValue: "0" },
			doneCount: { integerValue: "0" },
			completedAt: { nullValue: null },
			visibility: { stringValue: "shared" },
		};

		const response = await fetch(`${BASE}/homes/${home}/nodes`, {
			method: "POST",
			headers: { ...HEADERS, "Content-Type": "application/json" },
			body: JSON.stringify({ fields }),
		});
		if (!response.ok) {
			throw new Error(
				`emulator REST could not create ${title}: ${response.status} ${response.statusText}`,
			);
		}
		titles.push(title);
	}

	return titles;
}

/**
 * Firestore's REST document values, and the plain JSON a fixture actually
 * wants to write or read — see #102's e2e phase.
 *
 * The REST API wraps every value in a type tag (`{ stringValue: "x" }`), which
 * is exactly right for a wire format and exactly wrong for a fixture to write
 * or a test to assert against. These two functions are the one place that
 * boundary is crossed, so every other helper in this file — and every spec —
 * reads and writes plain values.
 */
type Json =
	| string
	| number
	| boolean
	| null
	| Date
	| readonly Json[]
	| { readonly [key: string]: Json };

function encodeValue(value: Json): Record<string, unknown> {
	if (value === null) return { nullValue: null };
	// A `Date` is the one field `createFixtureNode` cannot write as a calendar
	// string: `completedAt` is a `Timestamp`, and `moveNode` only ever writes it
	// as *now* — Overview's 40-day-old and yesterday fixtures (#54 claim 6) have
	// no other way to exist.
	if (value instanceof Date) return { timestampValue: value.toISOString() };
	if (typeof value === "boolean") return { booleanValue: value };
	if (typeof value === "string") return { stringValue: value };
	if (typeof value === "number") {
		return Number.isInteger(value)
			? { integerValue: String(value) }
			: { doubleValue: value };
	}
	if (Array.isArray(value)) {
		return { arrayValue: { values: value.map(encodeValue) } };
	}
	return { mapValue: { fields: encodeFields(value as Record<string, Json>) } };
}

function encodeFields(fields: Record<string, Json>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(fields).map(([key, value]) => [key, encodeValue(value)]),
	);
}

function decodeValue(value: unknown): unknown {
	if (value === null || typeof value !== "object") return undefined;
	const tagged = value as Record<string, unknown>;
	if ("nullValue" in tagged) return null;
	if ("booleanValue" in tagged) return tagged.booleanValue;
	if ("stringValue" in tagged) return tagged.stringValue;
	if ("integerValue" in tagged) return Number(tagged.integerValue);
	if ("doubleValue" in tagged) return tagged.doubleValue;
	if ("timestampValue" in tagged) return tagged.timestampValue;
	if ("arrayValue" in tagged) {
		const values =
			(tagged.arrayValue as { values?: unknown[] } | undefined)?.values ?? [];
		return values.map(decodeValue);
	}
	if ("mapValue" in tagged) {
		const inner =
			(tagged.mapValue as { fields?: Record<string, unknown> } | undefined)
				?.fields ?? {};
		return decodeFields(inner);
	}
	return undefined;
}

function decodeFields(
	fields: Record<string, unknown>,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]),
	);
}

/** The id at the end of a REST resource name, e.g. `homes/{home}/nodes/{id}`. */
function idOf(name: string): string {
	const id = name.split("/").pop();
	if (!id) throw new Error(`could not read an id from ${name}`);
	return id;
}

/** One node's fields, decoded to plain JSON — for asserting what a write did. */
export async function nodeFields(
	nodeId: string,
): Promise<Record<string, unknown>> {
	const home = await homeId();
	const response = await fetch(`${BASE}/homes/${home}/nodes/${nodeId}`, {
		headers: HEADERS,
	});
	if (!response.ok) {
		throw new Error(
			`emulator REST could not read node ${nodeId}: ${response.status} ${response.statusText}`,
		);
	}
	const document = (await response.json()) as {
		fields?: Record<string, unknown>;
	};
	return decodeFields(document.fields ?? {});
}

/**
 * Recomputes a node's `childCount` / `doneCount` from its real children and
 * writes them back.
 *
 * Only claim 12 needs this: demoting a node under a real, seeded project (the
 * claim is about a *real* project, not a throwaway one) and then sweeping the
 * demoted node away by title prefix — a raw Firestore delete, the same one
 * `deleteNodesByTitlePrefix` always does — does not run the app's own
 * counter bookkeeping, so the seeded project would otherwise end this file's
 * run one `childCount` too high, forever, for every spec that reads it.
 */
export async function recountChildren(nodeId: string): Promise<void> {
	const home = await homeId();
	const { documents = [] } = await get(`/homes/${home}/nodes?pageSize=300`);

	let childCount = 0;
	let doneCount = 0;
	for (const document of documents) {
		if (document.fields?.parentId?.stringValue !== nodeId) continue;
		childCount += 1;
		if (document.fields?.status?.stringValue === "done") doneCount += 1;
	}

	const response = await fetch(
		`${BASE}/homes/${home}/nodes/${nodeId}?updateMask.fieldPaths=childCount&updateMask.fieldPaths=doneCount`,
		{
			method: "PATCH",
			headers: { ...HEADERS, "Content-Type": "application/json" },
			body: JSON.stringify({
				fields: {
					childCount: { integerValue: String(childCount) },
					doneCount: { integerValue: String(doneCount) },
				},
			}),
		},
	);
	if (!response.ok) {
		throw new Error(
			`emulator REST could not recount ${nodeId}: ${response.status} ${response.statusText}`,
		);
	}
}

/** A node's id, resolved by its title — for a node created through the UI. */
export async function nodeIdByTitle(title: string): Promise<string> {
	const home = await homeId();
	const { documents = [] } = await get(`/homes/${home}/nodes?pageSize=300`);
	const match = documents.find(
		(document) => document.fields?.title?.stringValue === title,
	);
	if (!match) {
		throw new Error(`no node titled "${title}" in ${HOME_NAME}`);
	}
	return idOf(match.name);
}

/**
 * A node's id, resolved by its title once the write reaches the backend.
 *
 * A card made through the UI is visible on screen — optimistically — the
 * instant Firestore applies it locally, which can be well before the emulator
 * this file reads through can see it. `nodeIdByTitle` throwing on "not found
 * yet" makes it a poor fit inside `expect.poll`, whose callback Playwright
 * treats a throw from as an immediate failure rather than something to retry
 * — so this is the version that waits instead.
 */
export async function waitForNodeIdByTitle(
	title: string,
	timeoutMs = 30_000,
): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			return await nodeIdByTitle(title);
		} catch (reason) {
			if (Date.now() > deadline) throw reason;
			await new Promise((resolve) => setTimeout(resolve, 300));
		}
	}
}

/**
 * One node, built from a copy of a stored one with the given fields
 * overridden.
 *
 * The same reasoning `fillColumn` above writes down: hand-writing a whole
 * document is how a fixture drifts from the schema a field the app never
 * heard of arrives as `undefined` rather than failing. Unlike `fillColumn`
 * this can place a node anywhere in the tree — a root, or a step under one —
 * which is what the participants claims need: a project with a stored
 * participant list, or a step whose stale assignee is not on it.
 */
export async function createFixtureNode(
	overrides: Record<string, Json>,
): Promise<string> {
	const home = await homeId();
	const { documents = [] } = await get(`/homes/${home}/nodes?pageSize=1`);
	const template = documents[0];
	if (template === undefined) {
		throw new Error(
			`no node in ${HOME_NAME} to copy — is the emulator running with --import .emulator-seed?`,
		);
	}

	const fields = {
		...(template.fields as Record<string, unknown>),
		...encodeFields(overrides),
	};

	const response = await fetch(`${BASE}/homes/${home}/nodes`, {
		method: "POST",
		headers: { ...HEADERS, "Content-Type": "application/json" },
		body: JSON.stringify({ fields }),
	});
	if (!response.ok) {
		throw new Error(
			`emulator REST could not create a fixture node: ${response.status} ${response.statusText}`,
		);
	}
	const created = (await response.json()) as { name: string };
	return idOf(created.name);
}

/** Every current member's uid, from the seeded home's `members` map. */
export async function homeMemberUids(): Promise<string[]> {
	const home = await homeId();
	const response = await fetch(`${BASE}/homes/${home}`, { headers: HEADERS });
	if (!response.ok) {
		throw new Error(
			`emulator REST could not read home ${home}: ${response.status} ${response.statusText}`,
		);
	}
	const document = (await response.json()) as {
		fields?: Record<string, unknown>;
	};
	const members = decodeFields(document.fields ?? {}).members;
	return Object.keys((members ?? {}) as Record<string, unknown>);
}

/**
 * A member's uid, by the display name their seeded Google account carries —
 * `Marcus` or `Anna Maria Berg`. Resolved rather than hardcoded, the same
 * reason `homeId()` resolves by name: a reseed changes ids, never the names
 * this file was written against.
 */
export async function memberUid(displayName: string): Promise<string> {
	const home = await homeId();
	const response = await fetch(`${BASE}/homes/${home}`, { headers: HEADERS });
	if (!response.ok) {
		throw new Error(
			`emulator REST could not read home ${home}: ${response.status} ${response.statusText}`,
		);
	}
	const document = (await response.json()) as {
		fields?: Record<string, unknown>;
	};
	const profiles = decodeFields(document.fields ?? {}).memberProfiles as
		| Record<string, { displayName?: string }>
		| undefined;
	const match = Object.entries(profiles ?? {}).find(
		([, profile]) => profile.displayName === displayName,
	);
	if (!match) {
		throw new Error(`no member named "${displayName}" in ${HOME_NAME}`);
	}
	return match[0];
}
