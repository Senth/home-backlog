import { useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
	participatingDoneQuery,
	participatingDueQuery,
	sharedDoneQuery,
	sharedDueQuery,
} from "@/data/nodes";
import { useNodes } from "@/hooks/use-nodes";
import { type QueryPair, usePairedListener } from "@/hooks/use-paired-listener";
import type { Node } from "@/models/node";
import { comingUp, ongoingProjects, recentlyDone } from "@/models/overview";

/** What one section of Overview holds, and how to recover from a failure. */
export interface OverviewSection {
	nodes: Node[];
	loading: boolean;
	failed: boolean;
	retry: () => void;
}

/**
 * The three sections of Overview, each independently answered.
 *
 * Six listeners, not eight: the roots pair — `useNodes(homeId, null)`, the
 * root board's own pair — serves both **Ongoing projects** and the
 * root-scoped hide predicate every section needs, so it is not opened again
 * here. Coming up and Recently done add one pair each, for Q3–Q6 in
 * `data/nodes.ts`.
 *
 * A section's own query pair only bounds what *can* arrive; `models/overview.ts`
 * decides what is *shown*, re-filtering with a fresh `now` on every render so a
 * listener that has been open for hours still agrees with its own heading.
 *
 * A section holds on `loading` until every pair it depends on has answered —
 * Coming up and Recently done wait on the roots pair too, because the hide
 * predicate they apply needs it. That is also why each section's `retry`
 * retries the roots pair alongside its own.
 */
export function useOverview(homeId: string | null): {
	ongoing: OverviewSection;
	due: OverviewSection;
	done: OverviewSection;
	roots: Node[];
} {
	const { user } = useAuth();
	const uid = user?.uid ?? null;

	const roots = useNodes(homeId, null);
	const due = useDatedPair(homeId, uid, sharedDueQuery, participatingDueQuery, {
		shared: "Could not load what is coming up",
		participating: "Could not load your own cards coming up",
	});
	const done = useDatedPair(
		homeId,
		uid,
		sharedDoneQuery,
		participatingDoneQuery,
		{
			shared: "Could not load what was recently done",
			participating: "Could not load your own recently done cards",
		},
	);

	// Fresh every render, like a card face's own due chip — the point is the
	// section agreeing with its own heading at the moment it is looked at, not
	// at the moment its listener last fired.
	const now = new Date();

	const retryDue = useCallback(() => {
		roots.retry();
		due.retry();
	}, [roots, due]);
	const retryDone = useCallback(() => {
		roots.retry();
		done.retry();
	}, [roots, done]);

	return {
		// Every unarchived root, in the board's own order — what the FAB ranks a
		// new project against. Overview shows no column, so "the end" can only
		// mean after every root there is, which is where the board's own create
		// would have put it too.
		roots: roots.nodes,
		ongoing: {
			nodes: uid === null ? [] : ongoingProjects(roots.nodes, uid),
			loading: roots.loading,
			failed: roots.failed,
			retry: roots.retry,
		},
		due: {
			nodes: uid === null ? [] : comingUp(due.nodes, roots.nodes, uid, now),
			loading: roots.loading || due.loading,
			failed: roots.failed || due.failed,
			retry: retryDue,
		},
		done: {
			nodes:
				uid === null ? [] : recentlyDone(done.nodes, roots.nodes, uid, now),
			loading: roots.loading || done.loading,
			failed: roots.failed || done.failed,
			retry: retryDone,
		},
	};
}

/**
 * One of Overview's two dated pairs, as `usePairedListener` holds every pair.
 *
 * The only thing a dated pair does differently from a board's is *when* its
 * queries are built: Q3–Q6 close over a `now`, and it is taken at subscribe
 * rather than tracked as a dependency. A listener stays open for hours, and
 * rebuilding the query on every tick would tear it down and reopen it just as
 * often — so `now` is whatever it was when this pair last (re)subscribed, which
 * is exactly what `useOverview` re-filters against on every render.
 */
function useDatedPair(
	homeId: string | null,
	uid: string | null,
	sharedQuery: (homeId: string, now: Date) => ReturnType<typeof sharedDueQuery>,
	participatingQuery: (
		homeId: string,
		now: Date,
		uid: string,
	) => ReturnType<typeof participatingDueQuery>,
	labels: { shared: string; participating: string },
) {
	const build = useCallback((): QueryPair => {
		if (homeId === null || uid === null) return null;

		const now = new Date();
		return {
			shared: sharedQuery(homeId, now),
			participating: participatingQuery(homeId, now, uid),
		};
	}, [homeId, uid, sharedQuery, participatingQuery]);

	// Same NUL-as-an-escape rule as `useNodes`, and for the same reason: a raw
	// byte here makes git store this file as binary, and every review of it then
	// arrives with no diff to read.
	return usePairedListener(`${homeId ?? ""}\u0000${uid ?? ""}`, build, labels);
}
