jest.mock("@/config/firebase", () => ({ db: {} }));
jest.mock("firebase/firestore", () => ({
	collection: jest.fn(() => ({})),
	doc: jest.fn((...args: unknown[]) => ({ id: args[args.length - 1] })),
	getDocFromServer: jest.fn(),
	getDoc: jest.fn(() => Promise.resolve({ exists: () => false })),
	getDocsFromServer: jest.fn(),
	query: jest.fn((value: unknown) => value),
	where: jest.fn(),
	serverTimestamp: jest.fn(() => "server-timestamp"),
	increment: jest.fn((value: number) => value),
	updateDoc: jest.fn(),
	writeBatch: jest.fn(),
}));

import {
	getDocFromServer,
	getDocsFromServer,
	updateDoc,
	writeBatch,
} from "firebase/firestore";
import { replayIntent } from "@/data/outbox-replay";
import { newNodeData } from "@/models/node";
import type { Intent } from "@/models/outbox";

const metadata = {
	id: "intent",
	homeId: "home",
	queuedAt: 1,
	title: "Stale title",
	sourceParentId: "stale-parent",
	sourceAncestorIds: ["stale-parent"],
};
const nodeData = newNodeData({
	title: "Fresh card",
	rank: "a0",
	participantIds: ["uid"],
});
function stored(id: string, data = nodeData, exists = true) {
	return { id, ref: { id }, exists: () => exists, data: () => data };
}
const moves: Intent[] = [
	{
		...metadata,
		kind: "moveLocation",
		locationId: "subject",
		parentId: "target",
		rank: "a9",
	},
	{
		...metadata,
		kind: "reparentNode",
		nodeId: "subject",
		parentId: "target",
		rank: "a9",
	},
];
const deletes: Intent[] = [
	{ ...metadata, kind: "deleteLocation", locationId: "subject" },
	{ ...metadata, kind: "deleteNode", nodeId: "subject" },
];
const flip: Intent = {
	...metadata,
	kind: "flipVisibility",
	nodeId: "subject",
	target: "private",
	participantIds: ["uid", "partner"],
};
let batch: { update: jest.Mock; delete: jest.Mock; commit: jest.Mock };
beforeEach(() => {
	jest.mocked(getDocFromServer).mockReset();
	jest
		.mocked(getDocsFromServer)
		.mockReset()
		.mockResolvedValue({ docs: [] } as never);
	batch = {
		update: jest.fn(),
		delete: jest.fn(),
		commit: jest.fn().mockResolvedValue(undefined),
	};
	jest.mocked(writeBatch).mockReturnValue(batch as never);
	jest.mocked(updateDoc).mockResolvedValue(undefined);
});

it.each([...moves, ...deletes, flip])(
	"drops missing subject for $kind without reading a target or writing",
	async (intent) => {
		jest
			.mocked(getDocFromServer)
			.mockResolvedValue(stored("subject", nodeData, false) as never);
		await expect(replayIntent(intent, "uid")).resolves.toBeUndefined();
		expect(getDocFromServer).toHaveBeenCalledTimes(1);
		expect(writeBatch).not.toHaveBeenCalled();
		expect(updateDoc).not.toHaveBeenCalled();
	},
);

it.each(moves)("refuses missing target for $kind", async (intent) => {
	jest
		.mocked(getDocFromServer)
		.mockResolvedValueOnce(stored("subject") as never)
		.mockResolvedValueOnce(stored("target", nodeData, false) as never);
	await expect(replayIntent(intent, "uid")).rejects.toMatchObject({
		code: "target-gone",
	});
	expect(writeBatch).not.toHaveBeenCalled();
});

