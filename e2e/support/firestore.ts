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
 * one day a screenshot is full of "E2E offline 1738…" and nobody knows why.
 *
 * The emulator accepts `Authorization: Bearer owner` as a superuser, so these
 * calls bypass `firestore.rules` entirely. That is correct here — the rules have
 * their own suite in `tests/rules/`, and this is fixture plumbing, not a
 * security check.
 */

const PROJECT = "home-backlog";
const BASE = `http://localhost:8062/v1/projects/${PROJECT}/databases/(default)/documents`;
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
 * Deletes every node with this title. Best-effort: a spec that failed before it
 * created anything still calls this, and finding nothing is a normal outcome.
 */
export async function deleteNodesByTitle(title: string): Promise<void> {
	await deleteNodesWhere((stored) => stored === title);
}

/** The same, for a run that created a numbered batch under one prefix. */
export async function deleteNodesByTitlePrefix(prefix: string): Promise<void> {
	await deleteNodesWhere((stored) => stored.startsWith(prefix));
}

async function deleteNodesWhere(
	matches: (title: string) => boolean,
): Promise<void> {
	const { documents = [] } = await get(
		`/homes/${await homeId()}/nodes?pageSize=300`,
	);

	for (const document of documents) {
		const title = document.fields?.title?.stringValue;
		if (title === undefined || !matches(title)) continue;
		await fetch(`http://localhost:8062/v1/${document.name}`, {
			method: "DELETE",
			headers: HEADERS,
		});
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
