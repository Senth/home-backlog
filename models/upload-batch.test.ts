import { homeAttachmentCeiling } from "@/models/attachment";
import type { UploadBatchFile } from "@/models/upload-batch";
import {
	appendUploadBatch,
	claimUploadBatch,
	maxConcurrentUploads,
	startUploadBatch,
	updateUploadBatch,
	uploadBatchActive,
} from "@/models/upload-batch";

const oneByte = 1;
const bytesAvailable = 30;
const fitsBytes = 20;
const overBudgetBytes = 15;
const extraBytes = 10;

function files(count: number, size = 1): UploadBatchFile[] {
	return Array.from({ length: count }, (_, index) => ({
		id: `file-${index}`,
		name: `file-${index}.jpg`,
		size,
	}));
}

describe("upload batches", () => {
	it("claims at most three files and fills the next slot after landing", () => {
		const initial = startUploadBatch(files(5), 0);
		const first = claimUploadBatch(initial);

		expect(first.claimed.map((file) => file.id)).toEqual([
			"file-0",
			"file-1",
			"file-2",
		]);
		expect(maxConcurrentUploads).toBe(3);
		const advanced = updateUploadBatch(first.state, {
			type: "landed",
			id: "file-0",
		});
		expect(claimUploadBatch(advanced).claimed.map((file) => file.id)).toEqual([
			"file-3",
		]);
	});

	it("appends picks during a running batch and keeps pick order", () => {
		const initial = claimUploadBatch(startUploadBatch(files(4), 0));
		const added = appendUploadBatch(initial.state, [
			{ id: "file-4", name: "file-4.jpg", size: oneByte },
			{ id: "file-5", name: "file-5.jpg", size: oneByte },
		]);
		expect(added.total).toBe(6);
		expect(added.files.map(({ file }) => file.id)).toEqual([
			"file-0",
			"file-1",
			"file-2",
			"file-3",
			"file-4",
			"file-5",
		]);
		expect(claimUploadBatch(added).claimed).toEqual([]);
	});

	it("refuses only files that exceed the remaining quota", () => {
		const state = startUploadBatch(
			[
				{ id: "fits", name: "fits.pdf", size: fitsBytes },
				{ id: "too-large", name: "large.pdf", size: overBudgetBytes },
				{ id: "also-fits", name: "small.pdf", size: extraBytes },
			],
			homeAttachmentCeiling - bytesAvailable,
		);
		expect(state.files.map(({ state: status }) => status)).toEqual([
			{ status: "waiting" },
			{ status: "failed", key: "detail.attachmentsQuota" },
			{ status: "waiting" },
		]);
	});

	it("keeps failures while other files land, then ends until a new batch", () => {
		const first = claimUploadBatch(startUploadBatch(files(3), 0));
		const failed = updateUploadBatch(first.state, {
			type: "failed",
			id: "file-0",
			key: "detail.attachmentsFailed",
		});
		const landed = updateUploadBatch(failed, {
			type: "landed",
			id: "file-1",
		});
		const finished = updateUploadBatch(landed, {
			type: "landed",
			id: "file-2",
		});

		expect(finished.landed).toBe(2);
		expect(finished.files).toEqual([
			{
				file: files(1)[0],
				state: { status: "failed", key: "detail.attachmentsFailed" },
			},
		]);
		expect(uploadBatchActive(finished)).toBe(false);
		expect(startUploadBatch(files(1), 0).files[0]?.state).toEqual({
			status: "waiting",
		});
	});
});
