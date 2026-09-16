import { jest } from "@jest/globals";
import type { Request, Response, Router } from "express";
import type { ApiCaller } from "./auth.js";
import { etagForCard } from "./card.js";
import { ApiError } from "./errors.js";

/**
 * The card verbs' contract, faked at the module boundary (`firestore.js`,
 * `auth.js`, `handler.js`) rather than with an emulator — the same split the
 * node suite draws, because what these handlers decide — owner-scoped paths,
 * replace-not-merge removals, the atomic scope move — is policy, not I/O.
 *
 * The transaction fake collects the `set`/`update`/`delete` calls and applies
 * them only when the handler's function returns, so a test that inspects the
 * store sees exactly what one atomic commit left behind.
 */

const HOME = "home-1";
const ME: ApiCaller = {
	uid: "uidMarcus",
	keyId: "key-1",
	keyName: "CLI",
	keyRef: {} as ApiCaller["keyRef"],
};

const store = new Map<string, Record<string, unknown>>();
let autoIds = 0;

const GLOBAL_PATH = `users/${ME.uid}/dashboard/config`;
const HOME_DASH_PATH = `homes/${HOME}/dashboards/${ME.uid}`;
const SHARED_PREFIX = `homes/${HOME}/dashboardCards`;

function document(path: string, fields: Record<string, unknown>): void {
	store.set(path, fields);
}

function snapshotFor(path: string) {
	const fields = store.get(path);
	return {
		id: path.split("/").pop() ?? "",
		exists: fields !== undefined,
		data: () => fields,
		get: (field: string) => fields?.[field],
	};
}

function docAt(path: string) {
	return {
		id: path.split("/").pop(),
		path,
		get: async () => snapshotFor(path),
		collection: (sub: string) => collectionAt(`${path}/${sub}`),
		delete: async () => {
			store.delete(path);
		},
	};
}
function collectionAt(path: string) {
	return {
		path,
		doc: (id?: string) => {
			const minted = id ?? `auto-${autoIds + 1}`;
			autoIds += 1;
			return docAt(`${path}/${minted}`);
		},
		get: async () => ({
			docs: [...store]
				.filter(([key]) => key.startsWith(`${path}/`))
				.map(([key, fields]) => ({
					id: key.split("/").pop(),
					path: key,
					ref: docAt(key),
					data: () => fields,
					get: (field: string) => fields?.[field],
				})),
		}),
	};
}

function apply(op: {
	kind: string;
	ref: { path: string };
	data?: Record<string, unknown>;
	opts?: { mergeFields?: string[] };
}): void {
	const path = op.ref.path;
	if (op.kind === "delete") {
		store.delete(path);
		return;
	}
	if (op.kind === "update") {
		store.set(path, { ...store.get(path), ...op.data });
		return;
	}
	const mergeFields = op.opts?.mergeFields;
	if (mergeFields === undefined) {
		store.set(path, { ...op.data });
		return;
	}
	const current = store.get(path) ?? {};
	const next = { ...current };
	for (const field of mergeFields) next[field] = op.data?.[field];
	store.set(path, next);
}

jest.unstable_mockModule("./firestore.js", () => ({
	homesCollection: "homes",
	nodesCollection: "nodes",
	locationsCollection: "locations",
	usersCollection: "users",
	dashboardCollection: "dashboard",
	dashboardConfigDoc: "config",
	dashboardsCollection: "dashboards",
	dashboardCardsCollection: "dashboardCards",
	maxBatchWrites: 500,
	db: {
		collection: (name: string) => collectionAt(name),
		doc: (name: string) => docAt(name),
		runTransaction: async (
			fn: (tx: unknown) => Promise<unknown>,
		): Promise<unknown> => {
			const ops: Array<{
				kind: string;
				ref: { path: string };
				data?: Record<string, unknown>;
				opts?: { mergeFields?: string[] };
			}> = [];
			const tx = {
				get: async (ref: { path: string; doc?: unknown }): Promise<unknown> => {
					if (typeof ref.doc === "function") {
						return collectionAt(ref.path).get();
					}
					return snapshotFor(ref.path);
				},
				set: (
					ref: { path: string },
					data: Record<string, unknown>,
					opts?: { mergeFields?: string[] },
				) => ops.push({ kind: "set", ref, data, opts }),
				update: (ref: { path: string }, data: Record<string, unknown>) =>
					ops.push({ kind: "update", ref, data }),
				delete: (ref: { path: string }) => ops.push({ kind: "delete", ref }),
			};
			const result = await fn(tx);
			for (const op of ops) apply(op);
			return result;
		},
	},
}));

jest.unstable_mockModule("./auth.js", () => ({
	caller: (response: { locals: { caller?: unknown } }) => {
		const verified = response.locals.caller;
		if (!verified) throw new Error("no verified caller in response.locals");
		return verified;
	},
	homeAccess: jest.fn(),
	recordWrite: jest.fn(),
}));

