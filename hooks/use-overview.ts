import type { DocumentData, Query } from "firebase/firestore";
import { useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
	participatingDoneQuery,
	participatingPoolQuery,
	sharedDoneQuery,
	sharedPoolQuery,
} from "@/data/nodes";
import { useNodes } from "@/hooks/use-nodes";
import {
	type PairedResult,
	type QueryPair,
	usePairedListener,
} from "@/hooks/use-paired-listener";

/**
 * The three listener pairs Overview is built from, each independently
 * answered — **nine listeners in all**, once the card config joins them.
 *
 * - the roots pair (`useNodes(homeId, null)`): the root board's own pair,
 *   which the FAB ranks against and every card's hide predicate reads;
 * - the pool pair: every open node in the home, unordered and unbounded — the
 *   open set each filter card is a client-side `.filter().sort().slice()`
 *   over;
 * - the done pair: what was completed inside the recent window, which only
 *   the *completed* card reads, the pool excluding it by definition.
 *
 * A pair only bounds what *can* arrive; `models/overview-cards.ts` decides
 * what is *shown*, re-filtering with a fresh `now` on every render so a
 * listener that has been open for hours still agrees with its own heading.
 */
export function useOverview(homeId: string | null): {
	roots: PairedResult;
	pool: PairedResult;
	done: PairedResult;
} {
	const { user } = useAuth();
	const uid = user?.uid ?? null;

	const roots = useNodes(homeId, null);
	const pool = useOverviewPair(
		homeId,
		uid,
		sharedPoolQuery,
		participatingPoolQuery,
		{
			shared: "Could not load the household's open cards",
			participating: "Could not load your own open cards",
		},
	);
	const done = useOverviewPair(
		homeId,
		uid,
		sharedDoneQuery,
		participatingDoneQuery,
		{
			shared: "Could not load what was recently done",
			participating: "Could not load your own recently done cards",
		},
	);

	return { roots, pool, done };
}

/**
 * One of Overview's three pairs, as `usePairedListener` holds every pair.
 *
 * The queries themselves take no arguments beyond the home and, for the
 * participating arm, the uid: the pool pair has no `now` in it at all — it is
 * the whole open set, narrowed on screen — and the done pair takes its `now`
 * when the query is built, which is at subscribe.
 */
function useOverviewPair(
	homeId: string | null,
	uid: string | null,
	sharedQuery: (homeId: string) => Query<DocumentData>,
	participatingQuery: (homeId: string, uid: string) => Query<DocumentData>,
	labels: { shared: string; participating: string },
) {
	const build = useCallback((): QueryPair => {
		if (homeId === null || uid === null) return null;

		return {
			shared: sharedQuery(homeId),
			participating: participatingQuery(homeId, uid),
		};
	}, [homeId, uid, sharedQuery, participatingQuery]);

	// Same NUL-as-an-escape rule as `useNodes`, and for the same reason: a raw
	// byte here makes git store this file as binary, and every review of it then
	// arrives with no diff to read.
	return usePairedListener(`${homeId ?? ""}\u0000${uid ?? ""}`, build, labels);
}