it.each(moves)("refuses fresh cycle for $kind", async (intent) => {
	jest
		.mocked(getDocFromServer)
		.mockResolvedValueOnce(stored("subject") as never)
		.mockResolvedValueOnce(
			stored("target", {
				...nodeData,
				parentId: "subject",
				ancestorIds: ["subject"],
			}) as never,
		);
	await expect(replayIntent(intent, "uid")).rejects.toMatchObject({
		code: "move-own-subtree",
	});
	expect(getDocsFromServer).not.toHaveBeenCalled();
	expect(writeBatch).not.toHaveBeenCalled();
});

it.each(moves)(
	"drops already-at-target for $kind even when stored rank differs",
	async (intent) => {
		jest
			.mocked(getDocFromServer)
			.mockResolvedValueOnce(
				stored("subject", {
					...nodeData,
					parentId: "target",
					ancestorIds: ["target"],
				}) as never,
			)
			.mockResolvedValueOnce(stored("target") as never);
		await replayIntent(intent, "uid");
		expect(writeBatch).not.toHaveBeenCalled();
		expect(updateDoc).not.toHaveBeenCalled();
	},
);

it("replays merged rank after pending location move already reached destination", async () => {
	jest
		.mocked(getDocFromServer)
		.mockResolvedValueOnce(
			stored("subject", {
				...nodeData,
				parentId: "target",
				ancestorIds: ["target"],
			}) as never,
		)
		.mockResolvedValueOnce(stored("target") as never);
	await replayIntent(
		{ ...moves[0], sourceParentId: "target", sourceAncestorIds: ["target"] },
		"uid",
	);
	expect(updateDoc).toHaveBeenCalledWith(
		{ id: "subject" },
		{ rank: "a9", updatedAt: "server-timestamp" },
	);
	expect(writeBatch).not.toHaveBeenCalled();
});

it.each(moves)(
	"uses fresh hierarchy and stored rank for $kind",
	async (intent) => {
		jest
			.mocked(getDocFromServer)
			.mockResolvedValueOnce(
				stored("subject", {
					...nodeData,
					parentId: "fresh-parent",
					ancestorIds: ["fresh-parent"],
				}) as never,
			)
			.mockResolvedValueOnce(
				stored("target", {
					...nodeData,
					ancestorIds: ["root"],
					parentId: "root",
				}) as never,
			);
		await replayIntent(intent, "uid");
		expect(batch.update).toHaveBeenCalledWith(
			{ id: "subject" },
			expect.objectContaining({
				parentId: "target",
				ancestorIds: ["root", "target"],
				rank: "a9",
			}),
		);
		expect(getDocFromServer).toHaveBeenNthCalledWith(1, { id: "subject" });
		expect(getDocFromServer).toHaveBeenNthCalledWith(2, { id: "target" });
		expect(batch.commit).toHaveBeenCalledTimes(1);
	},
);

it.each(moves)(
	"moves to root without target read for $kind",
	async (intent) => {
		jest.mocked(getDocFromServer).mockResolvedValue(
			stored("subject", {
				...nodeData,
				parentId: "fresh-parent",
				ancestorIds: ["fresh-parent"],
			}) as never,
		);
		await replayIntent({ ...intent, parentId: null } as Intent, "uid");
		expect(getDocFromServer).toHaveBeenCalledTimes(1);
		expect(batch.update).toHaveBeenCalledWith(
			{ id: "subject" },
			expect.objectContaining({ parentId: null, ancestorIds: [] }),
		);
	},
);

it("refuses visibility mismatch read from server", async () => {
	jest
		.mocked(getDocFromServer)
		.mockResolvedValueOnce(stored("subject") as never)
		.mockResolvedValueOnce(
			stored("target", { ...nodeData, visibility: "private" }) as never,
		);
	await expect(replayIntent(moves[1], "uid")).rejects.toMatchObject({
		code: "move-visibility",
	});
	expect(writeBatch).not.toHaveBeenCalled();
});