jest.unstable_mockModule("./handler.js", () => ({
	handle: (route: (request: Request, response: Response) => Promise<void>) =>
		route,
	param: (req: Request, name: string): string => {
		const value = (req.params as Record<string, string>)[name];
		if (typeof value !== "string" || value.length === 0) {
			throw new ApiError(400, "invalid_path", `Missing ${name} in the path.`);
		}
		return value;
	},
}));

const { registerCardRoutes } = await import("./cards.js");
const { homeAccess, recordWrite } = await import("./auth.js");

type Route = (request: Request, response: Response) => Promise<void>;

const routes = new Map<string, Route>();

beforeAll(() => {
	registerCardRoutes({
		get: (path: string, handler: Route) => routes.set(`GET ${path}`, handler),
		post: (path: string, handler: Route) => routes.set(`POST ${path}`, handler),
		patch: (path: string, handler: Route) =>
			routes.set(`PATCH ${path}`, handler),
		delete: (path: string, handler: Route) =>
			routes.set(`DELETE ${path}`, handler),
	} as unknown as Router);
});

function route(method: string, path: string): Route {
	const handler = routes.get(`${method} ${path}`);
	if (handler === undefined) {
		throw new Error(`route ${method} ${path} was not registered`);
	}
	return handler;
}

function aRequest(
	body: unknown,
	extra: { cardId?: string; ifMatch?: string } = {},
): Request {
	return {
		params: { homeId: HOME, ...(extra.cardId ? { cardId: extra.cardId } : {}) },
		body,
		query: {},
		get: (name: string) => (name === "if-match" ? extra.ifMatch : undefined),
	} as unknown as Request;
}

function aResponse(): Response & {
	json: jest.Mock;
	status: jest.Mock;
} {
	const response = {
		locals: { caller: ME },
		setHeader: jest.fn(),
		status: jest.fn(() => response),
		json: jest.fn(),
	};
	return response as unknown as Response & {
		json: jest.Mock;
		status: jest.Mock;
	};
}

/**
 * The household's config, as the app would have written it: one seed on the
 * global surface, one home card, one shared card this member hid.
 */
const ongoing = {
	id: "ongoing",
	kind: "filter",
	seedId: "ongoing",
	title: null,
	conditions: [{ field: "status", anyOf: ["execution"] }],
	sort: null,
	shown: 5,
	max: 20,
	empty: { mode: "say", key: "overview.ongoing.empty" },
	rank: "a0",
};

const local = {
	...ongoing,
	id: "local",
	seedId: null,
	title: "Local",
	rank: "a8",
};
const sharedCard = {
	...ongoing,
	id: "shared-1",
	seedId: null,
	title: "Shared",
	rank: "b0",
};

function seedStore(): void {
	store.clear();
	document(GLOBAL_PATH, { cards: { ongoing }, seededAt: "seeded" });
	document(HOME_DASH_PATH, { cards: { local }, hiddenSharedIds: ["shared-1"] });
	document(`${SHARED_PREFIX}/shared-1`, sharedCard);
}

beforeEach(() => {
	store.clear();
	autoIds = 0;
	jest.clearAllMocks();
	jest.mocked(homeAccess).mockResolvedValue({
		homeId: HOME,
		callerName: "Marcus",
		memberUids: ["uidMarcus", "uidAnna"],
	});
	seedStore();
});

function storedCards(path: string): Record<string, unknown> {
	const cards = store.get(path)?.cards;
	return (cards ?? {}) as Record<string, unknown>;
}

describe("GET /homes/:homeId/cards", () => {
	it("returns the merged list with scope and hidden flag, in rank order", async () => {
		const response = aResponse();
		await route("GET", "/homes/:homeId/cards")(aRequest(undefined), response);

		const rows = response.json.mock.calls[0][0].cards as Array<
			Record<string, unknown>
		>;
		expect(rows.map((row) => row.id)).toEqual(["ongoing", "local", "shared-1"]);
		expect(rows.map((row) => row.scope)).toEqual(["global", "home", "shared"]);
		expect(rows.find((row) => row.id === "shared-1")?.hidden).toBe(true);
		expect(rows.find((row) => row.id === "local")?.hidden).toBe(false);
		expect(rows[0].etag).toBe(etagForCard(ongoing));
	});

	it("seeds nothing: a household with no config reads empty", async () => {
		store.clear();
		const response = aResponse();
		await route("GET", "/homes/:homeId/cards")(aRequest(undefined), response);

		expect(response.json.mock.calls[0][0].cards).toEqual([]);
		expect(store.size).toBe(0);
	});
});

