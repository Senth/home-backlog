import { jest } from "@jest/globals";

/**
 * The storage cleanup triggers, against a fake bucket.
 *
 * What these handlers decide is the prefix and the nothing-to-delete no-op;
 * the counter arithmetic is deliberately not here to test — it happens in the
 * `onObjectDeleted` trigger the deletes themselves fire (`on-object-written.ts`),
 * and faking it twice is exactly the drift the plan forbids.
 */

const deleted: string[] = [];
let listed: {
	name: string;
	delete: () => Promise<void>;
}[] = [];

/** A listed file whose delete records itself — the handler calls per file. */
function file(name: string) {
	return {
		name,
		delete: async () => {
			deleted.push(name);
		},
	};
}

jest.unstable_mockModule("firebase-admin/storage", () => ({
	getStorage: () => ({
		bucket: () => ({
			getFiles: async ({ prefix }: { prefix: string }) => [
				listed.filter((f) => f.name.startsWith(prefix)),
			],
		}),
	}),
}));

const { deleteObjectsUnder, onHomeDeleted, onNodeDeleted } = await import(
	"./on-deleted.js"
);

/**
 * A minimal Firestore event. The v2 wrapper derives `event.params` by
 * matching `event.document` against the trigger's own document pattern, so
 * the fake carries the path and the wiring is exercised for real.
 */
function deleteEvent(document: string) {
	return { document } as unknown as Parameters<typeof onNodeDeleted>[0];
}

beforeEach(() => {
	deleted.length = 0;
	listed = [];
});

describe("deleteObjectsUnder", () => {
	it("deletes every file listed under the prefix", async () => {
		listed = [
			file("homes/h1/nodes/n1/a.jpg"),
			file("homes/h1/nodes/n1/a.jpg_thumb.jpg"),
		];

		expect(await deleteObjectsUnder("homes/h1/nodes/n1/")).toBe(2);
		expect(deleted).toEqual([
			"homes/h1/nodes/n1/a.jpg",
			"homes/h1/nodes/n1/a.jpg_thumb.jpg",
		]);
	});

	it("deletes nothing when the prefix lists no files", async () => {
		expect(await deleteObjectsUnder("homes/h1/nodes/n1/")).toBe(0);
		expect(deleted).toEqual([]);
	});
});

describe("the node-deleted trigger", () => {
	it("removes the node's attachments and their thumbnails", async () => {
		listed = [
			file("homes/h1/nodes/n1/a.jpg"),
			file("homes/h1/nodes/n1/a.jpg_thumb.jpg"),
			file("homes/h1/nodes/n1/b.pdf"),
			file("homes/h1/nodes/other/c.jpg"),
		];

		await onNodeDeleted(deleteEvent("homes/h1/nodes/n1"));

		expect(deleted).toEqual([
			"homes/h1/nodes/n1/a.jpg",
			"homes/h1/nodes/n1/a.jpg_thumb.jpg",
			"homes/h1/nodes/n1/b.pdf",
		]);
	});

	it("is a no-op for a node with no attachments", async () => {
		await onNodeDeleted(deleteEvent("homes/h1/nodes/n1"));

		expect(deleted).toEqual([]);
	});
});

describe("the home-deleted trigger", () => {
	it("removes every object under the home, attachments or not", async () => {
		listed = [
			file("homes/h1/nodes/n1/a.jpg"),
			file("homes/h1/nodes/n1/a.jpg_thumb.jpg"),
			file("homes/h1/loose.jpg"),
		];

		await onHomeDeleted(deleteEvent("homes/h1"));

		expect(deleted).toEqual([
			"homes/h1/nodes/n1/a.jpg",
			"homes/h1/nodes/n1/a.jpg_thumb.jpg",
			"homes/h1/loose.jpg",
		]);
	});

	it("is a no-op for a home that held nothing", async () => {
		await onHomeDeleted(deleteEvent("homes/h1"));

		expect(deleted).toEqual([]);
	});
});
