import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react-native";
import { Provider } from "react-native-paper";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { lightTheme } from "@/theme";

let mockIntents: unknown[] = [];
let mockCanInstall = false;
const mockPromptInstall = jest.fn();

jest.mock("expo-router/react-navigation", () => ({ useIsFocused: () => true }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/hooks/use-install-prompt", () => ({
	useInstallPrompt: () => ({
		canInstall: mockCanInstall,
		promptInstall: mockPromptInstall,
	}),
}));
jest.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) => {
			if (values === undefined) return key;
			const plural =
				key === "outbox.signOutPending"
					? values.count === 1
						? "_one"
						: "_other"
					: "";
			return `${key}${plural}:${JSON.stringify(values)}`;
		},
		i18n: { language: "en-US" },
	}),
}));
jest.mock("@/contexts/AuthContext", () => ({
	useAuth: () => ({
		user: {
			uid: "uid-me",
			displayName: "Marcus",
			email: "marcus@example.com",
			photoURL: null,
		},
		signOut: jest.fn(),
	}),
}));
jest.mock("@/contexts/OutboxContext", () => ({
	useOutbox: () => ({ intents: mockIntents }),
}));

async function openSignOutDialog() {
	await fireEvent.press(screen.getByTestId("account-menu-trigger"));
	await fireEvent.press(screen.getByText("common.signOut"));
	return waitFor(() =>
		expect(screen.getByTestId("sign-out-dialog")).toBeTruthy(),
	);
}

async function renderAccountMenu() {
	return await render(
		<Provider theme={lightTheme}>
			<AccountMenu />
		</Provider>,
	);
}

beforeEach(() => {
	jest.useFakeTimers();
	mockIntents = [];
	mockCanInstall = false;
	mockPromptInstall.mockReset();
});

afterEach(async () => {
	await act(async () => {
		await jest.runOnlyPendingTimersAsync();
	});
	jest.useRealTimers();
});

it("shows sign-out question without a notice when outbox is empty", async () => {
	await renderAccountMenu();
	await openSignOutDialog();

	expect(screen.getByText("account.signOut.body")).toBeTruthy();
	expect(screen.queryByText(/outbox\.signOutPending/)).toBeNull();
});

it("shows the queued change count in sign-out dialog", async () => {
	mockIntents = [{}, {}];
	await renderAccountMenu();
	await openSignOutDialog();

	expect(
		screen.getByText(/outbox\.signOutPending_other:\{"count":2\}/),
	).toBeTruthy();
});

it("does not show install app when installation is unavailable", async () => {
	await renderAccountMenu();
	await fireEvent.press(screen.getByTestId("account-menu-trigger"));
	expect(screen.queryByText("account.install")).toBeNull();
});

it("closes the menu and prompts installation", async () => {
	mockCanInstall = true;
	await renderAccountMenu();
	await fireEvent.press(screen.getByTestId("account-menu-trigger"));
	await fireEvent.press(screen.getByText("account.install"));

	expect(mockPromptInstall).toHaveBeenCalledTimes(1);
	await waitFor(() => expect(screen.queryByText("account.install")).toBeNull());
});
