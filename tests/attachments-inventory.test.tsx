import { fireEvent, render, screen } from "@testing-library/react-native";
import { Chip, Provider, SegmentedButtons } from "react-native-paper";
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
	it("below denseBreakpoint renders both choices as wrapping chips and updates selection", () => {
		renderInventory(denseBreakpoint - 1);

		const chips = screen.UNSAFE_getAllByType(Chip);
		expect(chips).toHaveLength(2);
		expect(chips.map((chip) => chip.props["aria-pressed"])).toEqual([
			true,
			false,
		]);
		fireEvent.press(chips[1]);
		expect(
			screen
				.UNSAFE_getAllByType(Chip)
				.map((chip) => chip.props["aria-pressed"]),
		).toEqual([false, true]);
	});

	it("at denseBreakpoint keeps SegmentedButtons", () => {
		renderInventory(denseBreakpoint);

		expect(screen.UNSAFE_getAllByType(SegmentedButtons)).toHaveLength(1);
		expect(screen.UNSAFE_queryAllByType(Chip)).toHaveLength(0);
	});
});
