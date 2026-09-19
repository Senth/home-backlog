import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { participatingPoolQuery, sharedPoolQuery } from "@/data/nodes";
import { useOverviewPair } from "@/hooks/use-overview";
import { locationCounts } from "@/models/location-counts";
import type { Node } from "@/models/node";

/**
 * What the tree screen reads from the pool pair (#205): the open count per
 * place for every row, and the open cards themselves for a place's own card
 * list. The pair Overview and the boards already open — the same listeners,
 * so the screen adds no query of its own and the documents are warm in the
 * same cache. The roll-up and the selection both live in `models/`, where
 * they are tested.
 */
export function useLocationCounts(homeId: string | null): {
	/** Everything the open listeners hold, unordered. */
	pool: Node[];
	/** The open count per place, rolled up through the subtree. */
	counts: ReadonlyMap<string, number>;
	loading: boolean;
	failed: boolean;
	retry: () => void;
} {
	const { user } = useAuth();
	const uid = user?.uid ?? null;

	const pool = useOverviewPair(
		homeId,
		uid,
		sharedPoolQuery,
		participatingPoolQuery,
		{
			shared: "Could not load the household's open cards",
			participating: "Could not load your own open cards",
		},
	);

	const counts = useMemo(() => locationCounts(pool.nodes), [pool.nodes]);
	return {
		pool: pool.nodes,
		counts,
		loading: pool.loading,
		failed: pool.failed,
		retry: pool.retry,
	};
}
