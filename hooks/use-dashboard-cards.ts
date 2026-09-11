import type { DocumentData, QuerySnapshot } from "firebase/firestore";
import {
	type DocumentReference,
	onSnapshot,
	type Unsubscribe,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
	globalCardsRef,
	homeCardsRef,
	seedGlobalCards,
	sharedCardsRef,
} from "@/data/cards";
import { isQueryAnswer, subscribeWithRetry } from "@/data/live-query";
import { isOnline } from "@/hooks/use-online-status";
import {
	type Card,
	type CardScope,
	cardScopes,
	type EditorCard,
	editorList,
	toCard,
} from "@/models/overview-cards";

/**
 * The card config Overview renders: the three scopes merged into one ordered
 * list, so the screen opens **nine** listeners no matter how many cards exist
 * — the three pairs it already held, plus the two config docs and the home's
 * shared-card collection.
 *
 * Seeding happens here, on the first read of a missing global config: the
 * listener answers from the server that the doc is not there, the seeds are
 * written once with a marker, and the same listener fires again with them.
 * A cache-only miss is held rather than seeded, the same line
 * `hooks/use-node.ts` holds — offline, "not in my cache" is not "not there",
 * and seeding over a server doc would resurrect a seed somebody deleted.
 *
 * Alongside the screen's own list — merged, minus what this member hid — the
 * hook returns the editor's view of the same data: every card with its scope
 * and hide flag (the editor shows a hidden shared card, badged), the scope of
 * each card (the per-card menu is different for a shared one), and the ids
 * this member hid. No listener is opened for any of it.
 */
