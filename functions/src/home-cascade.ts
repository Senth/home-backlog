import { randomUUID } from "node:crypto";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db, homesCollection, maxBatchWrites } from "./firestore.js";

export function deletionClaim() {
	return {
		id: randomUUID(),
		expiresAt: Timestamp.fromMillis(Date.now() + 600_000),
	};
}

export function claimActive(claim: unknown): boolean {
	const expiresAt = (claim as { expiresAt?: Timestamp } | null)?.expiresAt;
	return expiresAt instanceof Timestamp && expiresAt.toMillis() > Date.now();
}

export async function withDeletionClaim<T>(
	home: DocumentReference,
	id: string,
	write: (transaction: Transaction) => T | Promise<T>,
): Promise<T> {
	return db.runTransaction(async (transaction) => {
		const current = (await transaction.get(home)).get("deletionClaim");
		if (current?.id !== id || !claimActive(current))
			throw new HttpsError("failed-precondition", "blocked");
		return write(transaction);
	});
}

export async function releaseDeletionClaim(
	home: DocumentReference,
	id: string,
): Promise<void> {
	await db.runTransaction(async (transaction) => {
		const snapshot = await transaction.get(home);
		if (snapshot.get("deletionClaim")?.id === id)
			transaction.update(home, {
				"deletionClaim.expiresAt": Timestamp.fromMillis(0),
			});
	});
}

export function isSoleOwner(
	members: Record<string, unknown>,
	uid: string,
): boolean {
	return Object.keys(members).length === 1 && members[uid] === "owner";
}

export async function deleteHomeTree(
	homeId: string,
	claimId: string,
): Promise<void> {
	const home = db.collection(homesCollection).doc(homeId);
	async function drain(parent: DocumentReference): Promise<void> {
		for (const collection of await parent.listCollections()) {
			const documents = await collection.listDocuments();
			for (const document of documents) await drain(document);
			for (let start = 0; start < documents.length; start += maxBatchWrites) {
				await withDeletionClaim(home, claimId, (transaction) => {
					for (const document of documents.slice(start, start + maxBatchWrites))
						transaction.delete(document);
				});
			}
		}
	}
	await drain(home);
	await withDeletionClaim(home, claimId, (transaction) =>
		transaction.delete(home),
	);
}
