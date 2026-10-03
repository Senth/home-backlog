import { render, screen } from "@testing-library/react-native";
import { Provider } from "react-native-paper";
import OverviewCardEdit from "@/app/(app)/overview-card-edit";
import OverviewEditor from "@/app/(app)/overview-editor";
import { useHome } from "@/contexts/HomeContext";
import { lightTheme } from "@/theme";

jest.mock("expo-router", () => ({
	Redirect: ({ href }: { href: string }) => {
		const { createElement } = require("react") as typeof import("react");
		const { Text } = require("react-native") as typeof import("react-native");
		return createElement(Text, null, `Redirect to ${href}`);
	},
	useRouter: () => ({ push: jest.fn() }),
	useLocalSearchParams: () => ({}),
}));

jest.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values === undefined ? key : `${key}:${JSON.stringify(values)}`,
		i18n: { language: "en-US" },
	}),
}));

jest.mock("@/contexts/AuthContext", () => ({
	useAuth: () => ({ user: { uid: "uid-me" } }),
}));
jest.mock("@/contexts/HomeContext", () => ({ useHome: jest.fn() }));
jest.mock("@/contexts/DashboardCardsContext", () => ({
	useDashboardCardsConfig: () => ({
		editorCards: [],
		hiddenSharedIds: [],
		loading: false,
		failed: false,
		retry: jest.fn(),
	}),
}));
jest.mock("@/hooks/use-locations", () => ({
	useLocations: () => ({ locations: [] }),
}));
jest.mock("@/components/overview/use-card-writes", () => ({
	useCardWrites: () => ({}),
}));
jest.mock("@/data/cards", () => ({ saveHiddenShared: jest.fn() }));

describe.each([
	["/overview-editor", OverviewEditor],
	["/overview-card-edit", OverviewCardEdit],
] as const)("%s", (_path, Route) => {
	it("redirects a signed-in account without an active home to /homes", () => {
		jest.mocked(useHome).mockReturnValue({
			activeHome: null,
		} as ReturnType<typeof useHome>);

		render(
			<Provider theme={lightTheme}>
				<Route />
			</Provider>,
		);

		expect(screen.getByText("Redirect to /homes")).toBeTruthy();
		expect(screen.queryByTestId("overview-card-edit-title")).toBeNull();
		expect(screen.queryByText(/^overview\.cards\.editor\.intro/)).toBeNull();
	});

	it("renders with the active home's name, then redirects if it is cleared", () => {
		jest.mocked(useHome).mockReturnValue({
			activeHome: { id: "home-1", name: "Huset", members: {}, labels: [] },
		} as unknown as ReturnType<typeof useHome>);
		const { rerender } = render(
			<Provider theme={lightTheme}>
				<Route />
			</Provider>,
		);

		expect(screen.queryByText("Redirect to /homes")).toBeNull();
		expect(screen.getAllByText(/"home":"Huset"/).length).toBeGreaterThan(0);

		jest.mocked(useHome).mockReturnValue({
			activeHome: null,
		} as ReturnType<typeof useHome>);
		rerender(
			<Provider theme={lightTheme}>
				<Route />
			</Provider>,
		);

		expect(screen.getByText("Redirect to /homes")).toBeTruthy();
		expect(screen.queryByTestId("overview-card-edit-title")).toBeNull();
		expect(screen.queryByText(/^overview\.cards\.editor\.intro/)).toBeNull();
	});
});
