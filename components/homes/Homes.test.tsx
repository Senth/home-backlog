import { fireEvent, render, screen } from "@testing-library/react-native";
import { Provider } from "react-native-paper";
import Homes from "@/app/(app)/homes";
import { lightTheme } from "@/theme";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockSetActiveHome = jest.fn();

jest.mock("expo-router", () => ({
	useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));
jest.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock("@/contexts/AuthContext", () => ({
	useAuth: () => ({ user: { uid: "me", displayName: "Marcus" } }),
}));
jest.mock("@/contexts/HomeContext", () => ({
	useHome: () => ({
		homes: [
			{ id: "home", name: "Huset", members: { me: {} } },
			{ id: "cabin", name: "Stugan", members: { me: {} } },
		],
		activeHome: { id: "home" },
		setActiveHome: mockSetActiveHome,
	}),
}));
jest.mock("@/data/homes", () => ({ createHome: jest.fn() }));
jest.mock("@/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
jest.mock("@/hooks/use-pending-invites", () => ({
	usePendingInvites: () => ({ invites: [] }),
}));
jest.mock("@/components/auth/AccountMenu", () => ({ AccountMenu: () => null }));

function renderHomes() {
	return render(
		<Provider theme={lightTheme}>
			<Homes />
		</Provider>,
	);
}

it("opens the home by its name and keeps the current-home label", () => {
	renderHomes();

	fireEvent.press(screen.getByText("Stugan"));

	expect(mockSetActiveHome).toHaveBeenCalledWith("cabin");
	expect(mockReplace).toHaveBeenCalledWith("/(app)/(tabs)/overview");
	expect(
		screen.getByRole("image", { name: "homes.current" }),
	).toBeOnTheScreen();
});

it("manages a home without opening it or inheriting a row button", () => {
	renderHomes();

	const buttons = screen.getAllByRole("button", {
		name: "manageHome.manageNamed",
	});
	const manage = buttons[0];
	const lead = screen.getByRole("button", { name: /Huset/ });
	expect(manage).toBeEnabled();
	for (let node = manage.parent; node; node = node.parent) {
		expect(node).not.toBe(lead);
		expect(node.props["aria-disabled"]).not.toBe(true);
	}
	fireEvent.press(manage);

	expect(mockPush).toHaveBeenCalledWith("/homes/home");
	expect(mockSetActiveHome).not.toHaveBeenCalled();
	expect(mockReplace).not.toHaveBeenCalled();
});
