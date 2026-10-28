import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { isLoaded, loadAsync } from "expo-font";
import type { User } from "firebase/auth";
import type { DocumentData, QuerySnapshot } from "firebase/firestore";
import type { ReactNode } from "react";
import { Text } from "react-native";
import RootLayout from "@/app/_layout";
import { useHome } from "@/contexts/HomeContext";
import { subscribeWithRetry } from "@/data/live-query";
import { motion } from "@/theme/tokens";

let mockUser: User | null;
let mockAuthLoading = false;
let mockFinishFont: () => void;

jest.mock("@/i18n", () => ({}));
jest.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock("@/contexts/AuthContext", () => ({
	AuthProvider: ({ children }: { children: ReactNode }) => children,
	useAuth: () => ({ user: mockUser, loading: mockAuthLoading }),
}));
jest.mock("expo-font", () => ({ isLoaded: jest.fn(), loadAsync: jest.fn() }));
jest.mock("@expo/vector-icons/MaterialCommunityIcons", () => ({
	getFontFamily: () => "MaterialCommunityIcons",
	font: {},
}));
jest.mock("expo-router/head", () => ({
	__esModule: true,
	default: () => null,
}));
jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));
jest.mock("@/components/ui/OfflineBar", () => ({ OfflineBar: () => null }));
jest.mock("@/components/ui/UpdateBanner", () => ({ UpdateBanner: () => null }));
jest.mock("@/components/ui/LaunchTimingOverlay", () => ({
	LaunchTimingOverlay: () => null,
}));
jest.mock("@/utils/launch-timing", () => ({ markLaunch: jest.fn() }));
jest.mock("@/hooks/use-color-scheme", () => ({
	useColorScheme: () => "light",
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
	getItem: jest.fn(),
	setItem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("firebase/firestore", () => ({ onSnapshot: jest.fn() }));
jest.mock("@/data/homes", () => ({
	homesQuery: jest.fn(),
	toHome: (home: unknown) => home,
	profileOf: () => ({ displayName: "Marcus", photoURL: null }),
	saveMyProfile: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/data/live-query", () => ({ subscribeWithRetry: jest.fn() }));
jest.mock("@/hooks/use-online-status", () => ({ isOnline: () => true }));
jest.mock("@/contexts/OutboxContext", () => ({
	OutboxProvider: ({ children }: { children: ReactNode }) => children,
}));
jest.mock("@/contexts/DashboardCardsContext", () => ({
	DashboardCardsProvider: ({ children }: { children: ReactNode }) => children,
}));
jest.mock("expo-router", () => {
	const { createElement } = require("react") as typeof import("react");
	const { Text } = require("react-native") as typeof import("react-native");
	return {
		usePathname: () => "/overview",
		Slot: () =>
			mockUser
				? createElement(require("@/app/(app)/_layout").default)
				: createElement(Text, null, "Login"),
		Stack: () => createElement(MockHomes),
		Redirect: () => createElement(Text, null, "Login"),
	};
});

function MockHomes() {
	const { activeHome, failed, retry, retrying } = useHome();
	return (
		<>
			<Text>{activeHome?.name ?? "Choose home"}</Text>
			{failed ? <Text onPress={retry}>Try again</Text> : null}
			{retrying ? <Text>Retrying</Text> : null}
		</>
	);
}

function answer(names = ["Huset", "Stugan"]) {
	const docs = names.map((name) => ({
		id: name,
		name,
		members: { [mockUser?.uid ?? ""]: "owner" },
		memberProfiles: {},
		memberEmailHashes: {},
	}));
	const next = jest.mocked(subscribeWithRetry).mock.calls.at(-1)?.[1];
	if (!next) throw new Error("Homes listener did not open");
	next({ docs } as unknown as QuerySnapshot<DocumentData>);
}

beforeEach(() => {
	mockUser = { uid: "marcus", email: "marcus@example.com" } as User;
	mockAuthLoading = false;
	jest.mocked(AsyncStorage.getItem).mockResolvedValue("Stugan");
	jest.mocked(isLoaded).mockReturnValue(false);
	jest.mocked(loadAsync).mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				mockFinishFont = resolve;
			}),
	);
	jest.mocked(subscribeWithRetry).mockReturnValue(jest.fn());
});

it("opens one homes listener during the font wait and holds routes for both answers", async () => {
	await render(<RootLayout />);
	expect(screen.getByText("app.name")).toBeTruthy();
	expect(subscribeWithRetry).toHaveBeenCalledTimes(1);
	await act(() => answer());
	expect(screen.queryByText("Stugan")).toBeNull();
	await act(() => mockFinishFont());
	expect(screen.getByText("Stugan")).toBeTruthy();
	expect(subscribeWithRetry).toHaveBeenCalledTimes(1);
});

it("holds the splash after the font until homes answer", async () => {
	await render(<RootLayout />);
	await act(() => mockFinishFont());
	expect(screen.getByText("app.name")).toBeTruthy();
	await act(() => answer());
	expect(screen.getByText("Stugan")).toBeTruthy();
});

it.each([false, true])(
	"keeps the visible splash and font wait stable when pending auth signs in, font ready: %s",
	async (fontReady) => {
		jest.useFakeTimers();
		try {
			mockUser = null;
			mockAuthLoading = true;
			const view = await render(<RootLayout />);
			if (fontReady) await act(() => mockFinishFont());
			await act(() => jest.advanceTimersByTime(motion.loadingDelay));
			expect(screen.getByLabelText("common.loading")).toBeTruthy();
			mockUser = { uid: "marcus", email: "marcus@example.com" } as User;
			mockAuthLoading = false;
			await view.rerender(<RootLayout />);
			expect(screen.getByLabelText("common.loading")).toBeTruthy();
			expect(loadAsync).toHaveBeenCalledTimes(1);
			expect(subscribeWithRetry).toHaveBeenCalledTimes(1);
			await act(() => answer());
			if (!fontReady) {
				expect(screen.getByLabelText("common.loading")).toBeTruthy();
				await act(() => mockFinishFont());
			}
			expect(screen.getByText("Stugan")).toBeTruthy();
			expect(screen.queryByText("Login")).toBeNull();
		} finally {
			jest.useRealTimers();
		}
	},
);

it("waits for the remembered home before mounting routes", async () => {
	jest.mocked(isLoaded).mockReturnValue(true);
	let finishStorage!: (value: string) => void;
	jest.mocked(AsyncStorage.getItem).mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finishStorage = resolve;
			}),
	);
	await render(<RootLayout />);
	await act(() => answer());
	expect(screen.getByText("app.name")).toBeTruthy();
	await act(() => finishStorage("Stugan"));
	expect(screen.getByText("Stugan")).toBeTruthy();
});

