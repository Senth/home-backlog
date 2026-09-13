import { jest } from "@jest/globals";
import type { Request, Response, Router } from "express";
import type {
	DocumentData,
	QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { etagFor } from "./api-nodes.js";
import type { ApiCaller } from "./auth.js";
import { ApiError } from "./errors.js";
import { statuses } from "./node.js";

/**
 * The write verbs' contract beyond `If-Match`: who a shared root is on when the
 * body stays silent, and what a promoted step takes with it.
 *
 * The Firestore wiring is faked at the module boundary (`firestore.js`,
 * `auth.js`) rather than with an emulator, exactly because these branches are
 * decisions, not I/O behavior — the same split the bulk and validate suites
 * draw.
 */

const stamp = { toDate: () => new Date("2026-08-31T12:00:00.000Z") };

const HOME = "home-1";
const MEMBERS = ["uidMarcus", "uidAnna"];

const ME: ApiCaller = {
	uid: "uidMarcus",
	keyId: "key-1",
	keyName: "CLI",
	keyRef: {} as ApiCaller["keyRef"],
};

const store = {
	documents: new Map<string, Record<string, unknown>>(),
	columnDocs: [] as QueryDocumentSnapshot<DocumentData>[],
	subtreeDocs: [] as QueryDocumentSnapshot<DocumentData>[],
	batches: [] as { set: jest.Mock; update: jest.Mock; commit: jest.Mock }[],
};

function document(path: string, fields: Record<string, unknown>): void {
	store.documents.set(path, fields);
}

function snapshotFor(path: string) {
	const fields = store.documents.get(path);
	return {
		id: path.split("/").pop() ?? "",
		exists: fields !== undefined,
		data: () => fields,
		get: (field: string) => fields?.[field],
	};
}

function collectionAt(path: string) {
	return {
		doc: (id?: string) => docAt(`${path}/${id ?? "new-node"}`),
		where: () => queryAt(),
	};
}

function docAt(path: string) {
	return {
		id: path.split("/").pop(),
		path,
		get: async () => snapshotFor(path),
		collection: (sub: string) => collectionAt(`${path}/${sub}`),
	};
}

function queryAt() {
	let wheres = 0;
	const chain = {
		where: () => {
			wheres += 1;
			return chain;
		},
		orderBy: () => chain,
		get: async () => ({
			docs: wheres >= 2 ? store.columnDocs : store.subtreeDocs,
		}),
	};
	return chain;
}

function resetStore(): void {
	store.documents.clear();
	store.columnDocs = [];
	store.subtreeDocs = [];
	store.batches = [];
}

jest.unstable_mockModule("./firestore.js", () => ({
	homesCollection: "homes",
	nodesCollection: "nodes",
	locationsCollection: "locations",
	maxBatchWrites: 500,
	db: {
		collection: (name: string) => collectionAt(name),
		batch: () => {
			const batch = { set: jest.fn(), update: jest.fn(), commit: jest.fn() };
			store.batches.push(batch);
			return batch;
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

// `handle` wraps an async route so the rejection reaches `next` instead of the
// caller; a test that awaits the handler needs the route back unwrapped, or the
// promise is swallowed and the handler races the assertions.
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

const { checkPrecondition, registerWriteRoutes } = await import("./writes.js");
const { homeAccess } = await import("./auth.js");

function request(ifMatch: string | undefined): Request {
	return {
		get: (name: string) => (name === "if-match" ? ifMatch : undefined),
	} as unknown as Request;
}

function snapshot(updatedAt: unknown): DocumentSnapshot {
	return {
		get: (field: string) => (field === "updatedAt" ? updatedAt : undefined),
	} as unknown as DocumentSnapshot;
}

describe("checkPrecondition", () => {
	it("lets a write through when no If-Match is sent", () => {
		expect(() =>
			checkPrecondition(request(undefined), snapshot(stamp)),
		).not.toThrow();
	});

	it("lets a write through when the If-Match matches", () => {
		expect(() =>
			checkPrecondition(request(etagFor(stamp)), snapshot(stamp)),
		).not.toThrow();
	});

	it("refuses a stale If-Match with 412 version_mismatch", () => {
		expect(() =>
			checkPrecondition(
				request(etagFor({ toDate: () => new Date(0) })),
				snapshot(stamp),
			),
		).toThrow(
			expect.objectContaining({ status: 412, code: "version_mismatch" }),
		);
	});
});

type Route = (request: Request, response: Response) => Promise<void>;

const routes = new Map<string, Route>();

beforeAll(() => {
	registerWriteRoutes({
		post: (path: string, handler: Route) => routes.set(`POST ${path}`, handler),
		patch: (path: string, handler: Route) =>
			routes.set(`PATCH ${path}`, handler),
		delete: (path: string, handler: Route) =>
			routes.set(`DELETE ${path}`, handler),
	} as unknown as Router);
});

function route(method: "POST" | "PATCH", path: string): Route {
	const handler = routes.get(`${method} ${path}`);
	if (handler === undefined) {
		throw new Error(`route ${method} ${path} was not registered`);
	}
	return handler;
}

function aRequest(body: unknown, nodeId?: string): Request {
	return {
		params: nodeId === undefined ? { homeId: HOME } : { homeId: HOME, nodeId },
		body,
		query: {},
		get: () => undefined,
	} as unknown as Request;
}

function aResponse(): Response {
	const response = {
		locals: { caller: ME },
		setHeader: jest.fn(),
		status: jest.fn(() => response),
		json: jest.fn(),
	};
	return response as unknown as Response;
}

beforeEach(() => {
	resetStore();
	jest.clearAllMocks();
	jest.mocked(homeAccess).mockResolvedValue({
		homeId: HOME,
		callerName: "Marcus",
		memberUids: MEMBERS,
	});
});

function writtenDocument(): Record<string, unknown> {
	const set = store.batches[0]?.set as jest.Mock | undefined;
	expect(set).toHaveBeenCalled();
	return set.mock.calls[0][1] as Record<string, unknown>;
}

describe("POST /homes/:homeId/nodes", () => {
	it("defaults a shared root with no participantIds to every current member", async () => {
		await route("POST", "/homes/:homeId/nodes")(
			aRequest({ title: "Card" }),
			aResponse(),
		);

		expect(writtenDocument().participantIds).toEqual(MEMBERS);
	});

	it("takes the participantIds the body names, instead of the default", async () => {
		await route("POST", "/homes/:homeId/nodes")(
			aRequest({ title: "Card", participantIds: ["uidAnna"] }),
			aResponse(),
		);

		expect(writtenDocument().participantIds).toEqual(["uidAnna"]);
	});

	it("writes the labelIds the body names, so a labelled card round-trips", async () => {
		await route("POST", "/homes/:homeId/nodes")(
			aRequest({ title: "Card", labelIds: ["label-1", "label-2"] }),
			aResponse(),
		);

		expect(writtenDocument().labelIds).toEqual(["label-1", "label-2"]);
	});

	it("defaults labelIds to none, the shape every pre-label node shares", async () => {
		await route("POST", "/homes/:homeId/nodes")(
			aRequest({ title: "Card" }),
			aResponse(),
		);

		expect(writtenDocument().labelIds).toEqual([]);
	});

	it("files the card where locationId says, deriving the path from the place", async () => {
		document(`homes/${HOME}/locations/loc-1`, { ancestorIds: ["loc-root"] });

		await route("POST", "/homes/:homeId/nodes")(
			aRequest({ title: "Card", locationId: "loc-1" }),
			aResponse(),
		);

		expect(writtenDocument()).toMatchObject({
			locationId: "loc-1",
			locationAncestorIds: ["loc-root"],
		});
	});

	it("answers 404 for a location the home does not have", async () => {
		await expect(
			route("POST", "/homes/:homeId/nodes")(
				aRequest({ title: "Card", locationId: "loc-gone" }),
				aResponse(),
			),
		).rejects.toMatchObject({ status: 404, code: "location_not_found" });
	});

	it("inherits the parent's place when the body is silent, and unfiles on null", async () => {
		storedNode("root", {
			parentId: null,
			ancestorIds: [],
			locationId: "loc-1",
			locationAncestorIds: ["loc-root"],
		});

		await route("POST", "/homes/:homeId/nodes")(
			aRequest({ title: "Card", parentId: "root" }),
			aResponse(),
		);
		expect(writtenDocument()).toMatchObject({
			locationId: "loc-1",
			locationAncestorIds: ["loc-root"],
		});

		await route("POST", "/homes/:homeId/nodes")(
			aRequest({ title: "Card", parentId: "root", locationId: null }),
			aResponse(),
		);
		expect(store.batches[1].set.mock.calls[0][1]).toMatchObject({
			locationId: null,
			locationAncestorIds: [],
		});
	});
});

/** Only the fields `validateNode` reads on the merged document. */
function storedNode(id: string, over: Record<string, unknown> = {}): void {
	document(`homes/${HOME}/nodes/${id}`, {
		title: "Step",
		status: "backlog",
		rank: "a1",
		parentId: "root",
		ancestorIds: ["root"],
		visibility: "shared",
		participantIds: [],
		columns: [...statuses],
		childCount: 0,
		doneCount: 0,
		locationId: null,
		locationAncestorIds: [],
		assigneeIds: [],
		blockedBy: [],
		notes: "",
		checklist: [],
		photos: [],
		archived: false,
		dueDate: null,
		priority: null,
		effort: null,
		completedAt: null,
		createdAt: stamp,
		updatedAt: stamp,
		createdBy: ME.uid,
		...over,
	});
}

describe("PATCH /homes/:homeId/nodes/:nodeId", () => {
	it("promotes a shared step to a root carrying the old root's participants", async () => {
		storedNode("root", {
			participantIds: MEMBERS,
			parentId: null,
			ancestorIds: [],
		});
		storedNode("step");
		const response = aResponse();

		await route("PATCH", "/homes/:homeId/nodes/:nodeId")(
			aRequest({ parentId: null }, "step"),
			response,
		);

		const update = store.batches[0].update as jest.Mock;
		expect(update.mock.calls[0][0].path).toBe(`homes/${HOME}/nodes/step`);
		expect(update.mock.calls[0][1]).toMatchObject({
			parentId: null,
			ancestorIds: [],
			participantIds: MEMBERS,
		});
		expect(response.status).toHaveBeenCalledWith(200);
	});

	it("carries labelIds through as an ordinary field write", async () => {
		storedNode("root", { parentId: null, ancestorIds: [] });
		storedNode("step");

		await route("PATCH", "/homes/:homeId/nodes/:nodeId")(
			aRequest({ labelIds: ["label-1"] }, "step"),
			aResponse(),
		);

		const update = store.batches[0].update as jest.Mock;
		expect(update.mock.calls[0][1]).toMatchObject({
			labelIds: ["label-1"],
		});
	});

	it("files the card where locationId says, and unfiles on null", async () => {
		storedNode("root", { parentId: null, ancestorIds: [] });
		storedNode("step");
		document(`homes/${HOME}/locations/loc-1`, { ancestorIds: ["loc-root"] });

		await route("PATCH", "/homes/:homeId/nodes/:nodeId")(
			aRequest({ locationId: "loc-1" }, "step"),
			aResponse(),
		);
		const update = store.batches[0].update as jest.Mock;
		expect(update.mock.calls[0][1]).toMatchObject({
			locationId: "loc-1",
			locationAncestorIds: ["loc-root"],
		});

		await route("PATCH", "/homes/:homeId/nodes/:nodeId")(
			aRequest({ locationId: null }, "step"),
			aResponse(),
		);
		const unfiled = store.batches[1].update as jest.Mock;
		expect(unfiled.mock.calls[0][1]).toMatchObject({
			locationId: null,
			locationAncestorIds: [],
		});
	});
});
