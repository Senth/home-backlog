import type {
	DocumentData,
	QueryDocumentSnapshot,
	QuerySnapshot,
} from "firebase/firestore";
import type { Node } from "@/models/node";
import { newNodeData } from "@/models/node";

jest.mock("@/config/firebase", () => ({ db: {} }));

jest.mock("firebase/firestore", () => ({
	collection: jest.fn(() => ({})),
	doc: jest.fn((...args: unknown[]) => ({
		id:
			typeof args[args.length - 1] === "string" ? args[args.length - 1] : "doc",
	})),
	arrayRemove: jest.fn((value: string) => `arrayRemove(${value})`),
	arrayUnion: jest.fn((value: string) => `arrayUnion(${value})`),
	getDoc: jest.fn(),
	getDocs: jest.fn(),
	getDocsFromServer: jest.fn(),
	increment: jest.fn(),
	limit: jest.fn(),
	orderBy: jest.fn(),
	query: jest.fn((value: unknown) => value),
	serverTimestamp: jest.fn(() => "server-timestamp"),
	updateDoc: jest.fn(),
	where: jest.fn(),
	writeBatch: jest.fn(),
}));

import {
	getDocs,
	getDocsFromServer,
	updateDoc,
	where,
	writeBatch,
} from "firebase/firestore";
import {
	addToSharedRoots,
	applyLabel,
	moveErrorKey,
	removeLabel,
	reparentNode,
} from "@/data/nodes";

beforeEach(() => {
	jest.clearAllMocks();
});

function aNode(over: Partial<Node> = {}): Node {
	return {
		...newNodeData({ title: "Card", rank: "a0", participantIds: ["me"] }),
		id: "card",
		completedAt: null,
		createdAt: null,
		createdBy: "me",
		updatedAt: null,
		...over,
	};
}

describe("reparentNode refusals", () => {
	it("refuses a move inside the node's own subtree before reading anything", async () => {
		const node = aNode();
		const parent = aNode({ id: "child", ancestorIds: ["root", "card"] });

		await expect(
			reparentNode("home", node, parent, "a0", "me"),
		).rejects.toMatchObject({ code: "move-own-subtree" });
		expect(getDocsFromServer).not.toHaveBeenCalled();
		expect(writeBatch).not.toHaveBeenCalled();
	});

	it("refuses a shared card under a private parent", async () => {
		const node = aNode();
		const parent = aNode({ id: "private", visibility: "private" });

		await expect(
			reparentNode("home", node, parent, "a0", "me"),
		).rejects.toMatchObject({ code: "move-visibility" });
		expect(getDocsFromServer).not.toHaveBeenCalled();
		expect(writeBatch).not.toHaveBeenCalled();
	});

	it("refuses a private card under a shared parent", async () => {
		const node = aNode({ visibility: "private" });
		const parent = aNode({ id: "shared" });

		await expect(
			reparentNode("home", node, parent, "a0", "me"),
		).rejects.toMatchObject({ code: "move-visibility" });
	});

	it("passes a same-visibility move on to the read and the write", async () => {
		jest.mocked(getDocsFromServer).mockResolvedValue({ docs: [] } as never);
		const batch = { update: jest.fn(), commit: jest.fn() };
		jest.mocked(writeBatch).mockReturnValue(batch as never);

		const node = aNode({ parentId: null });
		const parent = aNode({ id: "shared" });

		await reparentNode("home", node, parent, "a1", "me");

		expect(getDocsFromServer).toHaveBeenCalled();
		expect(batch.commit).toHaveBeenCalled();
	});
});

describe("moveErrorKey", () => {
	it.each([
		[{ code: "move-own-subtree" }, "error.moveOwnSubtree"],
		[{ code: "move-visibility" }, "error.moveVisibility"],
		[{ code: "permission-denied" }, "error.saveFailed"],
		[new Error("boom"), "error.saveFailed"],
		[null, "error.saveFailed"],
	])("maps %p to %p", (reason, key) => {
		expect(moveErrorKey(reason)).toBe(key);
	});
});

