import type { Attachment, Node } from "@/models/node";
import { newNodeData } from "@/models/node";

jest.mock("@/config/firebase", () => ({
	db: {},
	storage: {},
}));

jest.mock("firebase/firestore", () => ({
	arrayRemove: jest.fn((value: unknown) => ({ __op: "arrayRemove", value })),
	arrayUnion: jest.fn((value: unknown) => ({ __op: "arrayUnion", value })),
	collection: jest.fn(() => ({})),
	doc: jest.fn(() => ({ id: "ref" })),
	getDoc: jest.fn(async () => ({ get: () => 0 })),
	onSnapshot: jest.fn((_ref, _options, next) => {
		void Promise.resolve().then(() =>
			next({
				get: () => [
					jest
						.requireMock("firebase/firestore")
						.arrayUnion.mock.calls.at(-1)[0],
				],
			}),
		);
		return jest.fn();
	}),
	increment: jest.fn((by: number) => ({ __op: "increment", by })),
	query: jest.fn((value: unknown) => value),
	runTransaction: jest.fn(),
	serverTimestamp: jest.fn(() => "server-timestamp"),
	Timestamp: { fromDate: jest.fn(() => "timestamp") },
	updateDoc: jest.fn(async () => undefined),
	where: jest.fn(),
}));

jest.mock("firebase/storage", () => ({
	deleteObject: jest.fn(async () => undefined),
	ref: jest.fn((_storage: unknown, path: string) => ({ path })),
	uploadBytesResumable: jest.fn(() =>
		Object.assign(Promise.resolve(), {
			on: jest.fn(() => jest.fn()),
			cancel: jest.fn(),
		}),
	),
}));

jest.mock("@/utils/downscale", () => ({
	downscaleImage: jest.fn(async () => new Blob([new ArrayBuffer(400)])),
}));

import {
	deleteAttachment,
	readHomeAttachmentBytes,
	uploadAttachment,
} from "@/data/attachments";
import { homeAttachmentCeiling } from "@/models/attachment";

const { arrayUnion, updateDoc } = jest.requireMock("firebase/firestore") as {
	arrayUnion: jest.Mock;
	updateDoc: jest.Mock;
};
const { uploadBytesResumable, deleteObject } = jest.requireMock(
	"firebase/storage",
) as {
	uploadBytesResumable: jest.Mock;
	deleteObject: jest.Mock;
};

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
	it("reads the home quota once and reuses a supplied batch snapshot", async () => {
		const { getDoc } = jest.requireMock("firebase/firestore") as {
			getDoc: jest.Mock;
		};
		getDoc.mockResolvedValueOnce({ get: () => documentBytes });
		await expect(readHomeAttachmentBytes("home")).resolves.toBe(documentBytes);
		expect(getDoc).toHaveBeenCalledTimes(1);
		getDoc.mockClear();

		await uploadAttachment(
			"home",
			"node",
			"me",
			aFile(),
			undefined,
			undefined,
			0,
		);
		expect(getDoc).not.toHaveBeenCalled();
	});

	it("refuses an unknown type before anything is sent", async () => {
		await expect(
			uploadAttachment(
				"home",
				"node",
				"me",
				aFile({ contentType: "application/zip" }),
			),
		).rejects.toMatchObject({ code: "attachment-type" });
		expect(uploadBytesResumable).not.toHaveBeenCalled();
		expect(updateDoc).not.toHaveBeenCalled();
	});

	it("refuses at the ceiling before anything is sent", async () => {
		await expect(
			uploadAttachment("home", "node", "me", aFile({ size: ceiling })),
		).rejects.toMatchObject({ code: "attachment-too-large" });
		expect(uploadBytesResumable).not.toHaveBeenCalled();
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
		expect(uploadBytesResumable).not.toHaveBeenCalled();
		expect(updateDoc).not.toHaveBeenCalled();
	});
});

describe("uploadAttachment, image", () => {
	it("uploads the stored object, then its thumbnail, then the entry", async () => {
		await uploadAttachment("home", "node", "me", aFile());

		// The stored object goes first: a failure halfway leaves a missing
		// preview, never an orphaned thumbnail the counter has counted.
		expect(uploadBytesResumable).toHaveBeenCalledTimes(2);
		const [mainRef, , mainMeta] = uploadBytesResumable.mock.calls[0];
		const [thumbRef, thumbBlob, thumbMeta] = uploadBytesResumable.mock.calls[1];
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
		expect(entry.hasThumbnail).toBe(true);
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

		expect(uploadBytesResumable).toHaveBeenCalledTimes(1);
		const entry = arrayUnion.mock.calls[0][0] as Attachment;
		expect(entry.contentType).toBe("text/plain");
		expect(entry.size).toBe(documentBytes);
	});
});

