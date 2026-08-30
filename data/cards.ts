import {
	type CollectionReference,
	collection,
	type DocumentData,
	type DocumentReference,
	deleteDoc,
	doc,
	serverTimestamp,
	setDoc,
	updateDoc,
} from "firebase/firestore";
import { db } from "@/config/firebase";
import { type Card, type CardScope, seedCards } from "@/models/overview-cards";

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
 *
 * The two map docs are written with `{ merge: true }` and one field at a time:
 * an edit of the cards map must not clobber `hiddenSharedIds` (or the seed
 * marker), and a hide must not clobber the cards. Everything here queues
 * offline like any other write.
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

/**
 * The whole cards map, rewritten. A map doc is the unit of storage for the
 * two per-user surfaces, so one member's own edits — create, edit, reorder,
 * remove — all land as this one write; two of this member's devices racing is
 * the same last-write-wins the board accepts.
 *
 * The field is **replaced, not merged**: Firestore's `{ merge: true }` unions
 * map fields key by key, so a remove written as a merge would leave the
 * removed card exactly where it was. `updateDoc` replaces the named field
 * whole — it only refuses on a missing document, which is the one case the
 * merge fallback covers (a first write creating the doc, where there is
 * nothing to lose).
 */
function saveCardsMap(
	reference: DocumentReference<DocumentData>,
	cards: readonly Card[],
): Promise<void> {
	const map = Object.fromEntries(cards.map((card) => [card.id, card]));
	return updateDoc(reference, { cards: map }).catch((reason: unknown) => {
		if (!isMissingDoc(reason)) throw reason;
		return setDoc(reference, { cards: map }, { merge: true });
	});
}

export function saveGlobalCards(
	uid: string,
	cards: readonly Card[],
): Promise<void> {
	return saveCardsMap(globalCardsRef(uid), cards);
}

export function saveHomeCards(
	homeId: string,
	uid: string,
	cards: readonly Card[],
): Promise<void> {
	return saveCardsMap(homeCardsRef(homeId, uid), cards);
}

export function saveSharedCard(homeId: string, card: Card): Promise<void> {
	return setDoc(doc(sharedCardsRef(homeId), card.id), card);
}

export function deleteSharedCard(
	homeId: string,
	cardId: string,
): Promise<void> {
	return deleteDoc(doc(sharedCardsRef(homeId), cardId));
}

/** The member's own list of shared cards they hid, rewritten whole. */
export function saveHiddenShared(
	homeId: string,
	uid: string,
	hiddenSharedIds: readonly string[],
): Promise<void> {
	const ids = [...hiddenSharedIds];
	return updateDoc(homeCardsRef(homeId, uid), {
		hiddenSharedIds: ids,
	}).catch((reason: unknown) => {
		if (!isMissingDoc(reason)) throw reason;
		return setDoc(
			homeCardsRef(homeId, uid),
			{ hiddenSharedIds: ids },
			{ merge: true },
		);
	});
}

/** Firestore's "no document to update" — the one case a merge fallback covers. */
function isMissingDoc(reason: unknown): boolean {
	return (
		typeof reason === "object" &&
		reason !== null &&
		(reason as { code?: unknown }).code === "not-found"
	);
}

/**
 * A fresh auto-id for a card being composed. Nothing is written — the id is
 * decided here so a card keeps its id when it moves scope, and a scope move
 * cannot leave two copies of it behind.
 */
export function newCardId(
	scope: CardScope,
	homeId: string | null,
	uid: string,
): string {
	if (scope === "shared") return doc(sharedCardsRef(homeId ?? "")).id;
	if (scope === "home") {
		return doc(collection(db, "homes", homeId ?? "", "dashboards")).id;
	}
	return doc(collection(db, "users", uid, "dashboard")).id;
}
