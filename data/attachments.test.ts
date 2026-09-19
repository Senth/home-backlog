import type { Attachment, Node } from "@/models/node";
import { newNodeData } from "@/models/node";

jest.mock("@/config/firebase", () => ({ db: {}, storage: {} }));

jest.mock("firebase/firestore", () => ({
	arrayRemove: jest.fn((value: unknown) => ({ __op: "arrayRemove", value })),
	arrayUnion: jest.fn((value: unknown) => ({ __op: "arrayUnion", value })),
	collection: jest.fn(() => ({})),
	doc: jest.fn(() => ({ id: "ref" })),
	getDoc: jest.fn(async () => ({ get: () => 0 })),
	increment: jest.fn((by: number) => ({ __op: "increment", by })),
	query: jest.fn((value: unknown) => value),
	runTransaction: jest.fn(),
	serverTimestamp: jest.fn(() => "server-timestamp"),
	Timestamp: { fromDate: jest.fn(() => "timestamp") },
	updateDoc: jest.fn(),
	where: jest.fn(),
}));

jest.mock("firebase/storage", () => ({
	deleteObject: jest.fn(async () => undefined),
	ref: jest.fn((_storage: unknown, path: string) => ({ path })),
	uploadBytes: jest.fn(async () => undefined),
}));

jest.mock("@/utils/downscale", () => ({
	downscaleImage: jest.fn(async () => new Blob([new ArrayBuffer(400)])),
}));

import { deleteAttachment, uploadAttachment } from "@/data/attachments";
import { homeAttachmentCeiling } from "@/models/attachment";

const { arrayUnion, updateDoc } = jest.requireMock("firebase/firestore") as {
	arrayUnion: jest.Mock;
	updateDoc: jest.Mock;
};
const { uploadBytes, deleteObject } = jest.requireMock("firebase/storage") as {
	uploadBytes: jest.Mock;
	deleteObject: jest.Mock;
};

beforeEach(() => {
	jest.clearAllMocks();
});

const oneMb = 1024 * 1024;
const photoBytes = 3 * oneMb;
const ceiling = 20 * oneMb;
const documentBytes = 123;

function aFile(over: Record<string, unknown> = {}) {
	return {
		name: "badrum.jpg",
		contentType: "image/jpeg",
		size: photoBytes,
		blob: { size: photoBytes } as unknown as Blob,
		...over,
	};
}

function anAttachment(over: Partial<Attachment> = {}): Attachment {
	return {
		id: "att-1",
		path: "homes/home/nodes/node/att-1",
		name: "badrum.jpg",
		contentType: "image/jpeg",
		size: oneMb,
		uploadedAt: null,
		uploadedBy: "me",
		...over,
	};
}

describe("uploadAttachment refusals", () => {
	it("refuses an unknown type before anything is sent", async () => {
		await expect(
			uploadAttachment(
				"home",
				"node",
				"me",
				aFile({ contentType: "application/zip" }),
			),
		).rejects.toMatchObject({ code: "attachment-type" });
		expect(uploadBytes).not.toHaveBeenCalled();
		expect(updateDoc).not.toHaveBeenCalled();
	});

	it("refuses at the ceiling before anything is sent", async () => {
		await expect(
			uploadAttachment("home", "node", "me", aFile({ size: ceiling })),
		).rejects.toMatchObject({ code: "attachment-too-large" });
		expect(uploadBytes).not.toHaveBeenCalled();
		expect(updateDoc).not.toHaveBeenCalled();
	});

	it("refuses at the home's byte ceiling before anything is sent", async () => {
		// The counter is the number the Storage triggers own; the client reads
		// it only to refuse with a sentence instead of a bare `unauthorized`.
		const { getDoc } = jest.requireMock("firebase/firestore") as {
			getDoc: jest.Mock;
		};
		getDoc.mockResolvedValueOnce({
			get: (field: string) =>
				field === "attachmentBytes" ? homeAttachmentCeiling : 0,
		});

		await expect(
			uploadAttachment("home", "node", "me", aFile()),
		).rejects.toMatchObject({ code: "attachment-quota" });
		expect(uploadBytes).not.toHaveBeenCalled();
		expect(updateDoc).not.toHaveBeenCalled();
	});
});

describe("uploadAttachment, image", () => {
	it("uploads the stored object, then its thumbnail, then the entry", async () => {
		await uploadAttachment("home", "node", "me", aFile());

		// The stored object goes first: a failure halfway leaves a missing
		// preview, never an orphaned thumbnail the counter has counted.
		expect(uploadBytes).toHaveBeenCalledTimes(2);
		const [mainRef, , mainMeta] = uploadBytes.mock.calls[0];
		const [thumbRef, thumbBlob, thumbMeta] = uploadBytes.mock.calls[1];
		const mainPath = (mainRef as { path: string }).path;
		expect(mainPath).toMatch(/^homes\/home\/nodes\/node\/[0-9a-f-]{36}$/);
		expect((thumbRef as { path: string }).path).toBe(`${mainPath}_thumb.jpg`);
		expect(mainMeta).toMatchObject({
			contentType: "image/jpeg",
			customMetadata: { uploadedBy: "me" },
		});
		expect(thumbMeta).toMatchObject({ contentType: "image/jpeg" });
		expect(thumbBlob.size).toBe(400);

		const changes = updateDoc.mock.calls[0][1] as Record<string, unknown>;
		const entry = arrayUnion.mock.calls[0][0] as Attachment;
		expect(changes.attachmentCount).toEqual({ __op: "increment", by: 1 });
		expect(changes.updatedAt).toBe("server-timestamp");
		expect(entry.contentType).toBe("image/jpeg");
		expect(entry.size).toBe(400);
		expect(entry.uploadedBy).toBe("me");
		expect(entry.name).toBe("badrum.jpg");
	});
});

