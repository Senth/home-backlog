import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react-native";
import { getIdTokenResult } from "firebase/auth";
import type { ReactNode } from "react";
import { PaperProvider } from "react-native-paper";
import DeleteAccount from "@/app/(app)/account/delete";
import { deleteAccount } from "@/data/account";
import { lightTheme } from "@/theme";
import "@/i18n";

const mockReplace = jest.fn();
const mockSignOut = jest.fn();
const mockUser = {};
let mockOnline = true;

jest.mock("expo-router", () => ({
	useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
	useFocusEffect: (callback: () => void) => {
		const { useEffect } = require("react");
		useEffect(callback, [callback]);
	},
}));
jest.mock("@react-navigation/native", () => ({ usePreventRemove: jest.fn() }));
jest.mock("firebase/auth", () => ({ getIdTokenResult: jest.fn() }));
jest.mock("@/data/account", () => ({ deleteAccount: jest.fn() }));
jest.mock("@/contexts/AuthContext", () => ({
	useAuth: () => ({
		user: mockUser,
		signOut: mockSignOut,
		redirectError: null,
		dismissRedirectError: jest.fn(),
	}),
}));
jest.mock("@/hooks/use-online-status", () => ({ isOnline: () => mockOnline }));
jest.mock("@/components/ui/PaperIcon", () => ({ PaperIcon: () => null }));
jest.mock("@/components/ui/AppHeader", () => ({
	AppHeader: ({ title }: { title: string }) => {
		const { Text } = require("react-native");
		return <Text>{title}</Text>;
	},
}));
jest.mock("@/components/ui/SlimScrollView", () => ({
	SlimScrollView: ({ children }: { children: ReactNode }) => children,
}));
jest.mock("@/components/auth/GoogleSignIn", () => ({
	GoogleSignInButton: () => {
		const { Text } = require("react-native");
		return <Text>Sign in again to delete</Text>;
	},
}));

const plan = {
	homes: [
		{
			homeId: "sole",
			name: "Stugan",
			outcome: "delete" as const,
			otherMembers: [],
			privateCardsDeleted: 0,
		},
	],
	apiKeys: [{ name: "research agent" }],
};

beforeEach(() => {
	jest.resetAllMocks();
	mockOnline = true;
	jest
		.mocked(getIdTokenResult)
		.mockResolvedValue({ authTime: new Date().toISOString() } as Awaited<
			ReturnType<typeof getIdTokenResult>
		>);
	jest.mocked(deleteAccount).mockResolvedValue(plan);
	mockSignOut.mockResolvedValue(undefined);
});

async function openPage() {
	await render(
		<PaperProvider theme={lightTheme} settings={{ icon: () => null }}>
			<DeleteAccount />
		</PaperProvider>,
	);
	await screen.findByText("Stugan");
}

async function confirmDeletion() {
	await fireEvent.press(screen.getByRole("button", { name: "Delete account" }));
	await screen.findByText("Delete your account?");
	await fireEvent.press(screen.getByRole("button", { name: "Delete" }));
}

it("shows only the intro while the dry run is pending", async () => {
	jest.mocked(deleteAccount).mockReturnValue(new Promise(() => {}));
	await render(
		<PaperProvider theme={lightTheme}>
			<DeleteAccount />
		</PaperProvider>,
	);
	expect(
		screen.getByText(
			"This removes you from Home Backlog. It cannot be undone.",
		),
	).toBeTruthy();
	expect(screen.queryByText("Your homes")).toBeNull();
	expect(deleteAccount).toHaveBeenCalledWith(true);
});

it("waits for confirmation, keeps progress visible, then clears the device and lands on login", async () => {
	let finish: (value: typeof plan) => void = () => {};
	await openPage();
	jest.mocked(deleteAccount).mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	await confirmDeletion();
	expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
	expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
	expect(mockSignOut).not.toHaveBeenCalled();
	await act(async () => finish(plan));
	await waitFor(() =>
		expect(mockSignOut).toHaveBeenCalledWith("/login?deleted=1"),
	);
	expect(mockReplace).toHaveBeenCalledWith("/login?deleted=1");
});

it("server recent-login refusal switches back to sign-in without clearing data", async () => {
	await openPage();
	jest.mocked(deleteAccount).mockRejectedValueOnce(new Error("recent-login"));
	await confirmDeletion();
	expect(await screen.findByText("Sign in again to delete")).toBeTruthy();
	expect(mockSignOut).not.toHaveBeenCalled();
});

it("offline confirmation changes no data", async () => {
	await openPage();
	mockOnline = false;
	await confirmDeletion();
	expect(deleteAccount).toHaveBeenCalledTimes(1);
	expect(mockSignOut).not.toHaveBeenCalled();
});

it("failed deletion leaves the account signed in and offers the action again", async () => {
	await openPage();
	jest.mocked(deleteAccount).mockRejectedValueOnce(new Error("unavailable"));
	await confirmDeletion();
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "Delete account" }),
		).not.toBeDisabled(),
	);
	expect(mockSignOut).not.toHaveBeenCalled();
	expect(mockReplace).not.toHaveBeenCalled();
});
