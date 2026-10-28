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

		const home = await db.collection(homesCollection).doc(homeId).get();
		if (!isSoleOwner(home.data()?.members ?? {}, uid)) {
			throw new HttpsError(
				"failed-precondition",
				"Only the home's sole member and owner can delete it.",
			);
		}

		await deleteHomeTree(homeId);
	},
);
