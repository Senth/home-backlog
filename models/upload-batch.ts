import type { AttachmentErrorKey } from "@/models/attachment";
import {
	attachmentErrorKey,
	attachmentRefusal,
	homeAttachmentCeiling,
} from "@/models/attachment";

export const maxConcurrentUploads = 3;

export interface UploadBatchFile {
	id: string;
	name: string;
	size: number;
	contentType: string;
	previewUrl?: string;
}

export type UploadBatchStatus =
	| { status: "waiting" }
	| { status: "preparing" }
	| { status: "uploading"; transferred: number; total: number }
	| { status: "failed"; key: AttachmentErrorKey };

export interface UploadBatchEntry<T extends UploadBatchFile> {
	file: T;
	state: UploadBatchStatus;
}

export interface UploadBatchState<T extends UploadBatchFile> {
	total: number;
	landed: number;
	remainingQuota: number;
	landedIds: string[];
	files: UploadBatchEntry<T>[];
}

export type UploadBatchUpdate<T extends UploadBatchFile = UploadBatchFile> =
	| { type: "preparing"; id: string }
	| {
			type: "uploading";
			id: string;
			transferred: number;
			total: number;
	  }
	| { type: "failed"; id: string; key: AttachmentErrorKey }
	| { type: "late-failed"; id: string; file: T; key: AttachmentErrorKey }
	| { type: "landed"; id: string };

function allocateFiles<T extends UploadBatchFile>(
	files: readonly T[],
	remainingQuota: number,
): { entries: UploadBatchEntry<T>[]; remainingQuota: number } {
	const entries: UploadBatchEntry<T>[] = [];
	let remaining = remainingQuota;
	for (const file of files) {
		const refusal = attachmentRefusal(file.contentType, file.size);
		if (refusal !== null) {
			entries.push({
				file,
				state: { status: "failed", key: attachmentErrorKey({ code: refusal }) },
			});
		} else if (remaining <= 0 || file.size > remaining) {
			entries.push({
				file,
				state: { status: "failed", key: "detail.attachmentsQuota" },
			});
		} else {
			remaining -= file.size;
			entries.push({ file, state: { status: "waiting" } });
		}
	}
	return { entries, remainingQuota: remaining };
}

export function startUploadBatch<T extends UploadBatchFile>(
	files: readonly T[],
	attachmentBytes: number,
): UploadBatchState<T> {
	const remaining = Math.max(0, homeAttachmentCeiling - attachmentBytes);
	const allocated = allocateFiles(files, remaining);
	return {
		total: files.length,
		landed: 0,
		remainingQuota: allocated.remainingQuota,
		landedIds: [],
		files: allocated.entries,
	};
}

export function appendUploadBatch<T extends UploadBatchFile>(
	state: UploadBatchState<T>,
	files: readonly T[],
): UploadBatchState<T> {
	const allocated = allocateFiles(files, state.remainingQuota);
	return {
		...state,
		total: state.total + files.length,
		remainingQuota: allocated.remainingQuota,
		files: [...state.files, ...allocated.entries],
	};
}

export function claimUploadBatch<T extends UploadBatchFile>(
	state: UploadBatchState<T>,
): { state: UploadBatchState<T>; claimed: T[] } {
	const running = state.files.filter(
		({ state: status }) =>
			status.status === "preparing" || status.status === "uploading",
	).length;
	let slots = maxConcurrentUploads - running;
	const claimed: T[] = [];
	const files = state.files.map((entry) => {
		if (slots === 0 || entry.state.status !== "waiting") return entry;
		slots -= 1;
		claimed.push(entry.file);
		return { ...entry, state: { status: "preparing" as const } };
	});
	return { state: { ...state, files }, claimed };
}

export function updateUploadBatch<T extends UploadBatchFile>(
	state: UploadBatchState<T>,
	update: UploadBatchUpdate<T>,
): UploadBatchState<T> {
	const index = state.files.findIndex((entry) => entry.file.id === update.id);
	if (update.type === "landed") {
		const entry = state.files[index];
		if (!entry) return state;
		return {
			...state,
			landed: state.landed + 1,
			landedIds: [...state.landedIds, update.id],
			files: state.files.filter((file) => file.file.id !== update.id),
		};
	}
	if (update.type === "late-failed") {
		if (!state.landedIds.includes(update.id)) return state;
		const file = { ...update.file };
		delete file.previewUrl;
		return {
			...state,
			landed: state.landed - 1,
			remainingQuota: state.remainingQuota + update.file.size,
			landedIds: state.landedIds.filter((id) => id !== update.id),
			files: [
				...state.files,
				{ file, state: { status: "failed", key: update.key } },
			],
		};
	}
	if (index === -1) return state;
	const entry = state.files[index];
	if (!entry) return state;
	if (update.type === "failed") {
		if (entry.state.status === "failed") return state;
		return {
			...state,
			remainingQuota: state.remainingQuota + entry.file.size,
			files: state.files.map((file) =>
				file.file.id === update.id
					? { ...file, state: { status: "failed", key: update.key } }
					: file,
			),
		};
	}
	if (entry.state.status === "failed") return state;
	return {
		...state,
		files: state.files.map((file) =>
			file.file.id === update.id
				? {
						...file,
						state:
							update.type === "preparing"
								? { status: "preparing" }
								: {
										status: "uploading",
										transferred: update.transferred,
										total: update.total,
									},
					}
				: file,
		),
	};
}

export function uploadBatchActive<T extends UploadBatchFile>(
	state: UploadBatchState<T>,
): boolean {
	return state.files.some(
		({ state: status }) =>
			status.status === "waiting" ||
			status.status === "preparing" ||
			status.status === "uploading",
	);
}
