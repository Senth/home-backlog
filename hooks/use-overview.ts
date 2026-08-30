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
 * here. The pool pair and Recently done add one pair each, for Q3–Q6 in
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
	const due = useOverviewPair(
		homeId,
		uid,
		sharedPoolQuery,
		participatingPoolQuery,
		{
			shared: "Could not load what is coming up",
			participating: "Could not load your own cards coming up",
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
 * One of Overview's two pairs, as `usePairedListener` holds every pair.
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
