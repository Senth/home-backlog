import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { participatingPoolQuery, sharedPoolQuery } from "@/data/nodes";
import { useOverviewPair } from "@/hooks/use-overview";
import { locationCounts } from "@/models/location-counts";

/**
 * The open count per place for the tree screen (#205), from the pool pair
 * Overview and the boards already open — the same listeners, so the screen
 * adds no query of its own and the documents are warm in the same cache.
 * The roll-up itself is `models/location-counts.ts`, where it is tested.
 */
export function useLocationCounts(homeId: string | null): {
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
		counts,
		loading: pool.loading,
		failed: pool.failed,
		retry: pool.retry,
	};
}
