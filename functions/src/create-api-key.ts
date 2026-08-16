import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { formatToken, keyNameError, tailOf } from "../../models/api-key";
import { newSecret, secretHash } from "./api-key";
import { apiKeysCollection, db, usersCollection } from "./firestore";

/**
 * Minting a key, as a callable rather than a REST verb.
 *
 * It has to be a function: the rules refuse `create` and `update` on an
 * `apiKeys` document outright, because a client that could write one could plant
 * a hash whose secret it already knows and mint itself a credential. So the only
 * writer is this, which the Admin SDK puts outside the rules.
 *
 * Callable rather than a `POST /v1/keys`, because the caller is a signed-in
 * *person* holding a Firebase ID token, not an agent holding a key — and a key
 * that could mint another key would make revocation meaningless.
 *
 * The plaintext token is returned **once**, here, and is never recoverable
 * afterwards: only its SHA-256 and its last four characters are stored.
 */
export const createApiKey = onCall(async (request) => {
	const uid = request.auth?.uid;
	if (!uid) {
		throw new HttpsError(
			"unauthenticated",
			"Only a signed-in user can create an API key.",
		);
	}

	const raw = (request.data as { name?: unknown } | null)?.name;
	const name = typeof raw === "string" ? raw.trim() : "";
	// The same check the create dialog runs, and the reason it is here too: the
	// dialog is a courtesy, this is the rule. A key is named before its secret is
	// revealed, because a key named later is a key never named.
	const problem = keyNameError(name);
	if (problem) throw new HttpsError("invalid-argument", problem);

	const ref = db
		.collection(usersCollection)
		.doc(uid)
		.collection(apiKeysCollection)
		.doc();
	const secret = newSecret();
	const token = formatToken({ uid, keyId: ref.id, secret });

	await ref.set({
		name,
		secretHash: secretHash(secret),
		// Stored so that a list of four keys is distinguishable. Four characters
		// of a 256-bit secret is not a meaningful head start on guessing it.
		tail: tailOf(token),
		createdAt: FieldValue.serverTimestamp(),
		// Written as null rather than left absent. Firestore does not index an
		// absent field, so a field that arrives only on first use is one no query
		// can ever match negatively — the same trap the node field set is built
		// around. A never-used key reads as `Never used` from this null.
		lastUsedAt: null,
	});

	return { keyId: ref.id, token };
});
