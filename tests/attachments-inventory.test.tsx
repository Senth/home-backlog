import { fireEvent, render, screen } from "@testing-library/react-native";
import { Provider } from "react-native-paper";
import AttachmentsInventory from "@/app/(app)/homes/[homeId]/attachments";
import { lightTheme } from "@/theme";
import { denseBreakpoint } from "@/theme/tokens";

let mockWidth = denseBreakpoint - 1;
const mockHeight = 844;
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
	__esModule: true,
	default: () => ({
		width: mockWidth,
		height: mockHeight,
		scale: 1,
		fontScale: 1,
	}),
}));

jest.mock("expo-router", () => ({
	useLocalSearchParams: () => ({ homeId: "home-1" }),
	router: { canGoBack: () => false, replace: jest.fn() },
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

jest.mock("@/contexts/HomeContext", () => ({
	useHome: () => ({
		homes: [
			{
				id: "home-1",
				name: "Huset",
				attachmentBytes: 0,
				attachmentBytesByUid: {},
			},
		],
	}),
}));

jest.mock("@/data/attachments", () => ({
	deleteAttachment: jest.fn(),
	participatingInventoryQuery: jest.fn(),
	sharedInventoryQuery: jest.fn(),
}));

jest.mock("@/hooks/use-paired-listener", () => ({
	usePairedListener: () => ({ nodes: [], loading: false, failed: false }),
}));

function renderInventory(width: number) {
	mockWidth = width;

	return render(
		<Provider theme={lightTheme}>
			<AttachmentsInventory />
		</Provider>,
	);
}

describe("AttachmentsInventory", () => {
	it("below denseBreakpoint shows both sort choices and updates selection", () => {
		renderInventory(denseBreakpoint - 1);

		expect(screen.getByText("homes.sortLargest")).toBeOnTheScreen();
		expect(screen.getByText("homes.sortNewest")).toBeOnTheScreen();
		expect(
			screen.getByRole("button", { name: "homes.sortLargest" }).props[
				"aria-pressed"
			],
		).toBe(true);
		expect(
			screen.getByRole("button", { name: "homes.sortNewest" }).props[
				"aria-pressed"
			],
		).toBe(false);

		fireEvent.press(screen.getByRole("button", { name: "homes.sortNewest" }));

		expect(
			screen.getByRole("button", { name: "homes.sortLargest" }).props[
				"aria-pressed"
			],
		).toBe(false);
		expect(
			screen.getByRole("button", { name: "homes.sortNewest" }).props[
				"aria-pressed"
			],
		).toBe(true);
	});

	it("at denseBreakpoint shows both sort choices and updates selection", () => {
		renderInventory(denseBreakpoint);

		expect(screen.getByText("homes.sortLargest")).toBeOnTheScreen();
		expect(screen.getByText("homes.sortNewest")).toBeOnTheScreen();
		expect(
			screen.getByRole("button", { name: "homes.sortLargest" }).props
				.accessibilityState,
		).toMatchObject({ checked: true });
		expect(
			screen.getByRole("button", { name: "homes.sortNewest" }).props
				.accessibilityState,
		).toMatchObject({ checked: false });

		fireEvent.press(screen.getByRole("button", { name: "homes.sortNewest" }));

		expect(
			screen.getByRole("button", { name: "homes.sortLargest" }).props
				.accessibilityState,
		).toMatchObject({ checked: false });
		expect(
			screen.getByRole("button", { name: "homes.sortNewest" }).props
				.accessibilityState,
		).toMatchObject({ checked: true });
	});
});
