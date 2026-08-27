import {
	type DocumentData,
	onSnapshot,
	type Query,
	type QuerySnapshot,
} from "firebase/firestore";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { isQueryAnswer, subscribeWithRetry } from "@/data/live-query";
import {
	participatingDoneQuery,
	participatingDueQuery,
	sharedDoneQuery,
	sharedDueQuery,
} from "@/data/nodes";
import { useNodes } from "@/hooks/use-nodes";
import { isOnline } from "@/hooks/use-online-status";
import { mergeNodeResults, type Node, toNode } from "@/models/node";
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
	const due = usePairedQuery(
		homeId,
		uid,
		sharedDueQuery,
		participatingDueQuery,
	);
	const done = usePairedQuery(
		homeId,
		uid,
		sharedDoneQuery,
		participatingDoneQuery,
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
 * One query pair, merged — the same shape as `useNodes`, parameterized by
 * query builders instead of a `parentId`.
 *
 * Not `useNodes` itself: Q3–Q6 are built from `now` rather than a board's
 * `parentId`, and `now` is captured once per subscribe rather than tracked as
 * a dependency — a listener stays open for hours, and rebuilding the query on
 * every tick would tear it down and reopen it just as often. `now` is instead
 * whatever it was when this pair last (re)subscribed, which is exactly what
 * the docstring on `useOverview` re-filters against.
 */
function usePairedQuery(
	homeId: string | null,
	uid: string | null,
	sharedQuery: (homeId: string, now: Date) => Query<DocumentData>,
	participatingQuery: (
		homeId: string,
		now: Date,
		uid: string,
	) => Query<DocumentData>,
): { nodes: Node[]; loading: boolean; failed: boolean; retry: () => void } {
	const [shared, setShared] = useState<Node[]>([]);
	const [participating, setParticipating] = useState<Node[]>([]);
	const [sharedLoaded, setSharedLoaded] = useState(false);
	const [participatingLoaded, setParticipatingLoaded] = useState(false);
	const [sharedFailed, setSharedFailed] = useState(false);
	const [participatingFailed, setParticipatingFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);

	// Same NUL-joined key as `useNodes` — NUL as an *escape*, never a raw byte,
	// or git stores this file as binary and every review of it arrives with no
	// diff to read. Cleared during render rather than in an
	// effect, and for the same reason: a fresh home or user must not paint the
	// previous one's rows with `loading` already false.
	const key = `${homeId ?? ""}\u0000${uid ?? ""}`;
	const [rendered, setRendered] = useState(key);
	if (rendered !== key) {
		setRendered(key);
		setShared([]);
		setParticipating([]);
		setSharedLoaded(false);
		setParticipatingLoaded(false);
		setSharedFailed(false);
		setParticipatingFailed(false);
		setAttempt(0);
	}

	useEffect(() => {
		if (homeId === null || uid === null) {
			setShared([]);
			setParticipating([]);
			setSharedLoaded(true);
			setParticipatingLoaded(true);
			return;
		}

		setSharedLoaded(false);
		setParticipatingLoaded(false);
		setSharedFailed(false);
		setParticipatingFailed(false);

		const now = new Date();
		const isAnswer = (snapshot: QuerySnapshot<DocumentData>) =>
			isQueryAnswer(snapshot, isOnline());

		const unsubscribeShared = subscribeWithRetry<QuerySnapshot<DocumentData>>(
			(next, error) =>
				onSnapshot(
					sharedQuery(homeId, now),
					{ includeMetadataChanges: true },
					next,
					error,
				),
			(snapshot) => {
				setShared(snapshot.docs.map(toNode));
				setSharedFailed(false);
				setSharedLoaded(true);
			},
			(reason) => {
				console.error(
					`Could not load Overview, attempt ${attempt + 1}:`,
					reason,
				);
				setShared([]);
				setSharedFailed(true);
				setSharedLoaded(true);
			},
			{ isAnswer },
		);

		const unsubscribeParticipating = subscribeWithRetry<
			QuerySnapshot<DocumentData>
		>(
			(next, error) =>
				onSnapshot(
					participatingQuery(homeId, now, uid),
					{ includeMetadataChanges: true },
					next,
					error,
				),
			(snapshot) => {
				setParticipating(snapshot.docs.map(toNode));
				setParticipatingFailed(false);
				setParticipatingLoaded(true);
			},
			(reason) => {
				console.error(
					`Could not load Overview, attempt ${attempt + 1}:`,
					reason,
				);
				setParticipating([]);
				setParticipatingFailed(true);
				setParticipatingLoaded(true);
			},
			{ isAnswer },
		);

		return () => {
			unsubscribeShared();
			unsubscribeParticipating();
		};
	}, [homeId, uid, attempt, sharedQuery, participatingQuery]);

	const nodes = mergeNodeResults(shared, participating);
	const retry = useCallback(() => setAttempt((count) => count + 1), []);
	const loading = !sharedLoaded || !participatingLoaded;

	return {
		nodes,
		loading,
		failed: !loading && (sharedFailed || participatingFailed),
		retry,
	};
}
