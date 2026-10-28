import { db, homesCollection } from "./firestore.js";

export function isSoleOwner(
	members: Record<string, unknown>,
	uid: string,
): boolean {
	return Object.keys(members).length === 1 && members[uid] === "owner";
}

export async function deleteHomeTree(homeId: string): Promise<void> {
	const home = db.collection(homesCollection).doc(homeId);
	for (const collection of await home.listCollections()) {
		await db.recursiveDelete(collection);
	}
	await db.recursiveDelete(home);
}
