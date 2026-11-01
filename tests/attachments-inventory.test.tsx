import { fireEvent, render, screen } from "@testing-library/react-native";
import { Provider } from "react-native-paper";
import AttachmentsInventory from "@/app/(app)/homes/[homeId]/attachments";
import { urlOf } from "@/components/board/CardThumbnails";
import type { Node } from "@/models/node";
import { newNodeData } from "@/models/node";
import { lightTheme } from "@/theme";
import { denseBreakpoint } from "@/theme/tokens";

let mockWidth = denseBreakpoint - 1;
const mockHeight = 844;
const oneKb = 1024;
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

let mockNodes: Node[] = [];
jest.mock("@/hooks/use-paired-listener", () => ({
	usePairedListener: () => ({
		nodes: mockNodes,
		loading: false,
		failed: false,
	}),
}));

jest.mock("@/components/board/CardThumbnails", () => ({
	urlOf: jest.fn(async () => "https://files.test/object"),
}));

async function renderInventory(width: number) {
	mockWidth = width;

	return await render(
		<Provider theme={lightTheme}>
			<AttachmentsInventory />
		</Provider>,
	);
}

describe("AttachmentsInventory", () => {
	beforeEach(() => {
		mockNodes = [];
	});

	it("shows an undecodable JPEG without requesting a missing thumbnail", async () => {
		mockNodes = [
			{
				...newNodeData({
					title: "Badrummet",
					rank: "a0",
					participantIds: ["uid-me"],
				}),
				id: "node",
				completedAt: null,
				createdAt: null,
				createdBy: "uid-me",
				updatedAt: null,
				attachments: [
					{
						id: "corrupt",
						path: "homes/home-1/nodes/node/corrupt",
						name: "corrupt.jpg",
						contentType: "image/jpeg",
						hasThumbnail: false,
						size: oneKb,
						uploadedAt: null,
						uploadedBy: "uid-me",
					},
				],
			},
		];
		await renderInventory(denseBreakpoint);
		expect(screen.getByText("corrupt.jpg")).toBeOnTheScreen();
		expect(urlOf).not.toHaveBeenCalled();
	});

	it("below denseBreakpoint shows both sort choices and updates selection", async () => {
		await renderInventory(denseBreakpoint - 1);

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

		await fireEvent.press(
			screen.getByRole("button", { name: "homes.sortNewest" }),
		);

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

	it("at denseBreakpoint shows both sort choices and updates selection", async () => {
		await renderInventory(denseBreakpoint);

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

		await fireEvent.press(
			screen.getByRole("button", { name: "homes.sortNewest" }),
		);

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