const heicBytes = 2 * oneMb;

describe("uploadAttachment, a browser that cannot decode the photo", () => {
	it.each(["image/heic", "image/jpeg"])(
		"keeps undecodable %s bytes without claiming a thumbnail",
		async (contentType) => {
			const { downscaleImage } = jest.requireMock("@/utils/downscale") as {
				downscaleImage: jest.Mock;
			};
			downscaleImage.mockRejectedValueOnce(
				Object.assign(new Error("no such codec"), { code: "image-decode" }),
			);

			const slice = jest.fn(() => ({
				arrayBuffer: jest.fn(async () => new ArrayBuffer(1)),
			}));
			const original = { size: heicBytes, slice } as unknown as Blob;
			await uploadAttachment(
				"home",
				"node",
				"me",
				aFile({ contentType, blob: original }),
			);

			expect(slice).toHaveBeenCalledWith(0, 1);
			expect(uploadBytesResumable).toHaveBeenCalledTimes(1);
			const [reference, blob, meta] = uploadBytesResumable.mock.calls[0];
			expect((reference as { path: string }).path).toMatch(
				/^homes\/home\/nodes\/node\/[0-9a-f-]{36}$/,
			);
			expect(meta).toMatchObject({ contentType });
			const entry = arrayUnion.mock.calls[0][0] as Attachment;
			expect(entry.hasThumbnail).toBe(false);
			expect(entry.size).toBe(heicBytes);
			expect(blob).toBe(original);
		},
	);

	it("refuses an undecodable photo when its original bytes cannot be read", async () => {
		const { downscaleImage } = jest.requireMock("@/utils/downscale") as {
			downscaleImage: jest.Mock;
		};
		downscaleImage.mockRejectedValueOnce(
			Object.assign(new Error("no such codec"), { code: "image-decode" }),
		);
		const read = jest.fn().mockRejectedValue(new Error("read failed"));
		const slice = jest.fn(() => ({ arrayBuffer: read }));

		await expect(
			uploadAttachment(
				"home",
				"node",
				"me",
				aFile({ blob: { size: heicBytes, slice } as unknown as Blob }),
			),
		).rejects.toMatchObject({ code: "attachment-unreadable" });

		expect(slice).toHaveBeenCalledWith(0, 1);
		expect(read).toHaveBeenCalledTimes(1);
		expect(uploadBytesResumable).not.toHaveBeenCalled();
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

	it.each(["original", "thumbnail"])(
		"rolls back only completed objects when the %s upload fails",
		async (step) => {
			if (step === "thumbnail")
				uploadBytesResumable.mockReturnValueOnce(
					Object.assign(Promise.resolve(), {
						on: jest.fn(() => jest.fn()),
						cancel: jest.fn(),
					}),
				);
			uploadBytesResumable.mockReturnValueOnce(
				Object.assign(Promise.reject({ code: "storage/unauthorized" }), {
					on: jest.fn(() => jest.fn()),
					cancel: jest.fn(),
				}),
			);
			await expect(
				uploadAttachment("home", "node", "me", aFile()),
			).rejects.toMatchObject({ code: "storage/unauthorized" });
			expect(updateDoc).not.toHaveBeenCalled();
			expect(deleteObject).toHaveBeenCalledTimes(step === "thumbnail" ? 1 : 0);
			if (step === "thumbnail")
				expect(deleteObject).toHaveBeenCalledWith(
					uploadBytesResumable.mock.calls[0][0],
				);
		},
	);
});

describe("uploadAttachment, stalled steps", () => {
	let log: jest.SpyInstance;
	beforeEach(() => {
		jest.useFakeTimers();
		log = jest.spyOn(console, "info").mockImplementation();
	});
	afterEach(() => {
		expect(jest.getTimerCount()).toBe(0);
		jest.useRealTimers();
		log.mockRestore();
	});

	it.each(["quota", "original", "thumbnail"])(
		"bounds a stalled %s step to 15 seconds",
		async (step) => {
			const never = new Promise(() => {});
			if (step === "quota")
				jest
					.requireMock("firebase/firestore")
					.getDoc.mockReturnValueOnce(never);
			else {
				const { downscaleImage } = jest.requireMock("@/utils/downscale");
				if (step === "thumbnail")
					downscaleImage.mockResolvedValueOnce(new Blob(["jpeg"]));
				downscaleImage.mockReturnValueOnce(never);
			}
			const result = expect(
				uploadAttachment("home", "node", "me", aFile()),
			).rejects.toMatchObject({ code: "attachment-stalled" });
			await jest.advanceTimersByTimeAsync(15_000);
			await result;
			expect(log).toHaveBeenCalledWith(`[upload] stalled at ${step}`);
			expect(updateDoc).not.toHaveBeenCalled();
			expect(deleteObject).toHaveBeenCalledTimes(step === "thumbnail" ? 1 : 0);
		},
	);

	it.each(["original", "thumbnail"])(
		"cancels %s upload after 30 seconds without bytes moving, even with duplicate snapshots",
		async (step) => {
			const { downscaleImage } = jest.requireMock("@/utils/downscale");
			if (step === "thumbnail")
				downscaleImage.mockResolvedValueOnce(new Blob(["jpeg"]));
			downscaleImage.mockResolvedValueOnce(new Blob([new ArrayBuffer(oneMb)]));
			let next!: (snapshot: {
				bytesTransferred: number;
				totalBytes: number;
			}) => void;
			let reject!: (reason: unknown) => void;
			const completion = new Promise((_resolve, fail) => {
				reject = fail;
			});
			const cancel = jest.fn(() => reject({ code: "storage/canceled" }));
			const unsubscribe = jest.fn();
			if (step === "thumbnail")
				uploadBytesResumable.mockReturnValueOnce(
					Object.assign(Promise.resolve(), {
						on: jest.fn(() => jest.fn()),
						cancel: jest.fn(),
					}),
				);
			uploadBytesResumable.mockReturnValueOnce(
				Object.assign(completion, {
					on: jest.fn((_event, callback) => {
						next = callback;
						return unsubscribe;
					}),
					cancel,
				}),
			);
			const result = expect(
				uploadAttachment("home", "node", "me", aFile()),
			).rejects.toMatchObject({ code: "attachment-stalled" });
			await jest.advanceTimersByTimeAsync(29_000);
			next({ bytesTransferred: 0, totalBytes: 400 });
			await jest.advanceTimersByTimeAsync(1_000);
			await result;
			expect(cancel).toHaveBeenCalledTimes(1);
			expect(unsubscribe).toHaveBeenCalledTimes(1);
			expect(log).toHaveBeenCalledWith(`[upload] stalled at ${step} upload`);
			expect(deleteObject).toHaveBeenCalledTimes(step === "thumbnail" ? 1 : 0);
			if (step === "thumbnail") {
				expect(deleteObject).toHaveBeenCalledWith(
					uploadBytesResumable.mock.calls[0][0],
				);
			}
		},
	);

	it("keeps uploading while bytes move and reports preparing then byte progress", async () => {
		let next!: (snapshot: {
			bytesTransferred: number;
			totalBytes: number;
		}) => void;
		let finish!: () => void;
		const completion = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const cancel = jest.fn();
		uploadBytesResumable.mockReturnValueOnce(
			Object.assign(completion, {
				on: jest.fn((_event, callback) => {
					next = callback;
					return jest.fn();
				}),
				cancel,
			}),
		);
		const onProgress = jest.fn();
		const upload = uploadAttachment(
			"home",
			"node",
			"me",
			aFile({ contentType: "text/plain" }),
			onProgress,
		);
		for (const bytesTransferred of [100, 200, 300, 400]) {
			await jest.advanceTimersByTimeAsync(29_000);
			next({ bytesTransferred, totalBytes: 400 });
		}
		finish();
		await upload;
		expect(cancel).not.toHaveBeenCalled();
		expect(log).not.toHaveBeenCalled();
		expect(onProgress.mock.calls[0]).toEqual([{ phase: "preparing" }]);
		expect(onProgress).toHaveBeenCalledWith({
			phase: "uploading",
			bytesTransferred: 300,
			totalBytes: 400,
		});
	});

	it("resets inactivity when retry bytes increase below the previous peak", async () => {
		let next!: (snapshot: {
			bytesTransferred: number;
			totalBytes: number;
		}) => void;
		let finish!: () => void;
		const completion = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const cancel = jest.fn();
		uploadBytesResumable.mockReturnValueOnce(
			Object.assign(completion, {
				on: jest.fn((_event, callback) => {
					next = callback;
					return jest.fn();
				}),
				cancel,
			}),
		);
		const landed = jest.fn();
		const failed = jest.fn();
		const upload = uploadAttachment(
			"home",
			"node",
			"me",
			aFile({ contentType: "text/plain" }),
		).then(landed, failed);
		await jest.advanceTimersByTimeAsync(10_000);
		next({ bytesTransferred: 300, totalBytes: 400 });
		await jest.advanceTimersByTimeAsync(10_000);
		next({ bytesTransferred: 0, totalBytes: 400 });
		await jest.advanceTimersByTimeAsync(10_000);
		next({ bytesTransferred: 100, totalBytes: 400 });
		await jest.advanceTimersByTimeAsync(20_000);
		finish();
		await upload;
		expect(failed).not.toHaveBeenCalled();
		expect(landed).toHaveBeenCalledTimes(1);
		expect(cancel).not.toHaveBeenCalled();
	});

	it.each(["pending", "late rejection"])(
		"refuses a stalled upload without waiting for rollback: %s",
		async (cleanup) => {
			let rejectCleanup!: (reason: unknown) => void;
			deleteObject.mockReturnValueOnce(
				new Promise((_resolve, reject) => {
					rejectCleanup = reject;
				}),
			);
			uploadBytesResumable.mockReturnValueOnce(
				Object.assign(Promise.resolve(), {
					on: jest.fn(() => jest.fn()),
					cancel: jest.fn(),
				}),
			);
			uploadBytesResumable.mockReturnValueOnce(
				Object.assign(new Promise(() => {}), {
					on: jest.fn(() => jest.fn()),
					cancel: jest.fn(),
				}),
			);
			const failed = jest.fn();
			const upload = uploadAttachment("home", "node", "me", aFile()).catch(
				failed,
			);
			await jest.advanceTimersByTimeAsync(30_000);
			expect(failed).toHaveBeenCalledWith(
				expect.objectContaining({ code: "attachment-stalled" }),
			);
			if (cleanup === "late rejection")
				rejectCleanup(new Error("cleanup failed"));
			await upload;
			expect(deleteObject).toHaveBeenCalledTimes(1);
		},
	);

	it.each(
		[400, 128 * 1024, 256 * 1024, 256 * 1024 + 1].flatMap((byteCount) =>
			["moving", "stalled", "stops"].map((behavior) => ({
				byteCount,
				behavior,
			})),
		),
	)(
		"bounds a $byteCount-byte upload by inactivity using the actual Firebase SDK ($behavior)",
		async ({ byteCount, behavior }) => {
			const sdk =
				jest.requireActual<typeof import("firebase/storage")>(
					"firebase/storage",
				);
			const { initializeApp, deleteApp } =
				jest.requireActual<typeof import("firebase/app")>("firebase/app");
			const app = initializeApp(
				{ storageBucket: "demo-uploads.appspot.com" },
				crypto.randomUUID(),
			);
			const sdkStorage = sdk.getStorage(app);
			let finish = () => {};
			let finishing = false;
			let progress!: (loaded: number, total: number) => void;
			const cancel = jest.fn();
			const request = jest
				.spyOn(
					sdkStorage as typeof sdkStorage & { _makeRequest: () => unknown },
					"_makeRequest",
				)
				.mockImplementation((...args: unknown[]) => {
					const info = args[0] as {
						headers: Record<string, string>;
						body: Uint8Array;
						progressCallback: typeof progress;
					};
					if (info.headers["X-Goog-Upload-Command"] === "start")
						return {
							getPromise: () => Promise.resolve("https://uploads.test/session"),
							cancel,
						};
					progress = info.progressCallback;
					const current =
						Number(info.headers["X-Goog-Upload-Offset"]) + info.body.byteLength;
					const completion = new Promise((resolve, reject) => {
						finish = () =>
							resolve({
								current,
								total: byteCount,
								finalized: current === byteCount,
								metadata: { fullPath: "file.txt" },
							});
						cancel.mockImplementation(() =>
							reject(
								new sdk.StorageError(sdk.StorageErrorCode.CANCELED, "canceled"),
							),
						);
					});
					if (finishing) finish();
					return { getPromise: () => completion, cancel };
				});
			uploadBytesResumable.mockImplementationOnce(
				(_reference, _bytes, metadata) =>
					sdk.uploadBytesResumable(
						sdk.ref(sdkStorage, "file.txt"),
						new Uint8Array(byteCount),
						metadata,
					),
			);
			const failed = jest.fn();
			const landed = jest.fn();
			const onProgress = jest.fn();
			const upload = uploadAttachment(
				"home",
				"node",
				"me",
				aFile({
					contentType: "text/plain",
					size: byteCount,
					blob: { size: byteCount },
				}),
				onProgress,
			).then(landed, failed);
			try {
				await jest.advanceTimersByTimeAsync(1);
				expect(request).toHaveBeenCalledWith(
					expect.objectContaining({
						headers: expect.objectContaining({
							"X-Goog-Upload-Protocol": "resumable",
							"X-Goog-Upload-Command": "start",
						}),
					}),
					expect.any(Function),
					null,
					null,
				);
				expect(progress).toEqual(expect.any(Function));
				if (behavior !== "stalled") {
					for (const bytesTransferred of [100, 200, 300]) {
						await jest.advanceTimersByTimeAsync(29_000);
						progress(bytesTransferred, byteCount);
						await jest.advanceTimersByTimeAsync(0);
						expect(onProgress).toHaveBeenLastCalledWith({
							phase: "uploading",
							bytesTransferred,
							totalBytes: byteCount,
						});
					}
					await jest.advanceTimersByTimeAsync(29_999);
				} else {
					await jest.advanceTimersByTimeAsync(29_998);
				}
				expect(failed).not.toHaveBeenCalled();
				expect(landed).not.toHaveBeenCalled();
				expect(cancel).not.toHaveBeenCalled();
				if (behavior === "moving") {
					finishing = true;
					finish();
					await jest.advanceTimersByTimeAsync(0);
					await upload;
					expect(failed).not.toHaveBeenCalled();
					expect(landed).toHaveBeenCalledTimes(1);
					expect(cancel).not.toHaveBeenCalled();
				} else {
					await jest.advanceTimersByTimeAsync(1);
					await upload;
					expect(failed).toHaveBeenCalledWith(
						expect.objectContaining({ code: "attachment-stalled" }),
					);
					expect(landed).not.toHaveBeenCalled();
					expect(cancel).toHaveBeenCalledTimes(1);
					expect(log).toHaveBeenCalledWith(
						"[upload] stalled at original upload",
					);
				}
			} finally {
				finishing = true;
				finish();
				await jest.advanceTimersByTimeAsync(0);
				await upload;
				request.mockRestore();
				await deleteApp(app);
			}
		},
	);
});

describe("uploadAttachment, local entry write", () => {
	it("rolls back the original when thumbnail preparation fails", async () => {
		const { downscaleImage } = jest.requireMock("@/utils/downscale");
		downscaleImage
			.mockResolvedValueOnce(new Blob(["jpeg"]))
			.mockRejectedValueOnce(new Error("thumbnail failed"));
		await expect(
			uploadAttachment("home", "node", "me", aFile()),
		).rejects.toThrow("thumbnail failed");
		expect(deleteObject).toHaveBeenCalledTimes(1);
	});

	it("returns after the local entry applies, before server acknowledgement, then rolls back a late rejection", async () => {
		let reject!: (reason: unknown) => void;
		updateDoc.mockReturnValueOnce(
			new Promise((_resolve, fail) => {
				reject = fail;
			}),
		);
		const onError = jest.fn();
		const notified = new Promise((resolve) => {
			onError.mockImplementation(resolve);
		});
		await expect(
			uploadAttachment("home", "node", "me", aFile(), undefined, onError),
		).resolves.toMatchObject({ name: "badrum.jpg" });
		expect(deleteObject).not.toHaveBeenCalled();
		const reason = { code: "permission-denied" };
		reject(reason);
		await notified;
		expect(deleteObject).toHaveBeenCalledTimes(2);
		expect(onError).toHaveBeenCalledWith(reason);
	});

	it("waits until the entry appears locally and removes its listener", async () => {
		const { onSnapshot } = jest.requireMock("firebase/firestore");
		let next!: (snapshot: { get: () => unknown }) => void;
		const unsubscribe = jest.fn();
		let registered!: () => void;
		const ready = new Promise<void>((resolve) => {
			registered = resolve;
		});
		onSnapshot.mockImplementationOnce(
			(_ref: unknown, _options: unknown, callback: typeof next) => {
				next = callback;
				registered();
				return unsubscribe;
			},
		);
		updateDoc.mockReturnValueOnce(new Promise(() => {}));
		const landed = jest.fn();
		const upload = uploadAttachment("home", "node", "me", aFile()).then(landed);
		await ready;
		next({ get: () => [] });
		await Promise.resolve();
		expect(landed).not.toHaveBeenCalled();
		next({ get: () => [arrayUnion.mock.calls[0][0]] });
		await upload;
		expect(unsubscribe).toHaveBeenCalledTimes(1);
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

	it("does not delete a thumbnail that was never written", async () => {
		const attachment = anAttachment({ hasThumbnail: false });
		txFor(aNodeWith([attachment]));
		await deleteAttachment("home", "node", attachment);
		expect(deleteObject).toHaveBeenCalledTimes(1);
		expect(deleteObject).toHaveBeenCalledWith({ path: attachment.path });
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
