import { useAuth } from "@/contexts/AuthContext";
import { useDashboardCardsConfig } from "@/contexts/DashboardCardsContext";
import { useHome } from "@/contexts/HomeContext";
import {
	deleteScopeCard,
	moveScopeCard,
	newCardId,
	saveScopeCards,
} from "@/data/cards";
import { rankAtEnd } from "@/models/node";
import type { Card, CardScope } from "@/models/overview-cards";

/**
 * The writes behind the editor and the add/edit page: add, remove, replace,
 * move scope, and compose a fresh card onto a surface.
 *
 * One hook rather than two copies of the same guards — both callers read the
 * same card-config context, the same home and the same user, and a scope the
 * caller cannot write to (no uid, or no active home for a home-scoped card)
 * writes nothing. Every write queues offline like any other.
 */
export function useCardWrites() {
	const { user } = useAuth();
	const { activeHome } = useHome();
	const { editorCards } = useDashboardCardsConfig();

	const homeId = activeHome?.id ?? null;
	const uid = user?.uid ?? null;

	const couldNotSave = (reason: unknown) =>
		console.error("Could not save the cards:", reason);

	/** Every card stored on one surface, in the editor's order. */
	const surfaceCards = (scope: CardScope): Card[] =>
		editorCards
			.filter((entry) => entry.scope === scope)
			.map((entry) => entry.card);

	/**
	 * The ids a write on this surface needs, or `null` when there is nothing
	 * to write to: no uid, or no active home for a scope that lives in one.
	 * `homes//dashboards/{uid}` is not a path Firestore declines politely —
	 * it is a synchronous crash — so the guard runs before any reference is
	 * built.
	 */
	const idsFor = (scope: CardScope): { homeId: string; uid: string } | null => {
		if (uid === null) return null;
		if (scope !== "global" && homeId === null) return null;
		return { homeId: homeId ?? "", uid };
	};

	const addTo = (scope: CardScope, card: Card) => {
		const ids = idsFor(scope);
		if (ids === null) return;
		saveScopeCards(scope, ids.homeId, ids.uid, [
			...surfaceCards(scope),
			card,
		]).catch(couldNotSave);
	};

	const removeFrom = (scope: CardScope, id: string) => {
		const ids = idsFor(scope);
		if (ids === null) return;
		deleteScopeCard(scope, ids.homeId, ids.uid, id, surfaceCards(scope)).catch(
			couldNotSave,
		);
	};

	/** An edit or a reorder that stays on its own surface. */
	const replaceIn = (scope: CardScope, card: Card) => {
		const ids = idsFor(scope);
		if (ids === null) return;
		saveScopeCards(
			scope,
			ids.homeId,
			ids.uid,
			surfaceCards(scope).map((each) => (each.id === card.id ? card : each)),
		).catch(couldNotSave);
	};

	/** Scope is where the card is stored, so changing scope moves the card. */
	const moveScope = (card: Card, from: CardScope, to: CardScope) => {
		const fromIds = idsFor(from);
		const toIds = idsFor(to);
		if (fromIds === null || toIds === null) return;
		moveScopeCard(
			card,
			from,
			to,
			toIds.homeId,
			toIds.uid,
			surfaceCards(from).filter((each) => each.id !== card.id),
			surfaceCards(to),
		).catch(couldNotSave);
	};

	/**
	 * A card just composed: minted here so a later scope move keeps it, and
	 * it takes the last place on the screen.
	 */
	const createIn = (scope: CardScope, draft: Omit<Card, "id" | "rank">) => {
		const ids = idsFor(scope);
		if (ids === null) return;
		addTo(scope, {
			...draft,
			id: newCardId(scope, ids.homeId, ids.uid),
			rank: rankAtEnd(editorCards.at(-1)?.card.rank ?? null),
		});
	};

	return { addTo, removeFrom, replaceIn, moveScope, createIn };
}
