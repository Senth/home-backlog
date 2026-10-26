import { act, render, screen } from "@testing-library/react-native";
import { Provider } from "react-native-paper";
import Overview from "@/app/(app)/(tabs)/overview";
import { useDashboardCardsConfig } from "@/contexts/DashboardCardsContext";
import { useOverview } from "@/hooks/use-overview";
import { seedCards } from "@/models/overview-cards";
import { lightTheme } from "@/theme";
import { motion } from "@/theme/tokens";
import { markLaunch } from "@/utils/launch-timing";

jest.mock("expo-router", () => ({
	useRouter: () => ({ push: jest.fn(), setParams: jest.fn() }),
	useLocalSearchParams: () => ({}),
}));
jest.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock("@/contexts/AuthContext", () => ({
	useAuth: () => ({ user: { uid: "uid-me" } }),
}));
jest.mock("@/contexts/HomeContext", () => ({
	useHome: () => ({ activeHome: { id: "home-1", name: "Huset", labels: [] } }),
}));
jest.mock("@/contexts/RailActionContext", () => ({
	useRegisterRailAction: jest.fn(),
}));
jest.mock("@/contexts/OutboxContext", () => ({
	useOutbox: () => ({ intents: [] }),
}));
jest.mock("@/contexts/DashboardCardsContext", () => ({
	useDashboardCardsConfig: jest.fn(),
}));
jest.mock("@/hooks/use-overview", () => ({ useOverview: jest.fn() }));
jest.mock("@/hooks/use-locations", () => ({
	useLocations: () => ({ locations: [] }),
}));
jest.mock("@/hooks/use-label-ancestors", () => ({
	useLabelAncestors: () => new Map(),
}));
jest.mock("@/components/auth/AccountMenu", () => ({ AccountMenu: () => null }));
jest.mock("@/components/board/TitleDialog", () => ({
	TitleDialog: () => null,
}));
jest.mock("@/components/node/DetailsPane", () => ({ DetailsPane: () => null }));
jest.mock("@/components/overview/CardActionsMenu", () => ({
	CardActionsMenu: () => null,
}));
jest.mock("@/components/ui/InstallCard", () => ({ InstallCard: () => null }));
jest.mock("@/data/nodes", () => ({ createNode: jest.fn() }));
jest.mock("@/data/cards", () => ({}));
jest.mock("@/utils/launch-timing", () => ({ markLaunch: jest.fn() }));

const tree = () => (
	<Provider theme={lightTheme}>
		<Overview />
	</Provider>
);

describe("Overview arrival", () => {
	let overview: ReturnType<typeof useOverview>;
	let config: ReturnType<typeof useDashboardCardsConfig>;

	beforeEach(() => {
		jest.useFakeTimers();
		const pending = () => ({
			nodes: [],
			loading: true,
			failed: false,
			retry: jest.fn(),
		});
		overview = { roots: pending(), pool: pending(), done: pending() };
		config = {
			cards: [],
			editorCards: [],
			scopes: {},
			hiddenSharedIds: [],
			loading: true,
			failed: false,
			retry: jest.fn(),
		};
		jest.mocked(useOverview).mockImplementation(() => overview);
		jest.mocked(useDashboardCardsConfig).mockImplementation(() => config);
	});
	afterEach(() => jest.useRealTimers());

	it.each(["config", "roots", "pool", "done"] as const)(
		"keeps the delayed indicator when only %s answers without visible content",
		async (first) => {
			await render(tree());
			await act(() => jest.advanceTimersByTime(motion.loadingDelay));
			expect(screen.getByLabelText("common.loading")).toBeOnTheScreen();
			if (first === "config") {
				config.loading = false;
				config.cards = [seedCards().recentlyDone];
			} else overview[first].loading = false;
			await screen.rerender(tree());

			expect(screen.getByLabelText("common.loading")).toBeOnTheScreen();
			expect(markLaunch).not.toHaveBeenCalledWith("content");
		},
	);

	it("waits for a section's data, then shows its empty state without waiting for other sections", async () => {
		config.loading = false;
		config.cards = [seedCards().ongoing];
		await render(tree());
		await act(() => jest.advanceTimersByTime(motion.loadingDelay));
		expect(screen.getByLabelText("common.loading")).toBeOnTheScreen();
		expect(screen.queryByText("overview.ongoing.empty")).toBeNull();
		expect(markLaunch).not.toHaveBeenCalledWith("content");

		overview.pool.loading = false;
		await screen.rerender(tree());
		expect(screen.getByLabelText("common.loading")).toBeOnTheScreen();
		expect(markLaunch).not.toHaveBeenCalledWith("content");

		overview.roots.loading = false;
		await screen.rerender(tree());
		expect(screen.queryByLabelText("common.loading")).toBeNull();
		expect(screen.getByText("overview.ongoing.empty")).toBeOnTheScreen();
		expect(markLaunch).toHaveBeenCalledWith("content");
	});

	it.each(["error", "empty"])(
		"replaces the indicator with the %s state and marks content",
		async (answer) => {
			await render(tree());
			await act(() => jest.advanceTimersByTime(motion.loadingDelay));
			if (answer === "error") config.failed = true;
			else {
				config.loading = false;
				for (const pair of Object.values(overview)) pair.loading = false;
			}
			await screen.rerender(tree());
			expect(screen.queryByLabelText("common.loading")).toBeNull();
			expect(
				screen.getByText(
					answer === "error" ? "overview.loadFailed" : "overview.empty",
				),
			).toBeOnTheScreen();
			expect(markLaunch).toHaveBeenCalledWith("content");
		},
	);
});
