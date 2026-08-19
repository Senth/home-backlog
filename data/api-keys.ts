import {
	collection,
	type DocumentData,
	deleteDoc,
	doc,
	orderBy,
	type Query,
	type QueryDocumentSnapshot,
	query,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/config/firebase";
import type { ApiClient, ApiKey } from "@/models/api-key";

/**
 * Every Firestore read and write the Automations screens make.
 *
 * Thin, like `data/homes.ts` and `data/nodes.ts`: the decisions are in
 * `models/api-key.ts` and in `firestore.rules`. What is here is the shape of two
 * queries and the one thing the app cannot do itself.
 *
 * **Minting is a callable.** The rules refuse `create` and `update` on an
 * `apiKeys` document outright — a client that could write one could plant a hash
 * whose secret it already knows, which is a credential minted outside every
 * check the rules make. So the only writer is `createApiKey` in `functions/`,
 * and the plaintext token comes back once and is never recoverable.
 *
 * **Revoking is a plain delete**, because the rules allow exactly that and
 * nothing else, and because a revoke has to be *complete* the moment it lands.
 * A trigger takes the key's `apiClients` rows out of every home behind it.
 */

const usersCollection = "users";
const apiKeysCollection = "apiKeys";
const homesCollection = "homes";
const apiClientsCollection = "apiClients";

export function toApiKey(
	snapshot: QueryDocumentSnapshot<DocumentData>,
): ApiKey {
	const data = snapshot.data();

	return {
		id: snapshot.id,
		name: typeof data.name === "string" ? data.name : "",
		tail: typeof data.tail === "string" ? data.tail : "",
		createdAt: data.createdAt ?? null,
		lastUsedAt: data.lastUsedAt ?? null,
	};
}

export function toApiClient(
	snapshot: QueryDocumentSnapshot<DocumentData>,
): ApiClient {
	const data = snapshot.data();

	return {
		id: snapshot.id,
		ownerUid: typeof data.ownerUid === "string" ? data.ownerUid : "",
		ownerName: typeof data.ownerName === "string" ? data.ownerName : "",
		name: typeof data.name === "string" ? data.name : "",
		lastUsedAt: data.lastUsedAt ?? null,
	};
}

/**
 * My own keys, newest first.
 *
 * Trivially query-safe: the path is scoped to my own uid, so no document another
 * person owns can match, and the read rule is exactly `uid == request.auth.uid`.
 */
export function apiKeysQuery(uid: string): Query<DocumentData> {
	return query(
		collection(db, usersCollection, uid, apiKeysCollection),
		orderBy("createdAt", "desc"),
	);
}

/**
 * The automations that have written into one home, most recent first.
 *
 * Query-safe because every document in the collection is readable by every
 * member — the read rule is `isMember(homeId)`, which does not depend on the
 * document at all — so nothing this can match could be denied.
 */
export function homeApiClientsQuery(homeId: string): Query<DocumentData> {
	return query(
		collection(db, homesCollection, homeId, apiClientsCollection),
		orderBy("lastUsedAt", "desc"),
	);
}

export interface MintedKey {
	keyId: string;
	/** The plaintext token. Shown once, stored nowhere, unrecoverable after. */
	token: string;
}

/**
 * Mint a key. Online only, and never optimistic: the token is generated on the
 * server and there is nothing to show until it comes back.
 */
export async function createApiKey(name: string): Promise<MintedKey> {
	const call = httpsCallable<{ name: string }, MintedKey>(
		functions,
		"createApiKey",
	);
	const result = await call({ name });
	return result.data;
}

/**
 * Revoke a key, which stops it working immediately: verification is a `get()` on
 * this document, so a request with that token is a 401 the moment it is gone.
 *
 * Deliberately awaited by its caller rather than queued offline. Firestore would
 * apply a delete locally at once and show the key as gone while it kept working
 * — a lie on the one screen where it matters.
 */
export function revokeApiKey(uid: string, keyId: string): Promise<void> {
	return deleteDoc(doc(db, usersCollection, uid, apiKeysCollection, keyId));
}
