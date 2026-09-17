import { useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { participatingBoardQuery, sharedBoardQuery } from "@/data/nodes";
import {
	type PairedResult,
	type QueryPair,
	usePairedListener,
} from "@/hooks/use-paired-listener";

/**
 * One board: the children of `parentId`, or of the root when it is null.
 *
 * Q1 and Q2, as the pair `usePairedListener` opens — two listeners because
 * Firestore rejects an entire query if any matching document could be denied,
 * and the shared half and the participating half are each provably safe on
 * their own. Everything about *how* a pair is held lives there; this hook is
 * only which two queries a board is, and what to call each half in the console.
 */
export function useNodes(
	homeId: string | null,
	parentId: string | null,
	/** False keeps the pair closed — the board's subtree reach (#62) asks the
	 *  pool pair and the done pair instead, and this one stays shut. */
	enabled = true,
): PairedResult {
	const { user } = useAuth();
	const uid = user?.uid ?? null;

	const build = useCallback(
		(): QueryPair =>
			!enabled || homeId === null || uid === null
				? null
				: {
						shared: sharedBoardQuery(homeId, parentId),
						participating: participatingBoardQuery(homeId, parentId, uid),
					},
		[enabled, homeId, parentId, uid],
	);

	// The three parts are joined on NUL written as an *escape*, never as a raw
	// byte: a literal NUL in the source makes git treat the whole file as binary,
	// and every change to this hook then arrives in review as
	// `Bin 3757 -> 5342 bytes`, with not one line of diff to read.
	return usePairedListener(
		`${homeId ?? ""}\u0000${parentId ?? ""}\u0000${uid ?? ""}\u0000${enabled ? "open" : "off"}`,
		build,
		{
			shared: "Could not load this board",
			participating: "Could not load your cards on this board",
		},
	);
}
