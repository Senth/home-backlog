import { createHash } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { planAccountDeletion } from "./account-plan.js";
import {
	apiClientsCollection,
	apiKeysCollection,
	dashboardsCollection,
	db,
	homesCollection,
	nodesCollection,
	usersCollection,
} from "./firestore.js";
import { deleteHomeTree } from "./home-cascade.js";
import { region } from "./options.js";

export const deleteAccount = onCall(
	{ region, timeoutSeconds: 540 },
	async (request) => {
		const uid = request.auth?.uid;
		if (!uid) {
			throw new HttpsError(
				"unauthenticated",
				"Only a signed-in user can delete their account.",
			);
		}
		const dryRun = (request.data as { dryRun?: unknown } | null)?.dryRun;
		if (typeof dryRun !== "boolean") {
			throw new HttpsError("invalid-argument", "dryRun must be a boolean.");
		}

		const userRef = db.collection(usersCollection).doc(uid);
		const [membership, keys] = await Promise.all([
			db
				.collection(homesCollection)
				.where(new FieldPath("members", uid), "in", ["owner", "member"])
				.get(),
			userRef.collection(apiKeysCollection).get(),
		]);
		const homes = await Promise.all(
			membership.docs.map(async (home) => {
				const participants = await home.ref
					.collection(nodesCollection)
					.where("participantIds", "array-contains", uid)
					.get();
				return {
					homeId: home.id,
					name: home.get("name") as string,
					members: home.get("members") as Record<string, string>,
					memberProfiles: home.get("memberProfiles") ?? {},
					nodes: participants.docs.map((node) => ({
						visibility: node.get("visibility") as string,
						participantIds: node.get("participantIds") as string[],
					})),
					participants,
					ref: home.ref,
				};
			}),
		);
		const plan = planAccountDeletion({
			uid,
			homes,
			apiKeys: keys.docs.map((key) => ({ name: key.get("name") as string })),
		});
		if (dryRun) return plan;
		if (plan.homes.some((home) => home.outcome === "blocked")) {
			throw new HttpsError("failed-precondition", "blocked");
		}
		const authTime = request.auth?.token.auth_time;
		if (
			typeof authTime !== "number" ||
			!Number.isFinite(authTime) ||
			Date.now() / 1000 - authTime > 300
		) {
			throw new HttpsError("failed-precondition", "recent-login");
		}

		const leaving = homes.filter((home) =>
			plan.homes.some(
				(entry) => entry.homeId === home.homeId && entry.outcome === "leave",
			),
		);
		for (const home of leaving) {
			const assigned = await home.ref
				.collection(nodesCollection)
				.where("assigneeIds", "array-contains", uid)
				.get();
			const nodes = new Map(
				[...home.participants.docs, ...assigned.docs].map((node) => [
					node.id,
					node,
				]),
			);
			for (const node of nodes.values()) {
				const participants = node.get("participantIds") as string[] | undefined;
				if (
					node.get("visibility") === "private" &&
					participants?.length === 1 &&
					participants[0] === uid
				) {
					await node.ref.delete();
				} else {
					await node.ref.update({
						participantIds: FieldValue.arrayRemove(uid),
						assigneeIds: FieldValue.arrayRemove(uid),
					});
				}
			}
		}
		for (const home of leaving) {
			await home.ref.collection(dashboardsCollection).doc(uid).delete();
			const clients = await home.ref
				.collection(apiClientsCollection)
				.where("ownerUid", "==", uid)
				.get();
			for (const client of clients.docs) await client.ref.delete();
			await home.ref.update(
				new FieldPath("members", uid),
				FieldValue.delete(),
				new FieldPath("memberProfiles", uid),
				FieldValue.delete(),
				new FieldPath("memberEmailHashes", uid),
				FieldValue.delete(),
			);
		}
		for (const home of plan.homes.filter((home) => home.outcome === "delete")) {
			const ref = db.collection(homesCollection).doc(home.homeId);
			for (const collection of await ref.listCollections()) {
				await db.recursiveDelete(collection);
			}
			await deleteHomeTree(home.homeId);
		}
		const email = request.auth?.token.email;
		if (typeof email === "string" && email.trim()) {
			const hash = createHash("sha256")
				.update(
					email.trim().replace(/[A-Z]/g, (letter) => letter.toLowerCase()),
				)
				.digest("hex");
			const invites = await db
				.collectionGroup("invites")
				.where("emailHash", "==", hash)
				.get();
			for (const invite of invites.docs) await invite.ref.delete();
		}
		await db.recursiveDelete(userRef);
		try {
			await getAuth().deleteUser(uid);
		} catch (error) {
			if ((error as { code?: string }).code !== "auth/user-not-found")
				throw error;
		}
		return plan;
	},
);