describe("POST /homes/:homeId/cards", () => {
	it("appends a home card to the owner's own map, ranked last", async () => {
		const response = aResponse();
		await route("POST", "/homes/:homeId/cards")(
			aRequest({ scope: "home", title: "  New card  " }),
			response,
		);

		const row = response.json.mock.calls[0][0] as Record<string, unknown>;
		expect(response.status).toHaveBeenCalledWith(201);
		expect(row.title).toBe("New card");
		expect(row.scope).toBe("home");
		// A fractional rank the API computed, not one the body sent.
		expect(row.rank).toEqual(expect.any(String));
		expect(row.rank.length).toBeGreaterThan(0);

		const cards = storedCards(HOME_DASH_PATH);
		expect(Object.keys(cards)).toHaveLength(2);
		expect(jest.mocked(recordWrite)).toHaveBeenCalled();
		// The global config doc is untouched: a home write is a home write.
		expect(store.get(GLOBAL_PATH)?.seededAt).toBe("seeded");
	});

	it("creates a shared card as its own document", async () => {
		const response = aResponse();
		await route("POST", "/homes/:homeId/cards")(
			aRequest({ scope: "shared", title: "For everyone" }),
			response,
		);

		const sharedPaths = [...store.keys()].filter((path) =>
			path.startsWith(SHARED_PREFIX),
		);
		expect(sharedPaths).toHaveLength(2);
		const created = store.get(
			sharedPaths.find((path) => !path.endsWith("shared-1")) ?? "",
		);
		expect(created?.title).toBe("For everyone");
	});

	it("creates the global config doc when it is missing, without seeding", async () => {
		store.clear();
		const response = aResponse();
		await route("POST", "/homes/:homeId/cards")(
			aRequest({ scope: "global", title: "First" }),
			response,
		);

		expect(Object.keys(storedCards(GLOBAL_PATH))).toHaveLength(1);
		expect(store.get(GLOBAL_PATH)?.seededAt).toBeUndefined();
	});

	it("refuses a create with no scope", async () => {
		const response = aResponse();
		await expect(
			route("POST", "/homes/:homeId/cards")(
				aRequest({ title: "No surface" }),
				response,
			),
		).rejects.toMatchObject({ status: 400, code: "invalid_scope" });
	});

	it("refuses a rank and a seedId by name", async () => {
		await expect(
			route("POST", "/homes/:homeId/cards")(
				aRequest({ scope: "home", title: "x", rank: "a0" }),
				aResponse(),
			),
		).rejects.toMatchObject({ code: "rank_computed" });
		await expect(
			route("POST", "/homes/:homeId/cards")(
				aRequest({ scope: "home", title: "x", seedId: "ongoing" }),
				aResponse(),
			),
		).rejects.toMatchObject({ code: "seed_immutable" });
	});

	it("refuses an empty title", async () => {
		await expect(
			route("POST", "/homes/:homeId/cards")(
				aRequest({ scope: "home", title: "   " }),
				aResponse(),
			),
		).rejects.toMatchObject({ code: "title_required" });
	});
});

