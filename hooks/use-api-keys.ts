import { onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { apiKeysQuery, toApiKey } from "@/data/api-keys";
import type { ApiKey } from "@/models/api-key";

/**
 * My own API keys.
 *
 * Constrained to one uid's own subcollection, which is as narrow as a listener
 * gets — one to a handful of documents, and nobody else's can match. A listener
 * rather than a one-shot read so that revoking a key empties the row it was on
 * without a refetch, and so `lastUsedAt` moves while the screen is open.
 */
export function useApiKeys(uid: string | null): {
	keys: ApiKey[];
	loading: boolean;
} {
	const [keys, setKeys] = useState<ApiKey[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (uid === null) {
			setKeys([]);
			setLoading(false);
			return;
		}

		setLoading(true);

		return onSnapshot(
			apiKeysQuery(uid),
			(snapshot) => {
				setKeys(snapshot.docs.map(toApiKey));
				setLoading(false);
			},
			(reason) => {
				console.error("Could not load your API keys:", reason);
				setKeys([]);
				setLoading(false);
			},
		);
	}, [uid]);

	return { keys, loading };
}
