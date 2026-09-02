import { createContext, type ReactNode, useContext } from "react";
import { useHome } from "@/contexts/HomeContext";
import { useDashboardCards } from "@/hooks/use-dashboard-cards";

/**
 * The card config, shared.
 *
 * Overview stays mounted underneath the editor — a stack push, not a swap —
 * so a second `useDashboardCards` there would double every config listener:
 * the `dashboardCards` collection and both map docs each held twice, twelve
 * against the spec's nine. The provider mounts once in `app/(app)/_layout`,
 * above both routes, and every screen that reads card config consumes this
 * one set of listeners through `useDashboardCards`.
 */

/** What one set of card-config listeners answers. */
export type DashboardCards = ReturnType<typeof useDashboardCards>;

const DashboardCardsContext = createContext<DashboardCards | null>(null);

export function DashboardCardsProvider({ children }: { children: ReactNode }) {
	const { activeHome } = useHome();
	const value = useDashboardCards(activeHome?.id ?? null);

	return (
		<DashboardCardsContext.Provider value={value}>
			{children}
		</DashboardCardsContext.Provider>
	);
}

/** The one card-config store; there is no second way to subscribe to it. */
export function useDashboardCardsConfig(): DashboardCards {
	const value = useContext(DashboardCardsContext);
	if (value === null) {
		throw new Error(
			"useDashboardCardsConfig must be used inside DashboardCardsProvider",
		);
	}
	return value;
}
