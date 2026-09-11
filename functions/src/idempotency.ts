import type { Request, Response } from "express";
import type { DocumentReference, WriteBatch } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { ApiError } from "./errors.js";

/**
 * The replay bookkeeping every bulk create shares.
 *
 * A run is recorded under the key that made it, on the caller's own key
 * document, so revoking a key takes its history with it — and so the run
 * document keeps no shape any screen or rule has to know about.
 */

/**
 * How long a run is remembered.
 *
 * Long enough for a retry loop, a rerun after a crash, or a person noticing in
 * the morning; short enough that the collection does not grow forever. A
 * Firestore TTL policy on `expiresAt` does the deleting, and it is configured
 * per collection group rather than by `firebase deploy`.
 */
export const runTtlHours = 24;

/**
 * An `Idempotency-Key` has to be a legal Firestore document id, because that is
 * what it becomes. Refusing an unusable one is better than hashing it into
 * something the caller cannot recognize in a later error.
 */
const idempotencyKeyPattern = /^[A-Za-z0-9_.:-]{1,200}$/;

/** What a run returns, and so what a replay remembers: the id map and its root. */
export interface RunRecord {
	rootId: string;
	ids: Record<string, string>;
}

export function idempotencyKeyOf(request: Request): string | null {
	const key = request.get("idempotency-key");
	if (!key) return null;
	if (!idempotencyKeyPattern.test(key) || key === "." || key === "..") {
		throw new ApiError(
			400,
			"invalid_idempotency_key",
			"An Idempotency-Key is 1–200 characters of letters, digits, `-`, `_`, `.` or `:`.",
		);
	}
	return key;
}

/** The previous run under this key, or `null` when the key is fresh. */
export async function replayOf(
	runRef: DocumentReference,
): Promise<RunRecord | null> {
	const previous = await runRef.get();
	if (!previous.exists) return null;
	return { rootId: previous.get("rootId"), ids: previous.get("ids") };
}

/** A replay answers with the first run's ids and writes nothing. */
export function replayResponse(response: Response, run: RunRecord): void {
	response.setHeader("Idempotency-Replayed", "true");
	response.json({ rootId: run.rootId, ids: run.ids });
}

/**
 * Remember a run, **in the same batch as the tree it created**. A replay record
 * written separately could fail on its own, and an agent that retried would
 * then write the whole subtree a second time.
 */
export function recordRun(
	batch: WriteBatch,
	runRef: DocumentReference,
	run: RunRecord,
): void {
	batch.set(runRef, {
		ids: run.ids,
		rootId: run.rootId,
		createdAt: FieldValue.serverTimestamp(),
		expiresAt: Timestamp.fromMillis(Date.now() + runTtlHours * 60 * 60 * 1000),
	});
}