/** Only what `toNode` reads for this claim. */
function stored(
	id: string,
	participantIds: string[],
): QueryDocumentSnapshot<DocumentData> {
	return {
		id,
		data: () => ({ participantIds }),
	} as unknown as QueryDocumentSnapshot<DocumentData>;
}

function found(
	...documents: QueryDocumentSnapshot<DocumentData>[]
): QuerySnapshot<DocumentData> {
	return { docs: documents } as unknown as QuerySnapshot<DocumentData>;
}

describe("addToSharedRoots", () => {
	it("adds the new member to every shared root that lacks them", async () => {
		jest
			.mocked(getDocs)
			.mockResolvedValueOnce(
				found(stored("apples", ["marcus"]), stored("shed", ["anna"])),
			);

		await addToSharedRoots("home-1", "uid-new");

		expect(updateDoc).toHaveBeenCalledWith(
			{ id: "apples" },
			{ participantIds: ["marcus", "uid-new"], updatedAt: "server-timestamp" },
		);
		expect(updateDoc).toHaveBeenCalledWith(
			{ id: "shed" },
			{ participantIds: ["anna", "uid-new"], updatedAt: "server-timestamp" },
		);
	});

	it("skips a root the uid is already on, so a rerun writes only what is missing", async () => {
		jest
			.mocked(getDocs)
			.mockResolvedValueOnce(
				found(
					stored("apples", ["marcus", "uid-new"]),
					stored("shed", ["anna"]),
				),
			);

		await addToSharedRoots("home-1", "uid-new");

		expect(updateDoc).toHaveBeenCalledTimes(1);
		expect(updateDoc).toHaveBeenCalledWith(
			{ id: "shed" },
			{ participantIds: ["anna", "uid-new"], updatedAt: "server-timestamp" },
		);
	});

	it("reads only the home's shared roots — a private root cannot be matched, so none is written", async () => {
		jest.mocked(getDocs).mockResolvedValueOnce(found());

		await addToSharedRoots("home-1", "uid-new");

		expect(where).toHaveBeenCalledWith("parentId", "==", null);
		expect(where).toHaveBeenCalledWith("visibility", "==", "shared");
		// Archived roots stay in: an archived root a new member is missing is
		// one nothing could ever add them to later (#144, as the #102 migration).
		expect(where).not.toHaveBeenCalledWith("archived", "==", false);
		expect(updateDoc).not.toHaveBeenCalled();
	});

	it("never throws on a root that refuses, and reports it to the console", async () => {
		jest
			.mocked(getDocs)
			.mockResolvedValueOnce(found(stored("apples", ["marcus"])));
		jest
			.mocked(updateDoc)
			.mockReturnValueOnce(Promise.reject(new Error("offline")));
		const consoleError = jest.spyOn(console, "error").mockImplementation();

		await expect(
			addToSharedRoots("home-1", "uid-new"),
		).resolves.toBeUndefined();

		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it("never throws on a listing that fails, and writes nothing", async () => {
		jest.mocked(getDocs).mockRejectedValueOnce(new Error("offline"));
		const consoleError = jest.spyOn(console, "error").mockImplementation();

		await expect(
			addToSharedRoots("home-1", "uid-new"),
		).resolves.toBeUndefined();

		expect(updateDoc).not.toHaveBeenCalled();
		consoleError.mockRestore();
	});
});

describe("the label writes", () => {
	it("applies a label with a transform, not a whole array from a snapshot", async () => {
		// `arrayUnion` is server-side and commutes: a second toggle written
		// before the listener has caught up cannot drop the first one's label,
		// which writing `[...snapshot, id]` from the caller's own copy did.
		await applyLabel("home", "card", "a");

		expect(updateDoc).toHaveBeenCalledWith(
			{ id: "card" },
			{
				labelIds: "arrayUnion(a)",
				updatedAt: "server-timestamp",
			},
		);
	});

	it("removes a label with a transform, leaving the rest to the server", async () => {
		await removeLabel("home", "card", "b");

		expect(updateDoc).toHaveBeenCalledWith(
			{ id: "card" },
			{
				labelIds: "arrayRemove(b)",
				updatedAt: "server-timestamp",
			},
		);
	});
});
