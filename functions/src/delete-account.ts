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
		const membershipQuery = db
			.collection(homesCollection)
			.where(new FieldPath("members", uid), "in", ["owner", "member"]);
		const [membership, keys] = await Promise.all([
			membershipQuery.get(),
			userRef.collection(apiKeysCollection).get(),
		]);
		let homes = await Promise.all(
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
		let plan = planAccountDeletion({
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

		const claimed = await db.runTransaction(async (transaction) => {
			const current = await transaction.get(membershipQuery);
			const currentHomes = current.docs.map((home) => ({
				homeId: home.id,
				name: home.get("name") as string,
				members: home.get("members") as Record<string, string>,
				memberProfiles: home.get("memberProfiles") ?? {},
				nodes:
					homes.find((previous) => previous.homeId === home.id)?.nodes ?? [],
				ref: home.ref,
			}));
			const currentPlan = planAccountDeletion({
				uid,
				homes: currentHomes,
				apiKeys: plan.apiKeys,
			});
			if (
				currentPlan.homes.some((home) => home.outcome === "blocked") ||
				current.docs.some(
					(home) =>
						home.get("deletionClaim") && home.get("deletionClaim") !== uid,
				)
			) {
				throw new HttpsError("failed-precondition", "blocked");
			}
			for (const home of current.docs)
				transaction.update(home.ref, { deletionClaim: uid });
			return { homes: currentHomes, plan: currentPlan };
		});
		plan = claimed.plan;
		homes = await Promise.all(
			claimed.homes.map(async (home) => ({
				...home,
				participants: await home.ref.collection(nodesCollection).get(),
			})),
		);
		const leaving = homes.filter((home) =>
			plan.homes.some(
				(entry) => entry.homeId === home.homeId && entry.outcome === "leave",
			),
		);
		for (const home of leaving) {
			const nodes = home.participants.docs;
			const deleted = new Set(
				nodes
					.filter((node) => {
						const participants = node.get("participantIds") as
							| string[]
							| undefined;
						return (
							node.get("visibility") === "private" &&
							participants?.length === 1 &&
							participants[0] === uid
						);
					})
					.map((node) => node.id),
			);
			const retained = nodes
				.filter((node) => !deleted.has(node.id))
				.map((node) => {
					const ancestorIds = (
						(node.get("ancestorIds") ?? []) as string[]
					).filter((id) => !deleted.has(id));
					return { node, ancestorIds, parentId: ancestorIds.at(-1) ?? null };
				});
			const remainingMembers = Object.keys(home.members).filter(
				(member) => member !== uid,
			);
			const counts = new Map<
				string,
				{ childCount: number; doneCount: number }
			>();
			for (const { node, parentId } of retained) {
				if (parentId === null) continue;
				const count = counts.get(parentId) ?? { childCount: 0, doneCount: 0 };
				count.childCount += 1;
				if (node.get("status") === "done") count.doneCount += 1;
				counts.set(parentId, count);
			}
			for (const { node, ancestorIds, parentId } of retained) {
				const participants = (
					(node.get("participantIds") ?? []) as string[]
				).filter((member) => member !== uid);
				await node.ref.update({
					parentId,
					ancestorIds,
					...(counts.get(node.id) ?? { childCount: 0, doneCount: 0 }),
					participantIds:
						parentId === null &&
						node.get("visibility") === "shared" &&
						participants.length === 0
							? remainingMembers
							: participants,
					assigneeIds: FieldValue.arrayRemove(uid),
				});
			}
			for (const node of nodes)
				if (deleted.has(node.id)) await node.ref.delete();
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
				new FieldPath("deletionClaim"),
				FieldValue.delete(),
			);
		}
		for (const home of plan.homes.filter((home) => home.outcome === "delete")) {
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
