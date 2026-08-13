import { onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { pendingInvitesQuery, toInvite } from "@/data/homes";
import type { Invite } from "@/models/home";

/**
 * The invitations waiting for me, found by the hash of my own address.
 *
 * Deliberately a hook rather than part of `HomeProvider`: this listener is
 * mounted only while the homes list is on screen, which is the one place an
 * invitation can be acted on. Nothing is delivered to an invitee — no email, no
 * link — so this query *is* the notification channel, and it has to run
 * somewhere the person will actually look.
 */
export function usePendingInvites(): { invites: Invite[]; loading: boolean } {
	const { user } = useAuth();
	const [invites, setInvites] = useState<Invite[]>([]);
	const [loading, setLoading] = useState(true);
	const email = user?.email ?? null;

	useEffect(() => {
		if (email === null) {
			setInvites([]);
			setLoading(false);
			return;
		}

		setLoading(true);

		return onSnapshot(
			pendingInvitesQuery(email),
			(snapshot) => {
				setInvites(snapshot.docs.map(toInvite));
				setLoading(false);
			},
			(reason) => {
				// Handled: an invitation nobody can see is bad, but a homes screen
				// stuck behind a spinner is worse — you cannot even create a home.
				console.error("Could not load your invitations:", reason);
				setInvites([]);
				setLoading(false);
			},
		);
	}, [email]);

	return { invites, loading };
}
