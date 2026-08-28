import {
	type DocumentData,
	onSnapshot,
	type Query,
	type QuerySnapshot,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isQueryAnswer, subscribeWithRetry } from "@/data/live-query";
import { isOnline } from "@/hooks/use-online-status";
import { mergeNodeResults, type Node, toNode } from "@/models/node";

/** What one pair holds, and how to recover from a failure. */
export interface PairedResult {
	nodes: Node[];
	loading: boolean;
	failed: boolean;
	retry: () => void;
}

/** The two halves of one question, or `null` when there is nothing to ask. */
export type QueryPair = {
	shared: Query<DocumentData>;
	participating: Query<DocumentData>;
} | null;

/**
 * Two listeners over one question, merged.
 *
 * **Always two.** Firestore rejects an entire query if any matching document
 * could be denied, so a single listener over a board's children — or over the
 * home's dated nodes — would fail the moment one of them is somebody else's
 * private card. The shared half and the participating half are each provably
 * safe on their own, and the merge puts them back together: deduped, because a
 * shared card I am a participant of matches both.
 *
 * Every caller of this shape wants the same six pieces of state, the same
 * cache-only hold, the same retry ladder and the same merge, and differs only
 * in *which* two queries and what a failed one is called in the console. So it
 * is written once. The board's pair and Overview's two dated pairs are the
 * three callers today.
 *
 * The merge itself lives in `models/node.ts`, where it can be tested without
 * Firestore, and the retry in `data/live-query.ts`. Nothing left here is worth
 * a test; everything left here is subscription lifecycle.
 *
 * Both listeners are torn down whenever `build` changes, which is what stops
 * drilling down a tree from accumulating one pair per level visited. Listener
 * breadth, not data volume, is the cost risk in this app.
 *
 * @param key What this pair is *of* — every input the answer depends on. State
 *   is cleared during render when it changes, not in an effect: an effect runs
 *   after the commit, so the first render of a new board would otherwise paint
 *   the previous board's cards with `loading` already false, and nothing on
 *   screen would even admit they are the wrong ones. Drilling into a task is
 *   exactly that transition.
 * @param build The two queries, called at subscribe time — so a query built
 *   from `new Date()` is built from the instant it is opened. `null` when there
 *   is no home or no user, which is an *answer*, not a wait: `/homes` is where
 *   the active-home ladder sends you, and holding a spinner here would hide it.
 *   Must be stable across renders — a fresh closure every render reopens both
 *   listeners every render.
 * @param labels What the console calls each half once its retries are spent, so
 *   a line names which of the two died rather than only that one did.
 */
export function usePairedListener(
	key: string,
	build: () => QueryPair,
	labels: { shared: string; participating: string },
): PairedResult {
	const [shared, setShared] = useState<Node[]>([]);
	const [participating, setParticipating] = useState<Node[]>([]);
	const [sharedLoaded, setSharedLoaded] = useState(false);
	const [participatingLoaded, setParticipatingLoaded] = useState(false);
	const [sharedFailed, setSharedFailed] = useState(false);
	const [participatingFailed, setParticipatingFailed] = useState(false);
	/**
	 * Which attempt at this pair this is. `retry` bumps it, and the effect below
	 * lists it as a dependency, so bumping it is what opens new listeners.
	 */
	const [attempt, setAttempt] = useState(0);

	const [rendered, setRendered] = useState(key);
	if (rendered !== key) {
		setRendered(key);
		setShared([]);
		setParticipating([]);
		setSharedLoaded(false);
		setParticipatingLoaded(false);
		setSharedFailed(false);
		setParticipatingFailed(false);
		// A different question is a fresh budget, not a continuation of the last
		// one's retries.
		setAttempt(0);
	}

	useEffect(() => {
		const pair = build();
		if (pair === null) {
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

		// Both halves hold on a cache-only empty snapshot for the same reason, and
		// `isOnline()` is read when the snapshot arrives rather than now: going
		// offline *while* holding is exactly the transition that decides it.
		const isAnswer = (snapshot: QuerySnapshot<DocumentData>) =>
			isQueryAnswer(snapshot, isOnline());

		/**
		 * Handled, once the retries are spent: half an answer is still an answer,
		 * and a screen held behind a spinner forever is worse than one missing the
		 * rows it could not read. Not on the first failure though — a Firestore
		 * listener is dead after one, and an empty result that never heals is how a
		 * cold start reads as "nothing here yet" (#101). The screen says which of
		 * the two it is rather than inviting a first card onto a board that already
		 * has forty.
		 */
		const half = (
			listen: Query<DocumentData>,
			label: string,
			setNodes: (nodes: Node[]) => void,
			setFailed: (failed: boolean) => void,
			setLoaded: (loaded: boolean) => void,
		) =>
			subscribeWithRetry<QuerySnapshot<DocumentData>>(
				// `includeMetadataChanges` is what makes the cache-only hold in
				// `isQueryAnswer` releasable — see `hooks/use-node.ts` for the same
				// reason on a single document.
				(next, error) =>
					onSnapshot(listen, { includeMetadataChanges: true }, next, error),
				(snapshot) => {
					setNodes(snapshot.docs.map(toNode));
					setFailed(false);
					setLoaded(true);
				},
				(reason) => {
					console.error(`${label}, attempt ${attempt + 1}:`, reason);
					setNodes([]);
					setFailed(true);
					setLoaded(true);
				},
				{ isAnswer },
			);

		const unsubscribeShared = half(
			pair.shared,
			labels.shared,
			setShared,
			setSharedFailed,
			setSharedLoaded,
		);
		const unsubscribeParticipating = half(
			pair.participating,
			labels.participating,
			setParticipating,
			setParticipatingFailed,
			setParticipatingLoaded,
		);

		return () => {
			unsubscribeShared();
			unsubscribeParticipating();
		};
	}, [build, attempt, labels.shared, labels.participating]);

	const nodes = useMemo(
		() => mergeNodeResults(shared, participating),
		[shared, participating],
	);

	const retry = useCallback(() => setAttempt((count) => count + 1), []);

	const loading = !sharedLoaded || !participatingLoaded;

	return {
		nodes,
		loading,
		// Either half failing makes the answer incomplete, and an incomplete board
		// is not one to invite a first card onto.
		//
		// Never *while* loading, though: the halves give up independently, so one
		// of them spending its retries while the other is still connecting would
		// otherwise draw a spinner and "could not load" at once — over a Try again
		// that would tear down the half still on its way.
		failed: !loading && (sharedFailed || participatingFailed),
		retry,
	};
}
