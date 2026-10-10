import type {
	DocumentData,
	QueryDocumentSnapshot,
	QuerySnapshot,
} from "firebase/firestore";
import type { Node } from "@/models/node";
import { newNodeData } from "@/models/node";

jest.mock("@/config/firebase", () => ({ db: {} }));

jest.mock("@/models/overview", () => ({
	doneSince: jest.fn((_now: Date, days: number) => `doneSince(${days})`),
	doneFetchLimit: 100,
}));

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
	increment,
	limit,
	updateDoc,
	where,
	writeBatch,
} from "firebase/firestore";
import {
	addToSharedRoots,
	applyLabel,
	isUnavailable,
	moveErrorKey,
	moveNodes,
	participatingDoneQuery,
	removeLabel,
	reparentNode,
	sharedDoneQuery,
} from "@/data/nodes";
import { doneFetchLimit, doneSince } from "@/models/overview";

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

describe("moveNodes", () => {
	const batch = { update: jest.fn(), commit: jest.fn() };
	const cards = ["first", "second", "third"].map((id, index) =>
		aNode({ id, parentId: "project", status: "backlog", rank: `a${index}` }),
	);

	beforeEach(() => {
		jest.mocked(writeBatch).mockReturnValue(batch as never);
		jest
			.mocked(increment)
			.mockImplementation((value) => `increment(${value})` as never);
		batch.commit.mockResolvedValue(undefined);
	});

	it("completes three cards in one batch and increments their parent once", async () => {
		await moveNodes(
			"home",
			cards.map((node, index) => ({ node, status: "done", rank: `b${index}` })),
		);

		expect(writeBatch).toHaveBeenCalledTimes(1);
		expect(batch.commit).toHaveBeenCalledTimes(1);
		expect(batch.update).toHaveBeenCalledTimes(4);
		for (const [index, node] of cards.entries()) {
			expect(batch.update).toHaveBeenCalledWith(
				{ id: node.id },
				{
					status: "done",
					rank: `b${index}`,
					completedAt: "server-timestamp",
					updatedAt: "server-timestamp",
				},
			);
		}
		expect(batch.update).toHaveBeenCalledWith(
			{ id: "project" },
			{ doneCount: "increment(3)" },
		);
		expect(increment).toHaveBeenCalledTimes(1);
		expect(updateDoc).not.toHaveBeenCalled();
		expect(getDocsFromServer).not.toHaveBeenCalled();
	});

	it("clears completion dates and decrements once when leaving Done", async () => {
		await moveNodes(
			"home",
			cards.map((node) => ({
				node: { ...node, status: "done" },
				status: "execution",
				rank: node.rank,
			})),
		);

		for (const node of cards) {
			expect(batch.update).toHaveBeenCalledWith(
				{ id: node.id },
				{
					status: "execution",
					rank: node.rank,
					completedAt: null,
					updatedAt: "server-timestamp",
				},
			);
		}
		expect(batch.update).toHaveBeenCalledWith(
			{ id: "project" },
			{ doneCount: "increment(-3)" },
		);
		expect(increment).toHaveBeenCalledTimes(1);
	});

	it("undo restores each old status and rank and reverses the parent count", async () => {
		const originals = cards.map((node, index) => ({
			...node,
			status: index === 0 ? ("execution" as const) : ("backlog" as const),
		}));
		await moveNodes(
			"home",
			originals.map((node, index) => ({
				node,
				status: "done",
				rank: `b${index}`,
			})),
		);
		batch.update.mockClear();

		await moveNodes(
			"home",
			originals.map((node, index) => ({
				node: { ...node, status: "done", rank: `b${index}` },
				status: node.status,
				rank: node.rank,
			})),
		);

		for (const node of originals) {
			expect(batch.update).toHaveBeenCalledWith(
				{ id: node.id },
				{
					status: node.status,
					rank: node.rank,
					completedAt: null,
					updatedAt: "server-timestamp",
				},
			);
		}
		expect(jest.mocked(increment).mock.calls).toEqual([[3], [-3]]);
		expect(batch.update).toHaveBeenCalledWith(
			{ id: "project" },
			{ doneCount: "increment(-3)" },
		);
	});

	it("folds counters per parent, skips zero totals and roots, and preserves dates on reorders", async () => {
		await moveNodes("home", [
			{ node: cards[0], status: "done", rank: "b0" },
			{ node: { ...cards[1], status: "done" }, status: "next_up", rank: "b1" },
			{ node: { ...cards[2], parentId: "other" }, status: "done", rank: "b2" },
			{ node: aNode({ id: "root" }), status: "done", rank: "b3" },
			{
				node: aNode({ id: "completed", parentId: "other", status: "done" }),
				status: "done",
				rank: "b4",
			},
		]);

		expect(batch.update).toHaveBeenCalledTimes(6);
		expect(batch.update).toHaveBeenCalledWith(
			{ id: "other" },
			{ doneCount: "increment(1)" },
		);
		expect(batch.update).not.toHaveBeenCalledWith(
			{ id: "project" },
			expect.anything(),
		);
		expect(batch.update).toHaveBeenCalledWith(
			{ id: "completed" },
			{ status: "done", rank: "b4", updatedAt: "server-timestamp" },
		);
		expect(increment).toHaveBeenCalledTimes(1);
	});

	it("keeps the existing single-card update path", async () => {
		await moveNodes("home", [
			{ node: cards[0], status: "next_up", rank: "b0" },
		]);

		expect(writeBatch).not.toHaveBeenCalled();
		expect(updateDoc).toHaveBeenCalledWith(
			{ id: "first" },
			{ status: "next_up", rank: "b0", updatedAt: "server-timestamp" },
		);
	});

	it("writes nothing for an empty selection", async () => {
		await moveNodes("home", []);
		expect(writeBatch).not.toHaveBeenCalled();
		expect(updateDoc).not.toHaveBeenCalled();
	});

	it("returns the batch acknowledgement and propagates refusal", async () => {
		const reason = new Error("permission-denied");
		batch.commit.mockRejectedValueOnce(reason);
		await expect(
			moveNodes(
				"home",
				cards.map((node) => ({ node, status: "done", rank: node.rank })),
			),
		).rejects.toBe(reason);
	});
});

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
		[{ code: "target-gone" }, "error.targetGone"],
		[{ code: "subtree-too-large" }, "error.subtreeTooLarge"],
		[{ code: "permission-denied" }, "error.saveFailed"],
		[new Error("boom"), "error.saveFailed"],
		[null, "error.saveFailed"],
	])("maps %p to %p", (reason, key) => {
		expect(moveErrorKey(reason)).toBe(key);
	});
});

it("recognizes unavailable without treating permission failures as network failures", () => {
	expect(isUnavailable({ code: "unavailable" })).toBe(true);
	expect(isUnavailable({ code: "permission-denied" })).toBe(false);
	expect(isUnavailable(null)).toBe(false);
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

describe("the done queries", () => {
	it("bounds the fetch at the fetch limit and asks the window it is given", () => {
		sharedDoneQuery("home-1", 365);

		expect(jest.mocked(limit)).toHaveBeenLastCalledWith(doneFetchLimit);
		expect(jest.mocked(doneSince)).toHaveBeenLastCalledWith(
			expect.any(Date),
			365,
		);
	});

	it("carries the window through the participating arm unchanged", () => {
		participatingDoneQuery("home-1", "uid-me", 90);

		expect(jest.mocked(doneSince)).toHaveBeenLastCalledWith(
			expect.any(Date),
			90,
		);
		expect(jest.mocked(limit)).toHaveBeenLastCalledWith(doneFetchLimit);
	});
});
