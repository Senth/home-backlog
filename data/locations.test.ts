import type {
	DocumentData,
	QueryDocumentSnapshot,
	QuerySnapshot,
	WriteBatch,
} from "firebase/firestore";
import {
	compareLocations,
	createLocation,
	deleteLocation,
	locationErrorKey,
	moveLocation,
	renameLocation,
} from "@/data/locations";
import type { Location } from "@/models/locations";

jest.mock("@/config/firebase", () => ({ db: {} }));

jest.mock("firebase/firestore", () => ({
	collection: jest.fn(() => ({})),
	doc: jest.fn((...args: unknown[]) => ({
		id:
			typeof args[args.length - 1] === "string"
				? args[args.length - 1]
				: "new-location",
	})),
	query: jest.fn((value: unknown) => value),
	serverTimestamp: jest.fn(() => "server-timestamp"),
	setDoc: jest.fn(),
	updateDoc: jest.fn(),
	getDocsFromServer: jest.fn(),
	writeBatch: jest.fn(),
}));

import {
	getDocsFromServer,
	setDoc,
	updateDoc,
	writeBatch,
} from "firebase/firestore";

const mockSetDoc = jest.mocked(setDoc);
const mockUpdateDoc = jest.mocked(updateDoc);
const mockGetDocsFromServer = jest.mocked(getDocsFromServer);
const mockWriteBatch = jest.mocked(writeBatch);

function location(overrides: Partial<Location> = {}): Location {
	return {
		id: "garden",
		title: "Garden",
		parentId: null,
		ancestorIds: [],
		rank: "a0",
		createdAt: null,
		createdBy: "uid-owner",
		updatedAt: null,
		...overrides,
	};
}

/** Only what `toLocation` reads, plus the `ref` a batch write needs. */
function stored(id: string, ancestorIds: string[]) {
	return {
		id,
		ref: { id },
		data: () => ({ ancestorIds }),
	} as unknown as QueryDocumentSnapshot<DocumentData>;
}

function found(...documents: QueryDocumentSnapshot<DocumentData>[]) {
	return { docs: documents } as unknown as QuerySnapshot<DocumentData>;
}

/** `count` descendants under garden, to exercise the batch cap. */
function descendants(count: number) {
	return found(
		...Array.from({ length: count }, (_, index) =>
			stored(`loc-${index}`, ["garden"]),
		),
	);
}

let batch: { update: jest.Mock; delete: jest.Mock };

beforeEach(() => {
	jest.clearAllMocks();
	mockSetDoc.mockReturnValue(Promise.resolve());
	mockUpdateDoc.mockReturnValue(Promise.resolve());
	batch = { update: jest.fn(), delete: jest.fn() };
	mockWriteBatch.mockReturnValue({
		...batch,
		commit: () => Promise.resolve(),
	} as unknown as WriteBatch);
});

describe("compareLocations", () => {
	it("puts the roots first", () => {
		expect(
			compareLocations(location(), location({ id: "bed", parentId: "garden" })),
		).toBeLessThan(0);
	});

	it("orders siblings by rank", () => {
		expect(
			compareLocations(
				location({ id: "a", parentId: "garden", rank: "a0" }),
				location({ id: "b", parentId: "garden", rank: "a1" }),
			),
		).toBeLessThan(0);
	});

	it("breaks a rank tie on the id", () => {
		expect(
			compareLocations(
				location({ id: "b", parentId: "garden", rank: "a0" }),
				location({ id: "a", parentId: "garden", rank: "a0" }),
			),
		).toBeGreaterThan(0);
	});
});

describe("createLocation", () => {
	it("writes the derived document and returns the id at once", async () => {
		const { id, acknowledged } = createLocation("home-1", "uid-owner", {
			title: "  Garden  ",
			rank: "a0",
		});

		await expect(acknowledged).resolves.toBeUndefined();
		expect(id).toBe("new-location");
		expect(mockSetDoc).toHaveBeenCalledWith(
			{ id: "new-location" },
			{
				title: "Garden",
				rank: "a0",
				parentId: null,
				ancestorIds: [],
				createdAt: "server-timestamp",
				createdBy: "uid-owner",
				updatedAt: "server-timestamp",
			},
		);
	});

	it("derives a child's path from its parent", () => {
		createLocation("home-1", "uid-owner", {
			title: "Trädgården",
			rank: "a1",
			parent: location({ id: "ute" }),
		});

		expect(mockSetDoc).toHaveBeenCalledWith(
			{ id: "new-location" },
			expect.objectContaining({
				parentId: "ute",
				ancestorIds: ["ute"],
			}),
		);
	});

	it("logs a failure instead of leaving an unhandled rejection", async () => {
		const reason = new Error("offline");
		mockSetDoc.mockReturnValueOnce(Promise.reject(reason));
		const consoleError = jest.spyOn(console, "error").mockImplementation();

		const { acknowledged } = createLocation("home-1", "uid-owner", {
			title: "Garden",
			rank: "a0",
		});

		await expect(acknowledged).rejects.toBe(reason);
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});
});