export function useDashboardCards(homeId: string | null): {
	/** The screen's list: merged, minus the shared cards this member hid. */
	cards: Card[];
	/** Everything, for the editor: each card with its scope and hide flag. */
	editorCards: EditorCard[];
	/** Which surface each card lives on — a shared card's menu is not the same. */
	scopes: Record<string, CardScope>;
	/** The shared card ids this member hid, on their own doc. */
	hiddenSharedIds: string[];
	loading: boolean;
	failed: boolean;
	retry: () => void;
} {
	const { user } = useAuth();
	const uid = user?.uid ?? null;

	const [global, setGlobal] = useState<Card[]>([]);
	const [home, setHome] = useState<Card[]>([]);
	const [hiddenSharedIds, setHiddenSharedIds] = useState<string[]>([]);
	const [shared, setShared] = useState<Card[]>([]);
	const [loaded, setLoaded] = useState({
		global: false,
		home: false,
		shared: false,
	});
	const [failed, setFailed] = useState({
		global: false,
		home: false,
		shared: false,
	});
	const [attempt, setAttempt] = useState(0);

	const key = `${uid ?? ""}\u0000${homeId ?? ""}`;
	const [rendered, setRendered] = useState(key);
	if (rendered !== key) {
		setRendered(key);
		setGlobal([]);
		setHome([]);
		setHiddenSharedIds([]);
		setShared([]);
		setLoaded({ global: false, home: false, shared: false });
		setFailed({ global: false, home: false, shared: false });
		setAttempt(0);
	}

	useEffect(() => {
		// No user is an answer, not a wait: `/homes` is where the ladder sends
		// an account that is signed out, and holding a spinner here hides it.
		if (uid === null) {
			setLoaded({ global: true, home: true, shared: true });
			return;
		}
		setLoaded({ global: false, home: false, shared: false });
		setFailed({ global: false, home: false, shared: false });

		/**
		 * One config document, held the way `use-node.ts` holds one: a
		 * cache-only miss waits for the server, a server miss is an answer,
		 * and only a server answer may trigger seeding.
		 */
		const watchDoc = (
			reference: DocumentReference<DocumentData>,
			scope: "global" | "home",
			onData: (data: Record<string, unknown> | null) => void,
		): Unsubscribe =>
			onSnapshot(
				reference,
				{ includeMetadataChanges: true },
				(snapshot) => {
					if (!snapshot.exists() && snapshot.metadata.fromCache) return;
					onData(snapshot.exists() ? snapshot.data() : null);
					setLoaded((state) => ({ ...state, [scope]: true }));
					setFailed((state) => ({ ...state, [scope]: false }));
				},
				(reason) => {
					// Same shape as `usePairedListener`'s error line: it names which
					// attempt died, so a spent retry ladder is readable in the log.
					console.error(
						`Could not load ${scope} card config, attempt ${attempt + 1}:`,
						reason,
					);
					setLoaded((state) => ({ ...state, [scope]: true }));
					setFailed((state) => ({ ...state, [scope]: true }));
				},
			);

		const cardsIn = (map: unknown): Card[] =>
			Object.entries((map ?? {}) as Record<string, Record<string, unknown>>)
				.map(([id, card]) => toCard(id, card))
				.filter((card): card is Card => card !== null);

		const unsubscribeGlobal = watchDoc(
			globalCardsRef(uid),
			"global",
			(data) => {
				if (data === null) {
					// First read of a missing config. The write lands in the local
					// cache at once, and this listener fires again holding the seeds.
					seedGlobalCards(uid).catch((reason: unknown) => {
						console.error("Could not seed the cards:", reason);
						// The null read already marked global loaded, so without this
						// the screen would sit on zero cards, silently. The same
						// failed flag a spent listener reports drives the same retry.
						setFailed((state) => ({ ...state, global: true }));
					});
					return;
				}
				setGlobal(cardsIn(data.cards));
			},
		);

		let unsubscribeHome: Unsubscribe;
		let unsubscribeShared: Unsubscribe;

		if (homeId === null) {
			// No home yet is not a wait either: there is nothing to ask for.
			setLoaded((state) => ({ ...state, home: true, shared: true }));
			unsubscribeHome = () => {};
			unsubscribeShared = () => {};
		} else {
			unsubscribeHome = watchDoc(homeCardsRef(homeId, uid), "home", (data) => {
				setHome(cardsIn(data?.cards));
				const hidden = data?.hiddenSharedIds;
				setHiddenSharedIds(
					Array.isArray(hidden)
						? hidden.filter((id): id is string => typeof id === "string")
						: [],
				);
			});

			unsubscribeShared = subscribeWithRetry<QuerySnapshot<DocumentData>>(
				(next, error) =>
					onSnapshot(
						sharedCardsRef(homeId),
						{ includeMetadataChanges: true },
						next,
						error,
					),
				(snapshot) => {
					setShared(
						snapshot.docs
							.map((document) => toCard(document.id, document.data()))
							.filter((card): card is Card => card !== null),
					);
					setLoaded((state) => ({ ...state, shared: true }));
					setFailed((state) => ({ ...state, shared: false }));
				},
				(reason) => {
					console.error("Could not load the shared cards:", reason);
					setShared([]);
					setLoaded((state) => ({ ...state, shared: true }));
					setFailed((state) => ({ ...state, shared: true }));
				},
				{ isAnswer: (value) => isQueryAnswer(value, isOnline()) },
			);
		}

		return () => {
			unsubscribeGlobal();
			unsubscribeHome();
			unsubscribeShared();
		};
	}, [uid, homeId, attempt]);

	const editorCards = useMemo(
		() => editorList(global, home, shared, hiddenSharedIds),
		[global, home, shared, hiddenSharedIds],
	);

	const cards = useMemo(
		() =>
			editorCards.filter((entry) => !entry.hidden).map((entry) => entry.card),
		[editorCards],
	);

	const scopes = useMemo(
		() => cardScopes(global, home, shared),
		[global, home, shared],
	);

	const retry = useCallback(() => setAttempt((count) => count + 1), []);

	return {
		cards,
		editorCards,
		scopes,
		hiddenSharedIds,
		loading: !loaded.global || !loaded.home || !loaded.shared,
		failed: failed.global || failed.home || failed.shared,
		retry,
	};
}