describe("uploadAttachment, not an image", () => {
	it("uploads the bytes as they are, once", async () => {
		await uploadAttachment(
			"home",
			"node",
			"me",
			aFile({
				name: "pannor.txt",
				contentType: "text/plain",
				blob: { size: documentBytes } as unknown as Blob,
			}),
		);

		expect(uploadBytes).toHaveBeenCalledTimes(1);
		const entry = arrayUnion.mock.calls[0][0] as Attachment;
		expect(entry.contentType).toBe("text/plain");
		expect(entry.size).toBe(documentBytes);
	});
});

const heicBytes = 2 * oneMb;

describe("uploadAttachment, a browser that cannot decode the photo", () => {
	it("keeps the original HEIC bytes rather than losing the photo", async () => {
		const { downscaleImage } = jest.requireMock("@/utils/downscale") as {
			downscaleImage: jest.Mock;
		};
		downscaleImage.mockRejectedValueOnce(
			Object.assign(new Error("no such codec"), { code: "image-decode" }),
		);

		const original = { size: heicBytes } as unknown as Blob;
		await uploadAttachment(
			"home",
			"node",
			"me",
			aFile({ name: "badrum.heic", contentType: "image/heic", blob: original }),
		);

		expect(uploadBytes).toHaveBeenCalledTimes(1);
		const [reference, blob, meta] = uploadBytes.mock.calls[0];
		expect((reference as { path: string }).path).toMatch(
			/^homes\/home\/nodes\/node\/[0-9a-f-]{36}$/,
		);
		expect(meta).toMatchObject({ contentType: "image/heic" });
		const entry = arrayUnion.mock.calls[0][0] as Attachment;
		expect(entry.size).toBe(heicBytes);
		expect(blob).toBe(original);
	});
});

describe("uploadAttachment, the entry write failing", () => {
	it("rolls the bytes back off the counter, then rethrows", async () => {
		updateDoc.mockRejectedValueOnce({ code: "permission-denied" });

		await expect(
			uploadAttachment("home", "node", "me", aFile()),
		).rejects.toMatchObject({ code: "permission-denied" });

		const paths = deleteObject.mock.calls.map(
			([reference]) => (reference as { path: string }).path,
		);
		expect(paths).toHaveLength(2);
		expect(paths[0]).not.toMatch(/_thumb\.jpg$/);
		expect(paths[1]).toMatch(/_thumb\.jpg$/);
	});
});

describe("deleteAttachment", () => {
	function aNodeWith(attachments: Attachment[]): Node {
		return {
			...newNodeData({ title: "Kort", rank: "a0", participantIds: ["me"] }),
			id: "node",
			completedAt: null,
			createdAt: null,
			createdBy: "me",
			updatedAt: null,
			attachments,
			attachmentCount: attachments.length,
		};
	}

	/** A transaction over one stored node; returns the update it was asked to write. */
	function txFor(node: Node | null): jest.Mock {
		const update = jest.fn();
		(
			jest.requireMock("firebase/firestore") as { runTransaction: jest.Mock }
		).runTransaction.mockImplementation(
			async (_db: unknown, fn: (transaction: unknown) => Promise<void>) =>
				fn({
					get: jest.fn(
						async (): Promise<{
							exists: () => boolean;
							id?: string;
							data?: () => Record<string, unknown>;
						}> =>
							node === null
								? { exists: () => false }
								: {
										exists: () => true,
										id: node.id,
										data: () => ({ ...node }),
									},
					),
					update,
				}),
		);
		return update;
	}

	it("removes the entry and recomputes the count from the array", async () => {
		const other = anAttachment({
			id: "att-2",
			path: "homes/home/nodes/node/att-2",
		});
		const update = txFor(aNodeWith([anAttachment(), other]));
		await deleteAttachment("home", "node", anAttachment());

		expect(update).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				attachments: [other],
				attachmentCount: 1,
			}),
		);

		const paths = deleteObject.mock.calls.map(
			([reference]) => (reference as { path: string }).path,
		);
		expect(paths).toEqual([
			"homes/home/nodes/node/att-1",
			"homes/home/nodes/node/att-1_thumb.jpg",
		]);
	});

	it("a second delete of the same entry writes nothing", async () => {
		const update = txFor(aNodeWith([]));
		await deleteAttachment("home", "node", anAttachment());

		expect(update).not.toHaveBeenCalled();
		expect(deleteObject).toHaveBeenCalledTimes(2);
	});

	it("a card already gone counts nothing to remove, and its bytes still drop", async () => {
		const update = txFor(null);
		await deleteAttachment("home", "node", anAttachment());

		expect(update).not.toHaveBeenCalled();
		expect(deleteObject).toHaveBeenCalledTimes(2);
	});

	it("takes a document's bytes in one delete", async () => {
		txFor(
			aNodeWith([
				anAttachment({ name: "pannor.txt", contentType: "text/plain" }),
			]),
		);
		await deleteAttachment(
			"home",
			"node",
			anAttachment({ name: "pannor.txt", contentType: "text/plain" }),
		);

		expect(deleteObject).toHaveBeenCalledTimes(1);
	});

	it("treats an object already gone as the outcome it wanted", async () => {
		deleteObject.mockRejectedValueOnce({ code: "storage/object-not-found" });
		await expect(
			deleteAttachment("home", "node", anAttachment()),
		).resolves.toBeUndefined();

		deleteObject.mockRejectedValueOnce({ code: "storage/unauthorized" });
		await expect(
			deleteAttachment("home", "node", anAttachment()),
		).rejects.toMatchObject({ code: "storage/unauthorized" });
	});
});