it.each([...moves, ...deletes])(
	"refuses oversized subtree atomically for $kind",
	async (intent) => {
		jest
			.mocked(getDocFromServer)
			.mockResolvedValueOnce(stored("subject") as never)
			.mockResolvedValueOnce(stored("target") as never);
		jest.mocked(getDocsFromServer).mockResolvedValue({
			docs: Array.from({ length: 500 }, (_, i) =>
				stored(`child-${i}`, {
					...nodeData,
					parentId: "subject",
					ancestorIds: ["subject"],
				}),
			),
		} as never);
		await expect(replayIntent(intent, "uid")).rejects.toMatchObject({
			code: "subtree-too-large",
		});
		expect(writeBatch).not.toHaveBeenCalled();
	},
);

it.each(deletes)(
	"cascades children added since queuing for $kind",
	async (intent) => {
		jest.mocked(getDocFromServer).mockResolvedValue(
			stored("subject", {
				...nodeData,
				parentId: "fresh-parent",
				status: "done",
			}) as never,
		);
		jest.mocked(getDocsFromServer).mockResolvedValue({
			docs: [stored("new-child", { ...nodeData, ancestorIds: ["subject"] })],
		} as never);
		await replayIntent(intent, "uid");
		expect(batch.delete).toHaveBeenCalledWith({ id: "new-child" });
		expect(batch.delete).toHaveBeenCalledWith({ id: "subject" });
		if (intent.kind === "deleteNode")
			expect(batch.update).toHaveBeenCalledWith(
				{ id: "fresh-parent" },
				expect.objectContaining({ childCount: -1, doneCount: -1 }),
			);
	},
);

it("replays flip participants and resumes mixed subtree even when subject is already private", async () => {
	jest.mocked(getDocFromServer).mockResolvedValue(
		stored("subject", {
			...nodeData,
			visibility: "private",
			participantIds: ["uid", "partner"],
		}) as never,
	);
	jest
		.mocked(getDocsFromServer)
		.mockResolvedValueOnce({
			docs: [
				stored("child", {
					...nodeData,
					parentId: "subject",
					ancestorIds: ["subject"],
				}),
			],
		} as never)
		.mockResolvedValueOnce({ docs: [] } as never);
	await replayIntent(flip, "uid");
	expect(updateDoc).toHaveBeenCalledTimes(1);
	expect(updateDoc).toHaveBeenCalledWith(
		{ id: "child" },
		expect.objectContaining({
			visibility: "private",
			participantIds: ["uid", "partner"],
		}),
	);
});

it.each([
	[moves[1], 498, false],
	[moves[1], 499, true],
	[deletes[1], 498, false],
	[deletes[1], 499, true],
] as const)(
	"includes parent counter writes in batch limit for %p with %p descendants",
	async (intent, count, refused) => {
		const parentId = intent.kind === "deleteNode" ? "fresh-parent" : null;
		jest
			.mocked(getDocFromServer)
			.mockResolvedValueOnce(
				stored("subject", { ...nodeData, parentId }) as never,
			)
			.mockResolvedValueOnce(stored("target") as never);
		jest.mocked(getDocsFromServer).mockResolvedValue({
			docs: Array.from({ length: count }, (_, i) =>
				stored(`child-${i}`, { ...nodeData, ancestorIds: ["subject"] }),
			),
		} as never);
		if (refused) {
			await expect(replayIntent(intent, "uid")).rejects.toMatchObject({
				code: "subtree-too-large",
			});
			expect(writeBatch).not.toHaveBeenCalled();
		} else {
			await replayIntent(intent, "uid");
			expect(batch.commit).toHaveBeenCalledTimes(1);
		}
	},
);

it("propagates unavailable during reads and writes unchanged", async () => {
	const reason = { code: "unavailable" };
	jest.mocked(getDocFromServer).mockRejectedValueOnce(reason);
	await expect(replayIntent(deletes[0], "uid")).rejects.toBe(reason);
	jest.mocked(getDocFromServer).mockResolvedValue(stored("subject") as never);
	batch.commit.mockRejectedValueOnce(reason);
	await expect(replayIntent(deletes[0], "uid")).rejects.toBe(reason);
});