it("keeps a failed homes screen mounted during manual retry", async () => {
	jest.mocked(isLoaded).mockReturnValue(true);
	const error = jest.spyOn(console, "error").mockImplementation(() => {});
	try {
		await render(<RootLayout />);
		await act(() => {
			jest.mocked(subscribeWithRetry).mock.calls[0][2](new Error("offline"));
		});
		expect(screen.getByText("Try again")).toBeTruthy();
		await fireEvent.press(screen.getByText("Try again"));
		expect(screen.getByText("Retrying")).toBeTruthy();
		expect(screen.queryByText("app.name")).toBeNull();
		await act(() => answer());
		expect(screen.getByText("Stugan")).toBeTruthy();
	} finally {
		error.mockRestore();
	}
});

it("unmounts homes on sign-out and holds the next person's routes for fresh homes", async () => {
	jest.mocked(isLoaded).mockReturnValue(true);
	const view = await render(<RootLayout />);
	await act(() => answer());
	const unsubscribe = jest.mocked(subscribeWithRetry).mock.results[0].value;
	mockUser = null;
	await view.rerender(<RootLayout />);
	expect(unsubscribe).toHaveBeenCalledTimes(1);
	expect(screen.getByText("Login")).toBeTruthy();
	mockUser = { uid: "anna", email: "anna@example.com" } as User;
	await view.rerender(<RootLayout />);
	expect(screen.getByText("app.name")).toBeTruthy();
	expect(screen.queryByText("Stugan")).toBeNull();
	await act(() => answer(["Anna's home"]));
	expect(screen.getByText("Anna's home")).toBeTruthy();
	expect(subscribeWithRetry).toHaveBeenCalledTimes(2);
});

it("never mounts a signed-out route before auth and font are resolved", async () => {
	mockUser = null;
	mockAuthLoading = true;
	const view = await render(<RootLayout />);
	await act(() => mockFinishFont());
	expect(screen.queryByText("Login")).toBeNull();
	mockAuthLoading = false;
	await view.rerender(<RootLayout />);
	expect(screen.getByText("Login")).toBeTruthy();
	expect(subscribeWithRetry).not.toHaveBeenCalled();
});

it("replaces the provider immediately when the signed-in uid changes", async () => {
	jest.mocked(isLoaded).mockReturnValue(true);
	const view = await render(<RootLayout />);
	await act(() => answer());
	const unsubscribe = jest.mocked(subscribeWithRetry).mock.results[0].value;
	mockUser = { uid: "anna", email: "anna@example.com" } as User;
	await view.rerender(<RootLayout />);
	expect(unsubscribe).toHaveBeenCalledTimes(1);
	expect(screen.getByText("app.name")).toBeTruthy();
	expect(screen.queryByText("Stugan")).toBeNull();
	await act(() => answer(["Anna's home"]));
	expect(screen.getByText("Anna's home")).toBeTruthy();
	expect(subscribeWithRetry).toHaveBeenCalledTimes(2);
});
