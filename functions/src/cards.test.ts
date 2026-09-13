import { jest } from "@jest/globals";
import type { Request, Response, Router } from "express";
import type { ApiCaller } from "./auth.js";
import { ApiError } from "./errors.js";

/**
 * The overview-card verbs' decisions, faked at the module boundary
 * (`firestore.js`, `auth.js`) rather than against an emulator — the same
 * split `writes.test.ts` draws. What is under test is ownership (whose
 * documents a write touches), replacement (a map written whole, so removal
 * is removal) and the set equality a reorder insists on, not Firestore I/O.
 */

const HOME = "home-1";
const ME_UID = "uidMarcus";

const ME: ApiCaller = {
	uid: ME_UID,
	keyId: "key-1",
	keyName: "CLI",
	keyRef: {} as ApiCaller["keyRef"],
};

type Fields = Record<string, unknown>;

const store = new Map<string, Fields>();

interface SetOp {
	kind: "set";
	path: string;
	data: Fields;
	option?: { mergeFields?: string[] };
}

interface DeleteOp {
	kind: "delete";
	path: string;
}

const writes: (SetOp | DeleteOp)[] = [];

function snapshotFor(path: string) {
	const fields = store.get(path);
	return {
		id: path.split("/").pop() ?? "",
		exists: fields !== undefined,
		data: () => fields,
		get: (field: string) => fields?.[field],
	};
}

function docRef(path: string) {
	const parent = path.split("/").slice(0, -1).join("/");
	return {
		id: path.split("/").pop(),
		path,
		parent: collectionRef(parent),
		__fetch: async () => snapshotFor(path),
		get: async () => snapshotFor(path),
		collection: (sub: string) => collectionRef(`${path}/${sub}`),
	};
}

function collectionRef(path: string) {
	const ids = () =>
		[...store.keys()]
			.filter(
				(key) =>
					key.startsWith(`${path}/`) &&
					!key.slice(path.length + 1).includes("/"),
			)
			.sort();
	return {
		doc: (id?: string) =>
			docRef(
				id === undefined
					? `${path}/minted-${Math.random().toString(36).slice(2)}`
					: `${path}/${id}`,
			),
		__fetch: async () => ({
			docs: ids().map((key) => snapshotFor(key)),
		}),
		get: async () => ({
			docs: ids().map((key) => snapshotFor(key)),
		}),
	};
}

function resetStore(): void {
	store.clear();
	writes.length = 0;
}

function put(path: string, fields: Fields): void {
	store.set(path, fields);
}

const GLOBAL_PATH = `users/${ME_UID}/dashboard/config`;
const HOME_DASH_PATH = `homes/${HOME}/dashboards/${ME_UID}`;
const SHARED_PREFIX = `homes/${HOME}/dashboardCards`;

