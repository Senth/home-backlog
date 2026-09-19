import { jest } from "@jest/globals";
import { FieldValue } from "firebase-admin/firestore";

/**
 * The attachment byte counters, against a fake store.
 *
 * `storage.rules` proves the ceiling; this file proves the counter moves by
 * exactly what the platform reported, for the uploader the object names, and
 * stays silent about paths the rule shape can never produce. The fake store
 * applies `FieldValue.increment` sentinels for real, so a test that inspects
 * the home document sees what one event left behind.
 */

const store = new Map<string, Record<string, unknown>>();

function homeAt(homeId: string) {
	const path = `homes/${homeId}`;
	return {
		path,
		get: async () => ({
			exists: store.has(path),
			data: () => store.get(path),
		}),
		update: async (data: Record<string, unknown>) => {
			const next: Record<string, unknown> = { ...store.get(path) };
			for (const [field, value] of Object.entries(data)) {
				const segments = field.split(".");
				let node = next;
				for (const segment of segments.slice(0, -1)) {
					node[segment] = { ...(node[segment] as object) };
					node = node[segment] as Record<string, unknown>;
				}
				const leaf = segments[segments.length - 1];
				// FieldValue.increment carries its delta as `operand`.
				node[leaf] =
					value instanceof FieldValue
						? ((node[leaf] as number | undefined) ?? 0) +
							((value as unknown as { operand: number }).operand ?? 0)
						: value;
			}
			store.set(path, next);
		},
	};
}

jest.unstable_mockModule("./firestore.js", () => ({
	homesCollection: "homes",
	nodesCollection: "nodes",
	locationsCollection: "locations",
	usersCollection: "users",
	apiKeysCollection: "apiKeys",
	apiClientsCollection: "apiClients",
	runsCollection: "runs",
	dashboardCollection: "dashboard",
	dashboardConfigDoc: "config",
	dashboardsCollection: "dashboards",
	dashboardCardsCollection: "dashboardCards",
	maxBatchWrites: 500,
	db: {
		collection: (name: string) => ({
			doc: (id: string) =>
				name === "homes"
					? homeAt(id)
					: {
							path: `${name}/${id}`,
							get: async () => ({ exists: false }),
							update: async () => {},
						},
		}),
	},
}));

const { counterUpdate, homeIdOf, onObjectDeleted, onObjectFinalized } =
	await import("./on-object-written.js");

const HOME = "home-1";
const PATH = `homes/${HOME}/nodes/node-1/att-1.jpg`;

function documentHome(fields: Record<string, unknown>): void {
	store.set(`homes/${HOME}`, fields);
}

/** A minimal object event; only what the handlers read is filled in. */
function event(data: {
	name?: string;
	size?: number;
	metadata?: Record<string, string>;
}): Parameters<typeof onObjectFinalized>[0] {
	return {
		data,
	} as unknown as Parameters<typeof onObjectFinalized>[0];
}

beforeEach(() => {
	store.clear();
});

describe("the path parser", () => {
	it("reads the homeId out of an attachment path", () => {
		expect(homeIdOf(PATH)).toBe(HOME);
	});

	it("answers null for a file directly under the home", () => {
		expect(homeIdOf(`homes/${HOME}/loose.jpg`)).toBeNull();
	});

	it("answers null for a path nested deeper than an attachment", () => {
		expect(homeIdOf(`homes/${HOME}/nodes/node-1/sub/x.jpg`)).toBeNull();
	});

	it("answers null for the wrong collections or a missing id", () => {
		expect(homeIdOf("users/uid/keys/key-1")).toBeNull();
		expect(homeIdOf("homes//nodes/node-1/x.jpg")).toBeNull();
	});

	it("answers null for an object with no name at all", () => {
		expect(homeIdOf(undefined)).toBeNull();
	});
});

describe("counterUpdate", () => {
	it("moves the home total and the uploader's entry", () => {
		expect(counterUpdate(1024, "uidA")).toEqual({
			attachmentBytes: FieldValue.increment(1024),
			"attachmentBytesByUid.uidA": FieldValue.increment(1024),
		});
	});

	it("moves the total back for a delete", () => {
		expect(counterUpdate(-1024, "uidA")).toEqual({
			attachmentBytes: FieldValue.increment(-1024),
			"attachmentBytesByUid.uidA": FieldValue.increment(-1024),
		});
	});

	it("still moves the total when no uploader is named", () => {
		expect(counterUpdate(1024, undefined)).toEqual({
			attachmentBytes: FieldValue.increment(1024),
		});
	});
});

describe("the finalize handler", () => {
	it("moves both counters by the size the platform reported", async () => {
		documentHome({ name: "Home" });

		await onObjectFinalized(
			event({ name: PATH, size: 1024, metadata: { uploadedBy: "uidA" } }),
		);

		expect(store.get(`homes/${HOME}`)).toEqual({
			name: "Home",
			attachmentBytes: 1024,
			attachmentBytesByUid: { uidA: 1024 },
		});
	});

	it("ignores a path outside the attachment shape without throwing", async () => {
		documentHome({ name: "Home" });

		await onObjectFinalized(
			event({ name: `homes/${HOME}/loose.jpg`, size: 1024 }),
		);
		await onObjectFinalized(event({ size: 1024 }));

		expect(store.get(`homes/${HOME}`)).toEqual({ name: "Home" });
	});

	it("answers a home that is gone with a no-op", async () => {
		await onObjectFinalized(
			event({ name: PATH, size: 1024, metadata: { uploadedBy: "uidA" } }),
		);

		expect(store.has(`homes/${HOME}`)).toBe(false);
	});
});

describe("the delete handler", () => {
	it("moves both counters back by the deleted size", async () => {
		documentHome({
			name: "Home",
			attachmentBytes: 1024,
			attachmentBytesByUid: { uidA: 1024 },
		});

		await onObjectDeleted(
			event({ name: PATH, size: 1024, metadata: { uploadedBy: "uidA" } }),
		);

		expect(store.get(`homes/${HOME}`)).toEqual({
			name: "Home",
			attachmentBytes: 0,
			attachmentBytesByUid: { uidA: 0 },
		});
	});

	it("ignores a path outside the attachment shape without throwing", async () => {
		documentHome({ name: "Home", attachmentBytes: 1024 });

		await onObjectDeleted(
			event({ name: `homes/${HOME}/nodes/node-1/sub/x.jpg`, size: 1024 }),
		);

		expect(store.get(`homes/${HOME}`)?.attachmentBytes).toBe(1024);
	});
});
