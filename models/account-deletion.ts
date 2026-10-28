export interface AccountDeletionPlan {
	homes: {
		homeId: string;
		name: string;
		outcome: "delete" | "leave" | "blocked";
		otherMembers: string[];
		privateCardsDeleted: number;
	}[];
	apiKeys: { name: string }[];
}

export function accountDeletionView(
	plan: AccountDeletionPlan | null,
	authTime: number | null,
	now: number,
) {
	const blocked =
		plan?.homes.filter((home) => home.outcome === "blocked") ?? [];
	const stale =
		authTime === null || !Number.isFinite(authTime) || now - authTime > 300_000;
	return {
		rows:
			plan?.homes
				.map((home) => ({
					...home,
					icon:
						home.outcome === "delete"
							? "home-outline"
							: home.outcome === "leave"
								? "exit-to-app"
								: "information-outline",
					copy: `account.delete.${home.outcome}` as const,
				}))
				.sort(
					(a, b) =>
						Number(b.outcome === "delete") - Number(a.outcome === "delete"),
				) ?? [],
		disabled: plan === null || blocked.length > 0,
		stale,
		label:
			stale && blocked.length === 0
				? "account.delete.signInAgain"
				: "account.deleteAccount",
		hint: blocked.length
			? "account.delete.blockedHint"
			: stale
				? "account.delete.staleHint"
				: "account.delete.freshHint",
		blockedHomes: blocked.map((home) => home.name),
	};
}
