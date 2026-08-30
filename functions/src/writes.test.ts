import type { Request } from "express";
import type { DocumentSnapshot } from "firebase-admin/firestore";
import { etagFor } from "./api-nodes.js";
import { checkPrecondition } from "./writes.js";

/**
 * The concurrency contract the node and location write verbs share: `If-Match`
 * is advisory, a stale one is a `412 version_mismatch`, and a matching or
 * absent one lets the write through.
 */

const stamp = { toDate: () => new Date("2026-08-31T12:00:00.000Z") };

function request(ifMatch: string | undefined): Request {
	return {
		get: (name: string) => (name === "if-match" ? ifMatch : undefined),
	} as unknown as Request;
}

function snapshot(updatedAt: unknown): DocumentSnapshot {
	return {
		get: (field: string) => (field === "updatedAt" ? updatedAt : undefined),
	} as unknown as DocumentSnapshot;
}

describe("checkPrecondition", () => {
	it("lets a write through when no If-Match is sent", () => {
		expect(() =>
			checkPrecondition(request(undefined), snapshot(stamp)),
		).not.toThrow();
	});

	it("lets a write through when the If-Match matches", () => {
		expect(() =>
			checkPrecondition(request(etagFor(stamp)), snapshot(stamp)),
		).not.toThrow();
	});

	it("refuses a stale If-Match with 412 version_mismatch", () => {
		expect(() =>
			checkPrecondition(
				request(etagFor({ toDate: () => new Date(0) })),
				snapshot(stamp),
			),
		).toThrow(
			expect.objectContaining({ status: 412, code: "version_mismatch" }),
		);
	});
});