jest.unstable_mockModule("./firestore.js", () => ({
	homesCollection: "homes",
	nodesCollection: "nodes",
	usersCollection: "users",
	dashboardsCollection: "dashboards",
	dashboardCardsCollection: "dashboardCards",
	maxBatchWrites: 500,
	db: {
		collection: (name: string) => collectionRef(name),
		runTransaction: async (
			fn: (tx: unknown) => Promise<unknown>,
		): Promise<unknown> =>
			fn({
				get: (ref: { __fetch: () => Promise<unknown> }) => ref.__fetch(),
				set: (
					ref: { path: string },
					data: Fields,
					option?: { mergeFields?: string[] },
				) => writes.push({ kind: "set", path: ref.path, data, option }),
				delete: (ref: { path: string }) =>
					writes.push({ kind: "delete", path: ref.path }),
			}),
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

// `handle` unwrapped, so a test can await the handler — same as writes.test.ts.
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
const { homeAccess } = await import("./auth.js");

type Route = (request: Request, response: Response) => Promise<void>;

const routes = new Map<string, Route>();

beforeAll(() => {
	registerCardRoutes({
		get: (path: string, handler: Route) => routes.set(`GET ${path}`, handler),
		post: (path: string, handler: Route) => routes.set(`POST ${path}`, handler),
		put: (path: string, handler: Route) => routes.set(`PUT ${path}`, handler),
		patch: (path: string, handler: Route) =>
			routes.set(`PATCH ${path}`, handler),
		delete: (path: string, handler: Route) =>
			routes.set(`DELETE ${path}`, handler),
	} as unknown as Router);
});

interface CallOptions {
	params?: Record<string, string>;
	body?: unknown;
	ifMatch?: string;
}

async function call(
	method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
	template: string,
	{ params = { homeId: HOME }, body, ifMatch }: CallOptions = {},
): Promise<
	Response & { status: jest.Mock; json: jest.Mock; setHeader: jest.Mock }
> {
	const handler = routes.get(`${method} ${template}`);
	if (handler === undefined) {
		throw new Error(`route ${method} ${template} was not registered`);
	}
	type Rendered = Response & {
		status: jest.Mock;
		json: jest.Mock;
		setHeader: jest.Mock;
	};
	const request = {
		params,
		body,
		query: {},
		get: (name: string) => (name === "if-match" ? ifMatch : undefined),
	} as unknown as Request;
	const response = {
		locals: { caller: ME },
		setHeader: jest.fn(),
		status: jest.fn(() => response),
		json: jest.fn(),
	};
	try {
		await handler(request, response as unknown as Response);
	} catch (error) {
		// `handle` is unwrapped by the module mock, so a thrown ApiError is
		// what the app's error middleware would have rendered for it.
		if (error instanceof ApiError) {
			response.status(error.status).json({
				error: { code: error.code, message: error.message },
			});
			return response as unknown as Rendered;
		}
		throw error;
	}
	return response as unknown as Rendered;
}

const LIST = "/homes/:homeId/overview-cards";
const REORDER = "/homes/:homeId/overview-cards\\:reorder";
const CARD = "/homes/:homeId/overview-cards/:cardId";
const HIDDEN = "/homes/:homeId/overview-cards/:cardId/hidden";

function seeded(): void {
	put(GLOBAL_PATH, {
		cards: {
			"g-1": {
				kind: "filter",
				title: "All homes",
				rank: "V0",
				conditions: [],
				shown: 5,
				max: 20,
				empty: { mode: "hide" },
			},
		},
	});
	put(HOME_DASH_PATH, {
		cards: {
			"h-1": {
				kind: "filter",
				title: "This home",
				rank: "V2",
				conditions: [],
				shown: 5,
				max: 20,
				empty: { mode: "hide" },
			},
		},
		hiddenSharedIds: ["s-1"],
	});
	put(`${SHARED_PREFIX}/s-1`, {
		kind: "filter",
		title: "Hidden one",
		rank: "V1",
		conditions: [],
		shown: 5,
		max: 20,
		empty: { mode: "hide" },
	});
	put(`${SHARED_PREFIX}/s-2`, {
		kind: "filter",
		title: "Seen one",
		rank: "V3",
		conditions: [],
		shown: 5,
		max: 20,
		empty: { mode: "hide" },
	});
}

function cardRows(response: {
	json: jest.Mock;
}): { id: string; scope: string; hidden: boolean; etag: string }[] {
	return response.json.mock.calls[0][0].cards;
}

function setWrite(path: string): SetOp {
	const set = writes.find(
		(write) => write.kind === "set" && write.path === path,
	) as SetOp | undefined;
	expect(set).toBeDefined();
	return set as SetOp;
}

beforeEach(() => {
	resetStore();
	jest.clearAllMocks();
	jest.mocked(homeAccess).mockResolvedValue({
		homeId: HOME,
		callerName: "Marcus",
		memberUids: [ME_UID, "uidAnna"],
	});
});

describe("GET /overview-cards", () => {
	it("returns the merged list with scope and hide flag, in (rank, id) order", async () => {
		seeded();

		const response = await call("GET", LIST);
		const cards = cardRows(response);

		expect(cards.map((card) => card.id)).toEqual(["g-1", "s-1", "h-1", "s-2"]);
		expect(cards.map((card) => card.scope)).toEqual([
			"global",
			"shared",
			"home",
			"shared",
		]);
		expect(cards.map((card) => card.hidden)).toEqual([
			false,
			true,
			false,
			false,
		]);
		expect(cards[0].etag).toMatch(/^"[0-9a-f]{40}"$/);
	});

	it("reads a member with no config yet as no cards, not an error", async () => {
		const response = await call("GET", LIST);
		expect(response.json.mock.calls[0][0]).toEqual({ cards: [] });
	});
});

describe("POST /overview-cards", () => {
	it("creates a home-scope card at the end of the whole screen, writing the map whole", async () => {
		seeded();

		const response = await call("POST", LIST, {
			body: {
				scope: "home",
				title: "Bathroom this month",
				conditions: [{ field: "locationId", anyOf: ["loc-1"] }],
			},
		});

		expect(response.status).toHaveBeenCalledWith(201);
		const row = response.json.mock.calls[0][0];
		expect(row.scope).toBe("home");
		expect(row.title).toBe("Bathroom this month");
		expect(row.rank > "V3").toBe(true);
		expect(row.empty).toEqual({
			mode: "say",
			key: "overview.cards.empty.generic",
		});

		const set = setWrite(HOME_DASH_PATH);
		expect(set.option).toEqual({ mergeFields: ["cards"] });
		expect(Object.keys(set.data.cards as Fields)).toEqual(["h-1", row.id]);
	});

	it("creates a shared card as its own document", async () => {
		const response = await call("POST", LIST, {
			body: { scope: "shared", title: "Shared card" },
		});

		const set = writes.find(
			(write) => write.kind === "set" && write.path.startsWith(SHARED_PREFIX),
		) as SetOp;
		expect(set.path).toBe(
			`${SHARED_PREFIX}/${response.json.mock.calls[0][0].id}`,
		);
		expect(set.data).toMatchObject({ title: "Shared card", kind: "filter" });
	});

	it("refuses a global write while the config the app seeds is still missing", async () => {
		const response = await call("POST", LIST, {
			body: { scope: "global", title: "Too early" },
		});

		expect(response.status).toHaveBeenCalledWith(409);
		expect(response.json.mock.calls[0][0]).toMatchObject({
			error: { code: "global_cards_not_seeded" },
		});
		expect(writes).toEqual([]);
	});

	it("refuses a body that would write the server's own fields", async () => {
		const response = await call("POST", LIST, {
			body: { scope: "home", title: "X", rank: "V0" },
		});

		expect(response.status).toHaveBeenCalledWith(400);
		expect(response.json.mock.calls[0][0]).toMatchObject({
			error: { code: "unknown_field" },
		});
		expect(writes).toEqual([]);
	});
});

describe("PATCH /overview-cards/:cardId", () => {
	it("edits a map-scope card by rewriting the scope's cards whole", async () => {
		seeded();
		const etag = cardRows(await call("GET", LIST)).find(
			(card) => card.id === "h-1",
		)?.etag;

		await call("PATCH", CARD, {
			params: { homeId: HOME, cardId: "h-1" },
			body: { title: "Renamed" },
			ifMatch: etag,
		});

		const set = setWrite(HOME_DASH_PATH);
		expect(set.data.cards).toMatchObject({
			"h-1": { title: "Renamed", rank: "V2" },
		});
	});

	it("moves a shared card into the home scope in one transaction", async () => {
		seeded();

		const response = await call("PATCH", CARD, {
			params: { homeId: HOME, cardId: "s-2" },
			body: { scope: "home" },
		});

		const deleted = writes.find((write) => write.kind === "delete") as DeleteOp;
		expect(deleted.path).toBe(`${SHARED_PREFIX}/s-2`);
		const set = setWrite(HOME_DASH_PATH);
		expect(set.data.cards).toMatchObject({ "s-2": { rank: "V3" } });
		expect(response.json.mock.calls[0][0].scope).toBe("home");
	});

	it("answers 412 when If-Match disagrees", async () => {
		seeded();

		const response = await call("PATCH", CARD, {
			params: { homeId: HOME, cardId: "h-1" },
			body: { title: "Renamed" },
			ifMatch: '"stale"',
		});

		expect(response.status).toHaveBeenCalledWith(412);
		expect(response.json.mock.calls[0][0]).toMatchObject({
			error: { code: "version_mismatch" },
		});
		expect(writes).toEqual([]);
	});

	it("answers 404 for an id no surface holds", async () => {
		seeded();

		const response = await call("PATCH", CARD, {
			params: { homeId: HOME, cardId: "nope" },
			body: { title: "X" },
		});

		expect(response.status).toHaveBeenCalledWith(404);
		expect(response.json.mock.calls[0][0]).toMatchObject({
			error: { code: "card_not_found" },
		});
	});
});

describe("DELETE /overview-cards/:cardId", () => {
	it("deletes a shared card's document", async () => {
		seeded();

		const response = await call("DELETE", CARD, {
			params: { homeId: HOME, cardId: "s-1" },
		});

		expect(response.json.mock.calls[0][0]).toEqual({ id: "s-1", deleted: 1 });
		const deleted = writes.find((write) => write.kind === "delete") as DeleteOp;
		expect(deleted.path).toBe(`${SHARED_PREFIX}/s-1`);
	});

	it("removes a map-scope card from a map written whole, so removal is removal", async () => {
		seeded();

		await call("DELETE", CARD, {
			params: { homeId: HOME, cardId: "h-1" },
		});

		const set = setWrite(HOME_DASH_PATH);
		expect(set.data.cards).toEqual({});
	});
});

describe("POST /overview-cards:reorder", () => {
	it("rewrites the scope's ranks in the order sent, between the surrounding scopes", async () => {
		seeded();
		// The home scope's block sits between s-1 ("V1") and s-2 ("V3").

		const response = await call("POST", REORDER, {
			body: { scope: "home", ids: ["h-1"] },
		});

		const set = setWrite(HOME_DASH_PATH);
		const ranked = (set.data.cards as Fields)["h-1"] as { rank: string };
		expect(ranked.rank > "V1").toBe(true);
		expect(ranked.rank < "V3").toBe(true);
		expect(response.json.mock.calls[0][0]).toEqual({
			scope: "home",
			ids: ["h-1"],
		});
	});

	it("orders a whole scope by the ids sent", async () => {
		seeded();
		put(`${SHARED_PREFIX}/s-3`, {
			kind: "filter",
			title: "Third",
			rank: "V4",
			conditions: [],
			shown: 5,
			max: 20,
			empty: { mode: "hide" },
		});

		await call("POST", REORDER, {
			body: { scope: "shared", ids: ["s-3", "s-2", "s-1"] },
		});

		const ranks = ["s-3", "s-2", "s-1"].map(
			(id) =>
				(
					writes.find(
						(write) =>
							write.kind === "set" && write.path === `${SHARED_PREFIX}/${id}`,
					) as SetOp
				).data.rank as string,
		);
		expect(ranks[0] < ranks[1]).toBe(true);
		expect(ranks[1] < ranks[2]).toBe(true);
	});

	it("refuses a list that is not exactly the scope's cards", async () => {
		seeded();

		const partial = await call("POST", REORDER, {
			body: { scope: "home", ids: [] },
		});
		expect(partial.status).toHaveBeenCalledWith(400);
		expect(partial.json.mock.calls[0][0]).toMatchObject({
			error: { code: "card_set_mismatch" },
		});

		const duplicated = await call("POST", REORDER, {
			body: { scope: "home", ids: ["h-1", "h-1"] },
		});
		expect(duplicated.json.mock.calls[0][0]).toMatchObject({
			error: { code: "card_set_mismatch" },
		});

		const extra = await call("POST", REORDER, {
			body: { scope: "home", ids: ["h-1", "s-1"] },
		});
		expect(extra.json.mock.calls[0][0]).toMatchObject({
			error: { code: "card_set_mismatch" },
		});
		expect(writes).toEqual([]);
	});
});

describe("PUT and DELETE /overview-cards/:cardId/hidden", () => {
	it("hides a shared card on the caller's own document only", async () => {
		seeded();

		const response = await call("PUT", HIDDEN, {
			params: { homeId: HOME, cardId: "s-2" },
		});

		expect(response.json.mock.calls[0][0]).toEqual({ id: "s-2", hidden: true });
		const set = setWrite(HOME_DASH_PATH);
		expect(set.option).toEqual({ mergeFields: ["hiddenSharedIds"] });
		expect(set.data.hiddenSharedIds).toEqual(["s-1", "s-2"]);
		expect(writes.some((write) => write.path.startsWith(SHARED_PREFIX))).toBe(
			false,
		);
	});

	it("unhides by rewriting the flag without the id", async () => {
		seeded();

		const response = await call("DELETE", HIDDEN, {
			params: { homeId: HOME, cardId: "s-1" },
		});

		expect(response.json.mock.calls[0][0]).toEqual({
			id: "s-1",
			hidden: false,
		});
		const set = setWrite(HOME_DASH_PATH);
		expect(set.data.hiddenSharedIds).toEqual([]);
	});

	it("answers 404 for a card that is not shared, in either direction", async () => {
		seeded();

		const hidden = await call("PUT", HIDDEN, {
			params: { homeId: HOME, cardId: "h-1" },
		});
		expect(hidden.status).toHaveBeenCalledWith(404);
		expect(hidden.json.mock.calls[0][0]).toMatchObject({
			error: { code: "card_not_found" },
		});

		const unhidden = await call("DELETE", HIDDEN, {
			params: { homeId: HOME, cardId: "g-1" },
		});
		expect(unhidden.status).toHaveBeenCalledWith(404);
		expect(writes).toEqual([]);
	});
});

describe("ownership", () => {
	it("reads and writes only the caller's own config documents", async () => {
		seeded();

		await call("PATCH", CARD, {
			params: { homeId: HOME, cardId: "h-1" },
			body: { title: "Renamed" },
		});
		await call("PUT", HIDDEN, {
			params: { homeId: HOME, cardId: "s-2" },
		});

		for (const write of writes) {
			expect(write.path).not.toContain("dashboards/uidAnna");
			expect(write.path).not.toBe(`users/uidAnna/dashboard/config`);
		}
	});
});

it("registers the route table this suite drives", () => {
	expect([...routes.keys()]).toEqual([
		`GET ${LIST}`,
		`POST ${LIST}`,
		`POST ${REORDER}`,
		`PATCH ${CARD}`,
		`DELETE ${CARD}`,
		`PUT ${HIDDEN}`,
		`DELETE ${HIDDEN}`,
	]);
});