describe("renameLocation", () => {
	it("writes the trimmed title", async () => {
		await renameLocation("home-1", "garden", "  Trädgården  ");

		expect(mockUpdateDoc).toHaveBeenCalledWith(
			{ id: "garden" },
			{ title: "Trädgården", updatedAt: "server-timestamp" },
		);
	});

	it("logs a failure instead of leaving an unhandled rejection", async () => {
		const reason = new Error("offline");
		mockUpdateDoc.mockReturnValueOnce(Promise.reject(reason));
		const consoleError = jest.spyOn(console, "error").mockImplementation();

		await expect(renameLocation("home-1", "garden", "Garden")).rejects.toBe(
			reason,
		);
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});
});

describe("moveLocation", () => {
	it("refuses a move into its own subtree before reading or writing", async () => {
		const garden = location();
		const bed = location({ id: "bed", ancestorIds: ["garden"] });

		await expect(moveLocation("home-1", garden, bed, "a1")).rejects.toThrow(
			"own subtree",
		);

		expect(mockGetDocsFromServer).not.toHaveBeenCalled();
		expect(mockWriteBatch).not.toHaveBeenCalled();
	});

	it("rewrites the moved document's path and every descendant's, in one batch", async () => {
		mockGetDocsFromServer.mockReturnValueOnce(
			Promise.resolve(
				found(
					stored("apples", ["garden", "bed"]),
					stored("basement", []),
					stored("bed", ["garden"]),
				),
			),
		);

		await moveLocation("home-1", location(), location({ id: "ute" }), "a1");

		expect(mockGetDocsFromServer).toHaveBeenCalledTimes(1);
		expect(batch.update.mock.calls.map((call) => call[0].id)).toEqual([
			"garden",
			"apples",
			"bed",
		]);
		expect(batch.update).toHaveBeenCalledWith(
			{ id: "garden" },
			{
				parentId: "ute",
				ancestorIds: ["ute"],
				rank: "a1",
				updatedAt: "server-timestamp",
			},
		);
		// Each descendant keeps the tail of its own path and takes the new
		// prefix; the unrelated basement is untouched.
		expect(batch.update).toHaveBeenCalledWith(
			{ id: "apples" },
			{
				ancestorIds: ["ute", "garden", "bed"],
				updatedAt: "server-timestamp",
			},
		);
		expect(batch.update).toHaveBeenCalledWith(
			{ id: "bed" },
			{
				ancestorIds: ["ute", "garden"],
				updatedAt: "server-timestamp",
			},
		);
	});

	it("refuses a move whose subtree no longer fits one batch", async () => {
		mockGetDocsFromServer.mockReturnValueOnce(
			Promise.resolve(descendants(500)),
		);

		await expect(
			moveLocation("home-1", location(), location({ id: "ute" }), "a1"),
		).rejects.toMatchObject({ code: "subtree-too-large" });

		expect(mockWriteBatch).not.toHaveBeenCalled();
	});

	it("commits at the cap: 499 descendants plus the moved location", async () => {
		mockGetDocsFromServer.mockReturnValueOnce(
			Promise.resolve(descendants(499)),
		);

		await moveLocation("home-1", location(), location({ id: "ute" }), "a1");

		expect(batch.update).toHaveBeenCalledTimes(500);
	});

	it("moves to the top level as a root", async () => {
		mockGetDocsFromServer.mockReturnValueOnce(Promise.resolve(found()));

		await moveLocation(
			"home-1",
			location({ parentId: "ute", ancestorIds: ["ute"] }),
			null,
			"a0",
		);

		expect(batch.update).toHaveBeenCalledWith(
			{ id: "garden" },
			{
				parentId: null,
				ancestorIds: [],
				rank: "a0",
				updatedAt: "server-timestamp",
			},
		);
	});
});

describe("deleteLocation", () => {
	it("deletes the subtree and the location itself, from one server read", async () => {
		mockGetDocsFromServer.mockReturnValueOnce(
			Promise.resolve(
				found(
					stored("apples", ["garden", "bed"]),
					stored("basement", []),
					stored("bed", ["garden"]),
				),
			),
		);

		await deleteLocation("home-1", location());

		expect(mockGetDocsFromServer).toHaveBeenCalledTimes(1);
		expect(batch.delete.mock.calls.map((call) => call[0].id)).toEqual([
			"apples",
			"bed",
			"garden",
		]);
	});

	it("refuses a delete whose subtree no longer fits one batch", async () => {
		mockGetDocsFromServer.mockReturnValueOnce(
			Promise.resolve(descendants(500)),
		);

		await expect(deleteLocation("home-1", location())).rejects.toMatchObject({
			code: "subtree-too-large",
		});

		expect(mockWriteBatch).not.toHaveBeenCalled();
	});
});

describe("locationErrorKey", () => {
	it.each([
		[{ code: "subtree-too-large" }, "error.subtreeTooLarge"],
		[{ code: "permission-denied" }, "error.saveFailed"],
		[new Error("boom"), "error.saveFailed"],
		[null, "error.saveFailed"],
	])("maps %p to %p", (reason, key) => {
		expect(locationErrorKey(reason)).toBe(key);
	});
});
