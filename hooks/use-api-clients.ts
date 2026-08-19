import { onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { homeApiClientsQuery, toApiClient } from "@/data/api-keys";
import type { ApiClient } from "@/models/api-key";

/**
 * The automations that have written into one home.
 *
 * Unlike `useHomeInvites`, this needs no `enabled` gate: listing invitations is
 * query-safe only for an owner, but every document here is readable by every
 * member, so any member may run it.
 *
 * Constrained to one home's subcollection, which holds one document per key that
 * has ever written into it — a handful, and it only ever grows when an
 * automation somebody set up actually runs.
 */
export function useApiClients(homeId: string | null): {
	clients: ApiClient[];
	loading: boolean;
} {
	const [clients, setClients] = useState<ApiClient[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (homeId === null) {
			setClients([]);
			setLoading(false);
			return;
		}

		setLoading(true);

		return onSnapshot(
			homeApiClientsQuery(homeId),
			(snapshot) => {
				setClients(snapshot.docs.map(toApiClient));
				setLoading(false);
			},
			(reason) => {
				console.error("Could not load this home's automations:", reason);
				setClients([]);
				setLoading(false);
			},
		);
	}, [homeId]);

	return { clients, loading };
}
