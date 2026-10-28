import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db, homesCollection } from "./firestore.js";
import { deleteHomeTree, isSoleOwner } from "./home-cascade.js";
import { region } from "./options.js";

export const deleteHome = onCall(
	{ region, timeoutSeconds: 540 },
	async (request) => {
		const uid = request.auth?.uid;
		if (!uid) {
			throw new HttpsError(
				"unauthenticated",
				"Only a signed-in user can delete a home.",
			);
		}

		const homeId = (request.data as { homeId?: unknown } | null)?.homeId;
		if (typeof homeId !== "string" || !homeId || homeId.includes("/")) {
			throw new HttpsError("invalid-argument", "A home ID is required.");
		}

		const ref = db.collection(homesCollection).doc(homeId);
		await db.runTransaction(async (transaction) => {
			const home = await transaction.get(ref);
			if (
				!isSoleOwner(home.data()?.members ?? {}, uid) ||
				(home.get("deletionClaim") && home.get("deletionClaim") !== uid)
			) {
				throw new HttpsError(
					"failed-precondition",
					"Only the home's sole member and owner can delete it.",
				);
			}
			transaction.update(ref, { deletionClaim: uid });
		});

		await deleteHomeTree(homeId);
	},
);
