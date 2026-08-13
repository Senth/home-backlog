import { onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { participatingBoardQuery, sharedBoardQuery } from "@/data/nodes";
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
 * Firestore. Nothing here is worth a test; everything here is subscription
 * lifecycle.
 *
 * Both listeners are torn down whenever the board changes, which is what stops
 * drilling down a tree from accumulating one pair per level visited. Listener
 * breadth, not data volume, is the cost risk in this app.
 */
export function useNodes(
	homeId: string | null,
	parentId: string | null,
): { nodes: Node[]; loading: boolean } {
	const { user } = useAuth();
	const uid = user?.uid ?? null;

	const [shared, setShared] = useState<Node[]>([]);
	const [participating, setParticipating] = useState<Node[]>([]);
	const [sharedLoaded, setSharedLoaded] = useState(false);
	const [participatingLoaded, setParticipatingLoaded] = useState(false);

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

		const unsubscribeShared = onSnapshot(
			sharedBoardQuery(homeId, parentId),
			(snapshot) => {
				setShared(snapshot.docs.map(toNode));
				setSharedLoaded(true);
			},
			(reason) => {
				// Handled: half a board is still a board, and a screen held behind a
				// spinner forever is worse than one missing the cards it could not
				// read. The failure is logged where it can be found.
				console.error("Could not load this board:", reason);
				setShared([]);
				setSharedLoaded(true);
			},
		);

		const unsubscribeParticipating = onSnapshot(
			participatingBoardQuery(homeId, parentId, uid),
			(snapshot) => {
				setParticipating(snapshot.docs.map(toNode));
				setParticipatingLoaded(true);
			},
			(reason) => {
				console.error("Could not load your cards on this board:", reason);
				setParticipating([]);
				setParticipatingLoaded(true);
			},
		);

		return () => {
			unsubscribeShared();
			unsubscribeParticipating();
		};
	}, [homeId, parentId, uid]);

	const nodes = useMemo(
		() => mergeNodeResults(shared, participating),
		[shared, participating],
	);

	return { nodes, loading: !sharedLoaded || !participatingLoaded };
}
