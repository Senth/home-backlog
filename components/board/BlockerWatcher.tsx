import { useEffect } from "react";
import { useNode } from "@/hooks/use-node";
import type { Node } from "@/models/node";

interface BlockerWatcherProps {
	homeId: string;
	/**
	 * The blocker ids no card on this board carries — `crossBoardBlockerIds`,
	 * already deduped. Same-board blockers are not here: the board's own query
	 * pair carries their status columns.
	 */
	ids: readonly string[];
	/** Called as each watched document answers. Keep it stable. */
	onStatus: (id: string, blocker: Node | null) => void;
}

/**
 * The board's eyes on blockers that live somewhere else, rendered once per
 * board screen and invisible: one child per id, each a single-document
 * `useNode` listener — the app's existing single-document pattern, which
 * cannot be query-denied the way a multi-document query can. Deduped across
 * cards, and torn down with the screen.
 *
 * Reporting follows `useNode`'s own degradation:
 *
 * - a document that loaded reports its `Node`;
 * - a server-confirmed missing or refused one reports `null` — gone;
 * - a cache-only "not there" reports nothing at all and the card it holds
 *   keeps waiting, because offline "not in the cache" is not "not there".
 *
 * Either way the not-yet direction holds: an unanswered blocker keeps its
 * card marked, and only a person unmarking it ends the wait.
 */
export function BlockerWatcher({ homeId, ids, onStatus }: BlockerWatcherProps) {
	return (
		<>
			{ids.map((id) => (
				<BlockerStatus key={id} homeId={homeId} id={id} onStatus={onStatus} />
			))}
		</>
	);
}

function BlockerStatus({
	homeId,
	id,
	onStatus,
}: {
	homeId: string;
	id: string;
	onStatus: (id: string, blocker: Node | null) => void;
}) {
	const { node, gone } = useNode(homeId, id);

	useEffect(() => {
		if (node !== null) onStatus(id, node);
		else if (gone) onStatus(id, null);
	}, [id, node, gone, onStatus]);

	return null;
}
