import {
	type DocumentData,
	onSnapshot,
	type QuerySnapshot,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { isQueryAnswer, subscribeWithRetry } from "@/data/live-query";
import { participatingBoardQuery, sharedBoardQuery } from "@/data/nodes";
import { isOnline } from "@/hooks/use-online-status";
import { mergeNodeResults, type Node, toNode } from "@/models/node";

/**
 * One board: the children of `parentId`, or of the root when it is null.
 *
 * Two listeners, always. Firestore rejects an entire query if any matching
 * document could be denied, so a single listener over the children would fail
 * the moment one of them is somebody else's private card. The shared half and
 * the participating half are each provably safe on their own, and the merge
 * puts them back together — deduped, because a shared card I am a participant
 * of matches both.
 *
 * The merge itself lives in `models/node.ts`, where it can be tested without
 * Firestore, and the retry in `data/live-query.ts`. Nothing left here is worth
 * a test; everything left here is subscription lifecycle.
 *
 * Both listeners are torn down whenever the board changes, which is what stops
 * drilling down a tree from accumulating one pair per level visited. Listener
 * breadth, not data volume, is the cost risk in this app.
 */
export function useNodes(
	homeId: string | null,
	parentId: string | null,
): { nodes: Node[]; loading: boolean; failed: boolean; retry: () => void } {
	const { user } = useAuth();
	const uid = user?.uid ?? null;

	const [shared, setShared] = useState<Node[]>([]);
	const [participating, setParticipating] = useState<Node[]>([]);
	const [sharedLoaded, setSharedLoaded] = useState(false);
	const [participatingLoaded, setParticipatingLoaded] = useState(false);
	const [sharedFailed, setSharedFailed] = useState(false);
	const [participatingFailed, setParticipatingFailed] = useState(false);
	/**
	 * Which attempt at this board this is. `retry` bumps it, and the effect below
	 * lists it as a dependency, so bumping it is what opens new listeners.
	 */
	const [attempt, setAttempt] = useState(0);

	// Cleared *during render*, not in the effect below. An effect runs after the
	// commit, so the first render of a new board would otherwise paint the
	// previous board's cards — with `loading` already false, so nothing on
	// screen would even admit they are the wrong ones. Drilling into a task is
	// exactly that transition.
	//
	// The three parts are joined on NUL written as an *escape*, never as a raw
	// byte: a literal NUL in the source makes git treat the whole file as binary,
	// and every change to this hook then arrives in review as
	// `Bin 3757 -> 5342 bytes`, with not one line of diff to read.
	const board = `${homeId ?? ""}\u0000${parentId ?? ""}\u0000${uid ?? ""}`;
	const [rendered, setRendered] = useState(board);
	if (rendered !== board) {
		setRendered(board);
		setShared([]);
		setParticipating([]);
		setSharedLoaded(false);
		setParticipatingLoaded(false);
		setSharedFailed(false);
		setParticipatingFailed(false);
		// A different board is a fresh budget, not a continuation of the last
		// board's retries.
		setAttempt(0);
	}

	useEffect(() => {
		// No home or no user is an answer, not a wait: `/homes` is where the
		// active-home ladder sends you, and holding a spinner here would hide it.
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

		// Both halves hold on a cache-only empty snapshot for the same reason, and
		// `isOnline()` is read when the snapshot arrives rather than now: going
		// offline *while* holding is exactly the transition that decides it.
		const isAnswer = (snapshot: QuerySnapshot<DocumentData>) =>
			isQueryAnswer(snapshot, isOnline());

		const unsubscribeShared = subscribeWithRetry<QuerySnapshot<DocumentData>>(
			// `includeMetadataChanges` is what makes the cache-only hold in
			// `isQueryAnswer` releasable — see `hooks/use-node.ts` for the same
			// reason on a single document.
			(next, error) =>
				onSnapshot(
					sharedBoardQuery(homeId, parentId),
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
				// Handled, once the retries are spent: half a board is still a board,
				// and a screen held behind a spinner forever is worse than one missing
				// the cards it could not read. Not on the first failure though — a
				// Firestore listener is dead after one, and an empty board that never
				// heals is how a cold start reads as "nothing here yet" (#101). The
				// board says which of the two it is rather than inviting a first card
				// onto a board that already has forty.
				console.error(
					`Could not load this board, attempt ${attempt + 1}:`,
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
					participatingBoardQuery(homeId, parentId, uid),
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
					`Could not load your cards on this board, attempt ${attempt + 1}:`,
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
	}, [homeId, parentId, uid, attempt]);

	const nodes = useMemo(
		() => mergeNodeResults(shared, participating),
		[shared, participating],
	);

	const retry = useCallback(() => setAttempt((count) => count + 1), []);

	const loading = !sharedLoaded || !participatingLoaded;

	return {
		nodes,
		loading,
		// Either half failing makes the board incomplete, and an incomplete board
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
