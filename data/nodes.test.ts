import type { Node } from "@/models/node";
import { newNodeData } from "@/models/node";

jest.mock("@/config/firebase", () => ({ db: {} }));

jest.mock("firebase/firestore", () => ({
	collection: jest.fn(() => ({})),
	doc: jest.fn(() => ({ id: "doc" })),
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

import { getDocsFromServer, writeBatch } from "firebase/firestore";
import { moveErrorKey, reparentNode } from "@/data/nodes";

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
