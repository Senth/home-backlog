import {
	type CollectionReference,
	collection,
	type DocumentData,
	type DocumentReference,
	doc,
	serverTimestamp,
	setDoc,
} from "firebase/firestore";
import { db } from "@/config/firebase";
import { seedCards } from "@/models/overview-cards";

/**
 * Every Firestore read and write that touches card config, on three surfaces:
 *
 * - `users/{uid}/dashboard/config` — one cross-home doc: a member's global
 *   cards plus the marker saying seeding ran. Owner only.
 * - `homes/{homeId}/dashboards/{uid}` — one doc per member: this home's cards
 *   and the shared cards they hid. Own document only — nobody arranges your
 *   screen.
 * - `homes/{homeId}/dashboardCards/{cardId}` — one doc per shared card, so two
 *   members editing different shared cards never clobber each other. Any
 *   member.
 *
 * Each surface is read by id (the two docs) or as one bounded collection, so
 * every read is provably safe: you can only ever name your own config docs,
 * and only members can name the shared collection.
 */

export function globalCardsRef(uid: string): DocumentReference<DocumentData> {
	return doc(db, "users", uid, "dashboard", "config");
}

export function homeCardsRef(
	homeId: string,
	uid: string,
): DocumentReference<DocumentData> {
	return doc(db, "homes", homeId, "dashboards", uid);
}

export function sharedCardsRef(
	homeId: string,
): CollectionReference<DocumentData> {
	return collection(db, "homes", homeId, "dashboardCards");
}

/**
 * The seven seeds, written once into a missing global config.
 *
 * Writes the marker in the same document, so "has this run" is answered by the
 * read that asked — and deliberately **not** a diff against the seed list: a
 * seed the user removed stays removed, because nothing here ever re-adds one.
 * Two devices racing a first open write identical content, so last write wins
 * harmlessly.
 */
export function seedGlobalCards(uid: string): Promise<void> {
	return setDoc(globalCardsRef(uid), {
		cards: seedCards(),
		seededAt: serverTimestamp(),
	});
}
