import { onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useState } from "react";
import { homeInvitesQuery, toInvite } from "@/data/homes";
import type { Invite } from "@/models/home";

/**
 * The invitations one home is still waiting on.
 *
 * `enabled` is not a convenience — it is a correctness gate. Listing this
 * collection is query-safe *for an owner*, because `isOwner(homeId)` passes for
 * every document in it. For anyone else some documents would be denied, and
 * Firestore rejects the whole query rather than filtering it. The manage screen
 * renders the pending section only for an owner, and this must not run when it
 * does not.
 */
export function useHomeInvites(
	homeId: string | null,
	enabled: boolean,
): { invites: Invite[]; loading: boolean } {
	const [invites, setInvites] = useState<Invite[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (homeId === null || !enabled) {
			setInvites([]);
			setLoading(false);
			return;
		}

		setLoading(true);

		return onSnapshot(
			query(homeInvitesQuery(homeId), orderBy("createdAt", "desc")),
			(snapshot) => {
				setInvites(snapshot.docs.map(toInvite));
				setLoading(false);
			},
			(reason) => {
				console.error("Could not load this home's invitations:", reason);
				setInvites([]);
				setLoading(false);
			},
		);
	}, [homeId, enabled]);

	return { invites, loading };
}
