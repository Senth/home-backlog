import {
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react-native";
import { Provider } from "react-native-paper";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { lightTheme } from "@/theme";

let mockIntents: unknown[] = [];

jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
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

function openSignOutDialog() {
	fireEvent.press(screen.getByTestId("account-menu-trigger"));
	fireEvent.press(screen.getByText("common.signOut"));
	return waitFor(() =>
		expect(screen.getByTestId("sign-out-dialog")).toBeTruthy(),
	);
}

function renderAccountMenu() {
	return render(
		<Provider theme={lightTheme}>
			<AccountMenu />
		</Provider>,
	);
}

beforeEach(() => {
	mockIntents = [];
});

it("shows sign-out question without a notice when outbox is empty", async () => {
	renderAccountMenu();
	await openSignOutDialog();

	expect(screen.getByText("account.signOut.body")).toBeTruthy();
	expect(screen.queryByText(/outbox\.signOutPending/)).toBeNull();
});

it("shows the queued change count in sign-out dialog", async () => {
	mockIntents = [{}, {}];
	renderAccountMenu();
	await openSignOutDialog();

	expect(
		screen.getByText(/outbox\.signOutPending_other:\{"count":2\}/),
	).toBeTruthy();
});
