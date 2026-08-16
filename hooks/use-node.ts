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
			// `includeMetadataChanges` is what makes the hold below releasable. A
			// document that is missing in the cache *and* missing on the server
			// never changes, so the server's confirmation is a metadata-only event
			// — and Firestore suppresses those by default. Without this, a card
			// deleted in this session and then opened by URL sat on a spinner for
			// ever: the cache said "not there", the hold waited for a server answer
			// that was never going to be delivered.
			{ includeMetadataChanges: true },
			(snapshot) => {
				// "Not in the cache" is not "not there". Offline, a document that was
				// never opened while online resolves immediately as missing — a shared
				// link, a bookmark or a reload — and calling that gone would announce
				// a deletion that did not happen. Hold instead, until a server answer
				// arrives with the connection.
				if (!snapshot.exists() && snapshot.metadata.fromCache) {
					setLoading(false);
					return;
				}

				setNode(snapshot.exists() ? toNode(snapshot) : null);
				setGone(!snapshot.exists());
				setLoading(false);
			},
			(reason) => {
				// A refusal is the *answer* this hook is documented to treat as
				// "gone", so it is not also a failure to log. It arrives whenever
				// somebody opens a private card they are not on by URL, and in
				// development an unhandled console error is drawn over the screen as
				// a raw `FirebaseError: evaluation error at L381` — on top of the
				// honest "That card is gone." the bounce already said. Anything else
				// really is unexpected and keeps its entry.
				if (!isDenied(reason)) {
					console.error("Could not load this board's card:", reason);
				}
				setNode(null);
				setGone(true);
				setLoading(false);
			},
		);
	}, [homeId, nodeId]);

	return { node, loading, gone };
}

/** A read the rules refused, which here is a fact rather than a fault. */
function isDenied(reason: unknown): boolean {
	return (reason as { code?: string } | null)?.code === "permission-denied";
}
