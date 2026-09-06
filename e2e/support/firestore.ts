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

import { generateNKeysBetween } from "fractional-indexing";
import { stackPorts } from "@/e2e/support/stack";

/**
 * The rank alphabet `models/node.ts` ranks with, spelled out here because
 * this file stands outside the app build.
 */
const RANK_DIGITS =
	"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * `count` **valid** fractional ranks sorting after every card the fixture
 * seeds.
 *
 * Valid, not merely late-sorting: the app ranks its own creates with
 * `rankAtEnd(last?.rank)` over whatever it can see, and a card whose rank
 * `generateKeyBetween` refuses makes every later FAB create crash — the
 * first draft of this used `zz…` strings, and the run that leaked one left
 * the board unable to create a card until the leak was swept by hand.
 */
function lateRanks(count: number): string[] {
	return generateNKeysBetween("Vz", null, count, RANK_DIGITS);
}

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

/** A home's document id, resolved by name — including the throwaway ones. */
async function homeIdByName(name: string): Promise<string> {
	const { documents = [] } = await get("/homes");
	const home = documents.find(
		(document) => document.fields?.name?.stringValue === name,
	);
	if (!home) {
		throw new Error(
			`no home named ${name} in the emulator — is it running with --import .emulator-seed?`,
		);
	}

	const id = home.name.split("/").pop();
	if (!id) throw new Error(`could not read an id from ${home.name}`);
	return id;
}

/** The document id of the seeded home, resolved by name and then remembered. */
async function homeId(): Promise<string> {
	if (cachedHomeId) return cachedHomeId;

	cachedHomeId = await homeIdByName(HOME_NAME);
	return cachedHomeId;
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
		// to say where the extra card came from. Fail where the leak is instead,
		// with the body — the emulator's status line alone (a bare 409) says
		// nothing about why it refused.
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new Error(
				`emulator REST could not delete "${title}": ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`,
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
	const ranks = lateRanks(count);
	for (let index = 0; index < count; index++) {
		const title = `${titlePrefix} ${index + 1}`;
		const fields = {
			...(template.fields as Record<string, unknown>),
			title: { stringValue: title },
			rank: { stringValue: ranks[index] },
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
	toHome?: string,
): Promise<string> {
	const home = toHome ?? (await homeId());
	let { documents = [] } = await get(`/homes/${home}/nodes?pageSize=1`);
	if (documents[0] === undefined) {
		// A throwaway home has no node to copy — borrow the seeded home's
		// template instead; the overrides decide every field that matters.
		documents =
			(await get(`/homes/${await homeId()}/nodes?pageSize=1`)).documents ?? [];
	}
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

/**
 * The home's label definitions, decoded to plain JSON (#100): the map the
 * home document holds, keyed by the id a card's `labelIds` names.
 */
async function homeLabels(): Promise<Record<string, Record<string, unknown>>> {
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
	const labels = decodeFields(document.fields ?? {}).labels;
	return (labels ?? {}) as Record<string, Record<string, unknown>>;
}

/** One label definition, joined back with its id — resolved by its title. */
export async function labelByTitle(
	title: string,
): Promise<{ id: string } & Record<string, unknown>> {
	const labels = await homeLabels();
	const match = Object.entries(labels).find(
		([, label]) => label.title === title,
	);
	if (!match) throw new Error(`no label titled "${title}" in ${HOME_NAME}`);
	return { id: match[0], ...match[1] };
}

/**
 * Deletes every label definition whose title begins with this prefix, by
 * rewriting the home's `labels` map without them.
 *
 * The same plumbing `deleteNodesByTitlePrefix` is, one level up: a definition
 * left behind outlives every card that referenced it, so a run killed before
 * its cleanup would leave two strays on the home for every later run to see.
 * Finding nothing is a normal outcome.
 */
export async function deleteLabelsByTitlePrefix(prefix: string): Promise<void> {
	const labels = await homeLabels();
	const kept = Object.fromEntries(
		Object.entries(labels).filter(([, label]) => {
			const title = typeof label.title === "string" ? label.title : "";
			return !title.startsWith(prefix);
		}),
	);
	if (Object.keys(kept).length === Object.keys(labels).length) return;

	const home = await homeId();
	const response = await fetch(`${BASE}/homes/${home}?updateMask=labels`, {
		method: "PATCH",
		headers: { ...HEADERS, "Content-Type": "application/json" },
		body: JSON.stringify({
			fields: {
				labels:
					Object.keys(kept).length === 0
						? { mapValue: {} }
						: encodeValue(kept as Record<string, Json>),
			},
		}),
	});
	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(
			`emulator REST could not rewrite the home's labels: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`,
		);
	}
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