describe("PATCH /homes/:homeId/cards/:cardId", () => {
	it("rewrites the map with the edit and keeps the other card", async () => {
		const response = aResponse();
		await route("PATCH", "/homes/:homeId/cards/:cardId")(
			aRequest({ title: "Renamed" }, { cardId: "local" }),
			response,
		);

		const cards = storedCards(HOME_DASH_PATH);
		expect(cards.local).toMatchObject({ title: "Renamed" });
		expect(cards.ongoing).toBeUndefined();
		expect(store.get(HOME_DASH_PATH)?.hiddenSharedIds).toEqual(["shared-1"]);
		expect(response.json.mock.calls[0][0]).toMatchObject({
			id: "local",
			title: "Renamed",
			scope: "home",
		});
	});

	it("answers 412 when If-Match disagrees", async () => {
		await expect(
			route("PATCH", "/homes/:homeId/cards/:cardId")(
				aRequest({ title: "Renamed" }, { cardId: "local", ifMatch: '"stale"' }),
				aResponse(),
			),
		).rejects.toMatchObject({ status: 412, code: "version_mismatch" });
	});

	it("lets a fresh etag from the list guard the write", async () => {
		await expect(
			route("PATCH", "/homes/:homeId/cards/:cardId")(
				aRequest(
					{ title: "Renamed" },
					{ cardId: "local", ifMatch: etagForCard(local) },
				),
				aResponse(),
			),
		).resolves.toBeUndefined();
		expect(storedCards(HOME_DASH_PATH).local).toMatchObject({
			title: "Renamed",
		});
	});

	it("moves a card between surfaces in one commit", async () => {
		await route("PATCH", "/homes/:homeId/cards/:cardId")(
			aRequest({ scope: "shared" }, { cardId: "local" }),
			aResponse(),
		);

		// Both sides of the move landed: the shared doc exists, the home map
		// lost the id, and neither surface still holds a copy the other lacks.
		expect(store.get(`${SHARED_PREFIX}/local`)).toMatchObject({ id: "local" });
		expect(storedCards(HOME_DASH_PATH)).toEqual({});
	});

	it("moves a shared card onto a surface, removing the shared doc", async () => {
		await route("PATCH", "/homes/:homeId/cards/:cardId")(
			aRequest({ scope: "home" }, { cardId: "shared-1" }),
			aResponse(),
		);

		expect(store.get(`${SHARED_PREFIX}/shared-1`)).toBeUndefined();
		expect(storedCards(HOME_DASH_PATH)["shared-1"]).toMatchObject({
			title: "Shared",
		});
	});

	it("writes hidden only onto the caller's own doc", async () => {
		const response = aResponse();
		await route("PATCH", "/homes/:homeId/cards/:cardId")(
			aRequest({ hidden: false }, { cardId: "shared-1" }),
			response,
		);

		expect(store.get(HOME_DASH_PATH)?.hiddenSharedIds).toEqual([]);
		expect(response.json.mock.calls[0][0]).toMatchObject({
			id: "shared-1",
			hidden: false,
		});
		// The card itself did not move or change.
		expect(store.get(`${SHARED_PREFIX}/shared-1`)).toMatchObject({
			title: "Shared",
		});
	});

	it("refuses hidden on a card that does not end on the shared surface", async () => {
		await expect(
			route("PATCH", "/homes/:homeId/cards/:cardId")(
				aRequest({ hidden: true }, { cardId: "local" }),
				aResponse(),
			),
		).rejects.toMatchObject({ status: 400, code: "hidden_not_shared" });
	});

	it("answers 404 for a card no surface holds", async () => {
		await expect(
			route("PATCH", "/homes/:homeId/cards/:cardId")(
				aRequest({ title: "x" }, { cardId: "nope" }),
				aResponse(),
			),
		).rejects.toMatchObject({ status: 404, code: "card_not_found" });
	});
});

describe("DELETE /homes/:homeId/cards/:cardId", () => {
	it("rewrites the map without the id — the card does not survive", async () => {
		await route("DELETE", "/homes/:homeId/cards/:cardId")(
			aRequest(undefined, { cardId: "local" }),
			aResponse(),
		);

		const cards = storedCards(HOME_DASH_PATH);
		expect(cards.local).toBeUndefined();
		expect(cards.ongoing).toBeUndefined();
		// The other surface's card is untouched.
		expect(storedCards(GLOBAL_PATH).ongoing).toMatchObject({ id: "ongoing" });
	});

	it("deletes a shared card's own document", async () => {
		await route("DELETE", "/homes/:homeId/cards/:cardId")(
			aRequest(undefined, { cardId: "shared-1" }),
			aResponse(),
		);

		expect(store.get(`${SHARED_PREFIX}/shared-1`)).toBeUndefined();
	});
});

describe("POST /homes/:homeId/cards:reorder", () => {
	it("computes fresh ranks from the order sent, across all surfaces", async () => {
		const response = aResponse();
		await route("POST", "/homes/:homeId/cards\\:reorder")(
			aRequest({ order: ["shared-1", "local", "ongoing"] }),
			response,
		);

		expect(response.json.mock.calls[0][0]).toEqual({ reordered: 3 });
		expect(storedCards(GLOBAL_PATH).ongoing).toMatchObject({
			rank: expect.any(String),
		});
		expect(storedCards(HOME_DASH_PATH).local).toMatchObject({
			rank: expect.any(String),
		});
		expect(store.get(`${SHARED_PREFIX}/shared-1`)).toMatchObject({
			rank: expect.any(String),
		});
		const globalRank = (storedCards(GLOBAL_PATH).ongoing as { rank: string })
			.rank;
		const homeRank = (storedCards(HOME_DASH_PATH).local as { rank: string })
			.rank;
		const sharedRank = (
			store.get(`${SHARED_PREFIX}/shared-1`) as { rank: string }
		).rank;
		expect(sharedRank < homeRank).toBe(true);
		expect(homeRank < globalRank).toBe(true);
	});

	it("refuses an order that omits a card", async () => {
		await expect(
			route("POST", "/homes/:homeId/cards\\:reorder")(
				aRequest({ order: ["ongoing"] }),
				aResponse(),
			),
		).rejects.toMatchObject({ status: 400, code: "invalid_order" });
	});

	it("refuses an order naming an id no surface holds", async () => {
		await expect(
			route("POST", "/homes/:homeId/cards\\:reorder")(
				aRequest({ order: ["ongoing", "local", "ghost"] }),
				aResponse(),
			),
		).rejects.toMatchObject({ status: 400, code: "unknown_card" });
	});
});
