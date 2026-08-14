import { onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { nodeRef } from "@/data/nodes";
import { type Node, toNode } from "@/models/node";

/**
 * The board's own node — one constrained, single-document listener.
 *
 * A listener rather than a one-shot read, because two things happen *while* you
 * are looking at a board: somebody renames it, and somebody deletes it.
 * `deleteNode` takes the whole subtree, so the card whose board you are on can
 * stop existing under you, and a board that no longer exists must bounce you to
 * its parent rather than sit there empty.
 *
 * **Not found and permission-denied are the same answer.** Both mean "this is
 * not a board you can be on", and telling them apart would leak that a card
 * exists — which is the whole point of a private card. A read that fails for a
 * third reason lands here too, and bouncing up one level is the right answer to
 * all three.
 */
export function useNode(
	homeId: string | null,
	nodeId: string | null,
): { node: Node | null; loading: boolean; gone: boolean } {
	const [node, setNode] = useState<Node | null>(null);
	const [loading, setLoading] = useState(true);
	const [gone, setGone] = useState(false);

	// Cleared *during render*, the same way `useNodes` clears a board: an effect
	// runs after the commit, so the first render of a new card would otherwise
	// paint the previous one's title with `loading` already false.
	const key = `${homeId ?? ""} ${nodeId ?? ""}`;
	const [rendered, setRendered] = useState(key);
	if (rendered !== key) {
		setRendered(key);
		setNode(null);
		setLoading(true);
		setGone(false);
	}

	useEffect(() => {
		// The root board has no document. That is an answer, not a wait.
		if (homeId === null || nodeId === null) {
			setNode(null);
			setLoading(false);
			setGone(false);
			return;
		}

		setLoading(true);

		return onSnapshot(
			nodeRef(homeId, nodeId),
			(snapshot) => {
				setNode(snapshot.exists() ? toNode(snapshot) : null);
				setGone(!snapshot.exists());
				setLoading(false);
			},
			(reason) => {
				console.error("Could not load this board's card:", reason);
				setNode(null);
				setGone(true);
				setLoading(false);
			},
		);
	}, [homeId, nodeId]);

	return { node, loading, gone };
}
