import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * The Admin SDK handle every handler and trigger shares.
 *
 * The Admin SDK **bypasses `firestore.rules` entirely**, which is the whole
 * reason this API is a function at all: a bulk subtree create then commits in
 * one atomic batch, up to the 500-document cap, with none of the
 * twenty-document-access budget a batched client write lives inside. Under the
 * rules it could not be atomic at all — a rule's `get()` reads *committed*
 * state, so a child written before its parent commits fails `inheritsFrom`, and
 * top-down over a network means a timeout mid-flight leaves half a tree. Half a
 * tree is not untidy but corrupt: a child whose parent is missing carries
 * `ancestorIds` pointing at nothing and is unreachable from every board and
 * every breadcrumb.
 *
 * What it costs is that no invariant is enforced here by the rules that state
 * them, which is what `validate.ts` exists to answer. Nothing in this package
 * may write a node document without going through it.
 */
if (getApps().length === 0) initializeApp();

export const db = getFirestore();

export const homesCollection = "homes";
export const nodesCollection = "nodes";
export const usersCollection = "users";
export const apiKeysCollection = "apiKeys";
export const apiClientsCollection = "apiClients";
export const runsCollection = "runs";

/** The most documents one Firestore batch may carry. */
export const maxBatchWrites = 500;
