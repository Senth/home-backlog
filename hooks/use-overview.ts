import type { DocumentData, Query } from "firebase/firestore";
import { useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useDashboardCardsConfig } from "@/contexts/DashboardCardsContext";
import {
	participatingDoneQuery,
	participatingPoolQuery,
	sharedDoneQuery,
	sharedPoolQuery,
} from "@/data/nodes";
import { useCalendarDay } from "@/hooks/use-calendar-day";
import { useNodes } from "@/hooks/use-nodes";
import {
	type PairedResult,
	type QueryPair,
	usePairedListener,
} from "@/hooks/use-paired-listener";
import type { CardCondition } from "@/models/filter";
import {
	doneWindow,
	doneWithinDays,
	maxDoneWithinDays,
} from "@/models/overview";

/**
 * The three listener pairs Overview is built from, each independently
 * answered — **nine listeners in all**, once the card config joins them.
 *
 * - the roots pair (`useNodes(homeId, null)`): the root board's own pair,
 *   which the FAB ranks against and every card's hide predicate reads;
 * - the pool pair: every open node in the home, unordered and unbounded — the
 *   open set each filter card is a client-side `.filter().sort().slice()`
 *   over;
 * - the done pair: what was completed inside the widest window any done-mode
 *   card wants (`doneWindow` over the card config), which the done cards
 *   read, the pool excluding it by definition.
 *
 * A pair only bounds what *can* arrive; `models/overview-cards.ts` decides
 * what is *shown*, re-filtering with a fresh `now` on every render so a
 * listener that has been open for hours still agrees with its own heading.
 * The bound has a known cost — conditions filter after the limit — so the
 * done fetch runs to `doneFetchLimit` rows per arm, a budget and not a
 * display promise.
 */
export function useOverview(homeId: string | null): {
	roots: PairedResult;
	pool: PairedResult;
	done: PairedResult;
} {
	const { user } = useAuth();
	const uid = user?.uid ?? null;
	const { cards } = useDashboardCardsConfig();
	// Only the done pair carries a `now`, so only it moves when the day does.
	const day = useCalendarDay();

	// The widest window any done card asks for. A done card with no
	// `completedAt` condition asks for the whole done set, so its window is
	// the ceiling itself; one that carries the condition names its own `n`,
	// defaulting to the seed window when the `n` is absent.
	const window = doneWindow(
		cards.flatMap((card) => {
			if (card.kind !== "done") return [];
			const within = card.conditions.find(
				(
					condition,
				): condition is Extract<CardCondition, { field: "completedAt" }> =>
					condition.field === "completedAt",
			);
			return [within ? (within.n ?? doneWithinDays) : maxDoneWithinDays];
		}),
	);

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
		day,
		window,
	);

	return { roots, pool, done };
}

/**
 * One of Overview's three pairs, as `usePairedListener` holds every pair.
 *
 * The queries themselves take no arguments beyond the home and, for the
 * participating arm, the uid — except the done pair's window, which rides
 * through to both done queries and into the key, so a card config edit that
 * widens or narrows the window re-opens the pair. The pool pair has no `now`
 * in it at all — it is the whole open set, narrowed on screen — and the done
 * pair takes its `now` when the query is built, which is at subscribe. The
 * done pair's `day` rides in the key and in `build`'s dependencies, which is
 * what re-asks `doneSince(now)` at the day turnover instead of whenever a
 * render happens to come.
 *
 * Exported because the board's subtree reach (#62) is the fourth caller of
 * this exact shape — the pool pair and the done pair, reached from a board —
 * and forking the wiring would fork the retry ladder with it. `enabled`
 * (board reach) keeps a pair's listeners closed without unmounting the hook
 * that holds it: a reach switch re-keys the pair, which is what clears the
 * previous reach's rows.
 */
export function useOverviewPair(
	homeId: string | null,
	uid: string | null,
	sharedQuery: (homeId: string, days?: number) => Query<DocumentData>,
	participatingQuery: (
		homeId: string,
		uid: string,
		days?: number,
	) => Query<DocumentData>,
	labels: { shared: string; participating: string },
	/** Only the done pair carries one; the pool pair takes none, on purpose. */
	day: string | null = null,
	/** Only the done pair carries one; the pool pair leaves it out. */
	days: number | null = null,
	/** False keeps the pair closed — an answer of "nothing", not a wait. */
	enabled = true,
) {
	// biome-ignore lint/correctness/useExhaustiveDependencies: the day never enters a query — it is what re-opens the done pair, so `doneSince` is re-asked at the turnover, not at some render.
	const build = useCallback((): QueryPair => {
		if (!enabled || homeId === null || uid === null) return null;

		return {
			shared: sharedQuery(homeId, days ?? undefined),
			participating: participatingQuery(homeId, uid, days ?? undefined),
		};
	}, [enabled, homeId, uid, sharedQuery, participatingQuery, day, days]);

	// Same NUL-as-an-escape rule as `useNodes`, and for the same reason: a raw
	// byte here makes git store this file as binary, and every review of it then
	// arrives with no diff to read.
	return usePairedListener(
		`${homeId ?? ""}\u0000${uid ?? ""}\u0000${day ?? ""}\u0000${days ?? ""}\u0000${enabled ? "open" : "off"}`,
		build,
		labels,
	);
}
