import { useAuth } from "@/contexts/AuthContext";
import {
	participatingDoneQuery,
	participatingPoolQuery,
	sharedDoneQuery,
	sharedPoolQuery,
} from "@/data/nodes";
import { useCalendarDay } from "@/hooks/use-calendar-day";
import { useNodes } from "@/hooks/use-nodes";
import { useOverviewPair } from "@/hooks/use-overview";
import type { BoardReach } from "@/models/board-filter";
import { compareNodes, type Node } from "@/models/node";
import { doneWithinDays } from "@/models/overview";

/**
 * What a board holds at the reach the filter names (D2): **this board** is the
 * board's own pair, its children; **everything below** is Overview's pool pair
 * and done pair (Q1), filtered client-side on the ancestor trail — no new
 * query, no new composite index, and the documents are warm in the same cache
 * Overview already fills. On the root board there is no ancestor test, because
 * everything below the root *is* the home.
 *
 * The done arm of subtree reach is the windowed pair (phase 3), floored at
 * `doneWithinDays` — the board has no card config to widen it with — which is
 * why the Done column says its bound (`Column`'s footer) and switching reach
 * can make a done card disappear.
 *
 * `pool` is everything the open listeners hold, unordered: the list the
 * per-card label chains resolve against (`useLabelAncestors` takes it as its
 * pool), not the list the board draws.
 */
export function useBoardNodes(
	homeId: string | null,
	parentId: string | null,
	reach: BoardReach,
): {
	/** The cards the board draws, in `(rank, id)` order. */
	nodes: Node[];
	/** Everything the open listeners hold, unordered. */
	pool: Node[];
	loading: boolean;
	failed: boolean;
	retry: () => void;
} {
	const { user } = useAuth();
	const uid = user?.uid ?? null;
	// Only the done pair carries a `now`, so only it moves when the day does —
	// the same turnover rule Overview's done pair runs on.
	const day = useCalendarDay();

	const board = useNodes(homeId, parentId, reach === "board");
	const poolPair = useOverviewPair(
		homeId,
		uid,
		sharedPoolQuery,
		participatingPoolQuery,
		{
			shared: "Could not load the household's open cards",
			participating: "Could not load your own open cards",
		},
		null,
		null,
		reach === "subtree",
	);
	const donePair = useOverviewPair(
		homeId,
		uid,
		sharedDoneQuery,
		participatingDoneQuery,
		{
			shared: "Could not load what was recently done",
			participating: "Could not load your own recently done cards",
		},
		day,
		doneWithinDays,
		reach === "subtree",
	);

	if (reach === "board") {
		return {
			nodes: board.nodes,
			pool: board.nodes,
			loading: board.loading,
			failed: board.failed,
			retry: board.retry,
		};
	}

	const pool = [...poolPair.nodes, ...donePair.nodes];
	return {
		nodes: subtreeNodes(pool, parentId),
		pool,
		loading: poolPair.loading || donePair.loading,
		// Either pair failing makes the answer incomplete, the same rule one
		// board half failing runs on.
		failed: poolPair.failed || donePair.failed,
		retry: () => {
			poolPair.retry();
			donePair.retry();
		},
	};
}

/**
 * The subtree of `parentId` out of the pool, in the board's own `(rank, id)`
 * order — the pool is unordered, so the sort here is what keeps a card from
 * jumping when it re-enters the pool pair's answer. The root board applies
 * **no** ancestor test: every card in the home is below the root by
 * definition, and an `ancestorIds.includes(null)` would be a lie that
 * happened to match nothing.
 */
export function subtreeNodes(
	pool: readonly Node[],
	parentId: string | null,
): Node[] {
	const below =
		parentId === null
			? pool
			: pool.filter((node) => node.ancestorIds.includes(parentId));
	return [...below].sort(compareNodes);
}
