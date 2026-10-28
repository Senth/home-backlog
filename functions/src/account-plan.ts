export interface AccountDeletionSnapshot {
	uid: string;
	homes: {
		homeId: string;
		name: string;
		members: Record<string, string>;
		memberProfiles: Record<string, { displayName: string }>;
		nodes: { visibility: string; participantIds: readonly string[] }[];
	}[];
	apiKeys: { name: string }[];
}

export function planAccountDeletion(snapshot: AccountDeletionSnapshot) {
	return {
		homes: snapshot.homes.map((home) => {
			const others = Object.keys(home.members).filter(
				(uid) => uid !== snapshot.uid,
			);
			const outcome: "delete" | "leave" | "blocked" =
				others.length === 0
					? "delete"
					: home.members[snapshot.uid] === "owner" &&
							!others.some((uid) => home.members[uid] === "owner")
						? "blocked"
						: "leave";
			return {
				homeId: home.homeId,
				name: home.name,
				outcome,
				otherMembers: others.map(
					(uid) => home.memberProfiles[uid]?.displayName || uid,
				),
				privateCardsDeleted: home.nodes.filter(
					(node) =>
						node.visibility === "private" &&
						node.participantIds.length === 1 &&
						node.participantIds[0] === snapshot.uid,
				).length,
			};
		}),
		apiKeys: snapshot.apiKeys.map(({ name }) => ({ name })),
	};
}
