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
	const { documents = [] } = await get(
		`/homes/${await homeId()}/nodes?pageSize=300`,
	);

	for (const document of documents) {
		if (document.fields?.title?.stringValue !== title) continue;
		await fetch(`http://localhost:8062/v1/${document.name}`, {
			method: "DELETE",
			headers: HEADERS,
		});
	}
}
