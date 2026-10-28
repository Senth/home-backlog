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

export const accountDeletionPathManifest = [
	{
		file: "firestore.rules",
		path: "/databases/{database}/documents",
		classification: "kept",
		reason: "Structural rules root; no account document exists at this path.",
	},
	{
		file: "firestore.rules",
		path: "/databases/{database}/documents/homes/{homeId}",
		classification: "home-tree",
		reason: "Sole-member home documents are removed with their full subtree.",
	},
	{
		file: "firestore.rules",
		path: "/databases/{database}/documents/homes/{homeId}/invites/{emailHashId}",
		classification: "leave-cleanup",
		reason:
			"Caller invites are deleted; remaining invites disappear with deleted homes.",
	},
	{
		file: "firestore.rules",
		path: "/databases/{database}/documents/homes/{homeId}/nodes/{nodeId}",
		classification: "leave-cleanup",
		reason:
			"Private caller nodes are deleted and caller references leave shared nodes.",
	},
	{
		file: "firestore.rules",
		path: "/databases/{database}/documents/homes/{homeId}/apiClients/{keyId}",
		classification: "leave-cleanup",
		reason:
			"API clients owned by caller are deleted when caller leaves shared homes.",
	},
	{
		file: "firestore.rules",
		path: "/databases/{database}/documents/homes/{homeId}/locations/{locationId}",
		classification: "home-tree",
		reason:
			"Locations remain in shared homes and are removed with deleted home trees.",
	},
	{
		file: "firestore.rules",
		path: "/databases/{database}/documents/homes/{homeId}/dashboards/{uid}",
		classification: "leave-cleanup",
		reason: "Caller dashboard is deleted when caller leaves a shared home.",
	},
	{
		file: "firestore.rules",
		path: "/databases/{database}/documents/homes/{homeId}/dashboardCards/{cardId}",
		classification: "home-tree",
		reason:
			"Shared dashboard cards stay; deleted home trees remove the collection.",
	},
	{
		file: "firestore.rules",
		path: "/databases/{database}/documents/homes/{homeId}/recurring/{ruleId}",
		classification: "home-tree",
		reason:
			"Recurring rules stay in shared homes and leave only with deleted home trees.",
	},
	{
		file: "firestore.rules",
		path: "/databases/{database}/documents/users/{uid}",
		classification: "user-tree",
		reason:
			"The caller user document and its complete subtree are recursively deleted.",
	},
	{
		file: "firestore.rules",
		path: "/databases/{database}/documents/users/{uid}/dashboard/{docId}",
		classification: "user-tree",
		reason: "Caller dashboard configuration is removed with the user tree.",
	},
	{
		file: "firestore.rules",
		path: "/databases/{database}/documents/users/{uid}/apiKeys/{keyId}",
		classification: "user-tree",
		reason: "Caller API keys are removed with the user tree.",
	},
	{
		file: "firestore.rules",
		path: "/databases/{database}/documents/users/{uid}/apiKeys/{keyId}/runs/{runId}",
		classification: "user-tree",
		reason: "API key run records are removed with the user tree.",
	},
	{
		file: "firestore.rules",
		path: "/databases/{database}/documents/{path=**}/invites/{emailHashId}",
		classification: "leave-cleanup",
		reason:
			"Collection-group invite matches are deleted when addressed to caller.",
	},
	{
		file: "storage.rules",
		path: "/b/{bucket}/o",
		classification: "kept",
		reason: "Structural Storage root; no account object exists at this path.",
	},
	{
		file: "storage.rules",
		path: "/b/{bucket}/o/homes/{homeId}/nodes/{nodeId}/{attachmentId}",
		classification: "home-tree",
		reason: "Home attachment objects are removed by the home deletion trigger.",
	},
] as const;

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
