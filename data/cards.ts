import {
	type CollectionReference,
	collection,
	type DocumentData,
	type DocumentReference,
	deleteDoc,
	doc,
	serverTimestamp,
	setDoc,
	writeBatch,
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
 * A map doc's fields are **replaced, not merged**: Firestore's `{ merge: true }`
 * unions map fields key by key, so a remove written as a merge would leave the
 * removed card exactly where it was. `replaceField` names the one field and
 * replaces it whole — and creates the document when it is missing, which is
 * the one case the old `updateDoc`-then-merge fallback covered. Everything
 * here queues offline like any other write.
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

/** Replace one field whole, creating the document when it is missing. */
function replaceField(
	reference: DocumentReference<DocumentData>,
	field: string,
	value: unknown,
): Promise<void> {
	return setDoc(reference, { [field]: value }, { mergeFields: [field] });
}

/** The map doc a per-user scope stores its cards on. */
function mapRef(
	scope: "global" | "home",
	homeId: string | null,
	uid: string,
): DocumentReference<DocumentData> {
	return scope === "global"
		? globalCardsRef(uid)
		: homeCardsRef(homeId ?? "", uid);
}

/** One scope's cards as the map field the two per-user docs store. */
const cardsMap = (cards: readonly Card[]): Record<string, Card> =>
	Object.fromEntries(cards.map((card) => [card.id, card]));

/**
 * One scope's arrangement, written whole — the one write behind every add,
 * edit and reorder.
 *
 * The two per-user surfaces are their map field replaced; a shared card is
 * its own document, so the cards given are set one each (a removal goes
 * through `deleteScopeCard`). An empty shared list writes nothing.
 */
export function saveScopeCards(
	scope: CardScope,
	homeId: string | null,
	uid: string,
	cards: readonly Card[],
): Promise<void> {
	if (scope === "shared") {
		return Promise.all(
			cards.map((card) =>
				setDoc(doc(sharedCardsRef(homeId ?? ""), card.id), card),
			),
		).then(() => undefined);
	}
	return replaceField(mapRef(scope, homeId, uid), "cards", cardsMap(cards));
}

/**
 * One card off a scope. A shared card's document is deleted; a map scope is
 * the surface's cards rewritten without the id — a map field can't lose one
 * key on its own.
 */
export function deleteScopeCard(
	scope: CardScope,
	homeId: string | null,
	uid: string,
	id: string,
	cards: readonly Card[],
): Promise<void> {
	if (scope === "shared") {
		return deleteDoc(doc(sharedCardsRef(homeId ?? ""), id));
	}
	return saveScopeCards(
		scope,
		homeId,
		uid,
		cards.filter((card) => card.id !== id),
	);
}

/**
 * A scope move in **one** batch, so an offline interruption between the two
 * writes cannot leave the card on both surfaces under one id — under
 * `editorList`'s later-scope-wins the loser would be an invisible orphan.
 * The card arrives whole on the `to` surface and is gone from the `from`
 * surface atomically, server-side.
 */
export function moveScopeCard(
	card: Card,
	from: CardScope,
	to: CardScope,
	homeId: string | null,
	uid: string,
	/** The `from` surface's cards without the moved one. */
	fromCards: readonly Card[],
	/** The `to` surface's own cards, which the moved one joins. */
	toCards: readonly Card[],
): Promise<void> {
	const batch = writeBatch(db);
	if (to === "shared") {
		batch.set(doc(sharedCardsRef(homeId ?? ""), card.id), card);
	} else {
		batch.set(
			mapRef(to, homeId, uid),
			{ cards: cardsMap([...toCards, card]) },
			{ mergeFields: ["cards"] },
		);
	}
	if (from === "shared") {
		batch.delete(doc(sharedCardsRef(homeId ?? ""), card.id));
	} else {
		batch.set(
			mapRef(from, homeId, uid),
			{ cards: cardsMap(fromCards) },
			{ mergeFields: ["cards"] },
		);
	}
	return batch.commit();
}

/** The member's own list of shared cards they hid, rewritten whole. */
export function saveHiddenShared(
	homeId: string,
	uid: string,
	hiddenSharedIds: readonly string[],
): Promise<void> {
	return replaceField(homeCardsRef(homeId, uid), "hiddenSharedIds", [
		...hiddenSharedIds,
	]);
}

/**
 * A fresh auto-id for a card being composed. Nothing is written — the id is
 * decided here so a card keeps its id when it moves scope, and a scope move
 * cannot leave two copies of it behind. Callers name a real home: a card in
 * the home or shared scope has nowhere to live without one.
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
