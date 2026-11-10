import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { Provider } from "react-native-paper";
import { SafeAreaProvider } from "react-native-safe-area-context";
import Locations from "@/app/(app)/(tabs)/locations";
import { LocationTree } from "@/components/location/LocationRow";
import { useLocationDrag } from "@/components/location/use-location-drag";
import { OutboxProvider } from "@/contexts/OutboxContext";
import { moveLocation } from "@/data/locations";
import { replayIntent } from "@/data/outbox-replay";
import type { OutboxIntent } from "@/data/outbox-store";
import { useLocationCounts } from "@/hooks/use-location-counts";
import { isOnline } from "@/hooks/use-online-status";
import type { Location } from "@/models/locations";
import { lightTheme } from "@/theme";
import { space } from "@/theme/tokens";

let mockStore: Record<string, string> = {};
let mockLocations: Location[] = [];
let mockWidth = 320;
const mockHeight = 844;
let mockCard: string | undefined;
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
	__esModule: true,
	default: () => ({
		width: mockWidth,
		height: mockHeight,
		scale: 1,
		fontScale: 1,
	}),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
	getItem: jest.fn(async (key: string) => mockStore[key] ?? null),
	setItem: jest.fn(async (key: string, value: string) => {
		mockStore[key] = value;
	}),
}));
jest.mock("@/config/firebase", () => ({ db: {} }));
jest.mock("firebase/firestore", () => ({
	collection: jest.fn(() => ({})),
	doc: jest.fn(() => ({ id: "intent-1" })),
	waitForPendingWrites: jest.fn(),
}));
jest.mock("@/data/outbox-replay", () => ({ replayIntent: jest.fn() }));
jest.mock("@/data/locations", () => ({
	moveLocation: jest.fn(),
	locationErrorKey: () => "error.saveFailed",
}));
jest.mock("@/data/nodes", () => ({
	isUnavailable: (reason: { code?: string } | null) =>
		reason?.code === "unavailable",
}));
jest.mock("@/contexts/AuthContext", () => ({
	useAuth: () => ({ user: { uid: "marcus" }, loading: false }),
}));
jest.mock("@/contexts/HomeContext", () => ({
	useHome: () => ({ activeHome: { id: "huset", name: "Huset" } }),
}));
jest.mock("@/hooks/use-online-status", () => ({ isOnline: jest.fn() }));
jest.mock("@/hooks/use-locations", () => ({
	useLocations: () => ({
		locations: mockLocations,
		loading: false,
		failed: false,
		retry: jest.fn(),
	}),
}));
jest.mock("@/hooks/use-location-counts", () => ({
	useLocationCounts: jest.fn(() => ({ pool: [], counts: new Map() })),
}));
jest.mock("@/hooks/use-board-filter", () => ({
	useBoardFilter: () => ({ setFilter: jest.fn() }),
}));
jest.mock("@/hooks/use-escape-cancel", () => ({ useEscapeCancel: jest.fn() }));
jest.mock("@/components/auth/AccountMenu", () => ({ AccountMenu: () => null }));
jest.mock("@/components/ui/BackAction", () => ({ BackAction: () => null }));
jest.mock("@/components/node/DetailsPane", () => ({ DetailsPane: () => null }));
jest.mock("@/components/location/use-location-drag", () => ({
	screenKey: "screen",
	useLocationDrag: jest.fn(() => ({
		register: jest.fn(),
		over: null,
		overlay: null,
		dragged: null,
	})),
}));
jest.mock("@react-navigation/native", () => ({
	useNavigation: () => ({ addListener: jest.fn(() => jest.fn()) }),
}));
jest.mock("expo-router", () => ({
	useRouter: () => ({ push: jest.fn(), setParams: jest.fn() }),
	useLocalSearchParams: () => ({ card: mockCard }),
}));
jest.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values ? `${key}:${JSON.stringify(values)}` : key,
	}),
}));
jest.mock("@expo/vector-icons/MaterialCommunityIcons", () => {
	const { View } = jest.requireActual("react-native");
	const Mock = ({ name }: { name: string }) => <View testID={name} />;
	return { __esModule: true, default: Object.assign(Mock, { glyphMap: {} }) };
});
jest.mock("@/components/location/LocationRow", () => ({
	LocationDragOverlay: () => null,
	LocationTree: jest.fn((props: Parameters<typeof LocationTree>[0]) => {
		const { View, Text, Pressable } = jest.requireActual("react-native");
		return (
			<View>
				{props.locations.map((location) => (
					<View key={location.id}>
						<Text>{`${location.title}:${location.parentId ?? "root"}`}</Text>
						<Pressable
							testID={`move-${location.id}`}
							onPress={() => props.onMoveUnder(location)}
						/>
						<Pressable
							testID={`target-${location.id}`}
							onPress={() => props.onSelectDestination(location)}
						/>
					</View>
				))}
			</View>
		);
	}),
}));

function location(
	id: string,
	title: string,
	ancestorIds: string[] = [],
): Location {
	return {
		id,
		title,
		ancestorIds,
		parentId: ancestorIds.at(-1) ?? null,
		rank: "V0",
		icon: "home",
		color: "teal",
		createdAt: null,
		updatedAt: null,
		createdBy: "marcus",
	};
}

const kitchen = location("kitchen", "Kitchen");
const garden = location("garden", "Garden");
const pantry = location("pantry", "Pantry", ["kitchen"]);
const queuedMove: OutboxIntent = {
	id: "intent-1",
	homeId: "huset",
	queuedAt: 1,
	title: kitchen.title,
	sourceParentId: null,
	sourceAncestorIds: [],
	kind: "moveLocation",
	locationId: "kitchen",
	parentId: "garden",
	targetTitle: "Garden",
	rank: "V1",
};

function open(bottomInset = 0) {
	return render(
		<SafeAreaProvider
			initialMetrics={{
				insets: { top: 0, bottom: bottomInset, left: 0, right: 0 },
				frame: { x: 0, y: 0, width: space.none, height: space.none },
			}}
		>
			<Provider theme={lightTheme}>
				<OutboxProvider>
					<Locations />
				</OutboxProvider>
			</Provider>
		</SafeAreaProvider>,
	);
}

beforeEach(() => {
	mockWidth = 320;
	mockCard = undefined;
	mockStore = {};
	mockLocations = [kitchen, garden, pantry];
	jest.mocked(isOnline).mockReturnValue(false);
	jest.mocked(moveLocation).mockReset().mockResolvedValue();
	jest.mocked(replayIntent).mockReset().mockResolvedValue();
	jest
		.spyOn(AppState, "addEventListener")
		.mockReturnValue({ remove: jest.fn() });
});

afterEach(() => jest.restoreAllMocks());

it.each(
	[390, 720, 1024, 1280, 1440, 1760, 2560].flatMap((width) =>
		[undefined, "card-1"].map((card) => ({ width, card })),
	),
)(
	"opens location creation from the FAB at $width pixels with card=$card",
	async ({ width, card }) => {
		mockWidth = width;
		mockCard = card;
		const screen = await open();
		expect(screen.queryByTestId("new-location-dialog")).toBeNull();
		await fireEvent.press(
			screen.getByRole("button", { name: "locations.add" }),
		);
		expect(screen.getByTestId("new-location-dialog")).toBeOnTheScreen();
	},
);

it.each([390, 1280])(
	"offers one create action when empty and hides it during a move at %i pixels",
	async (width) => {
		mockWidth = width;
		mockLocations = [];
		const empty = await open();
		expect(
			empty.getAllByRole("button", { name: "locations.add" }),
		).toHaveLength(1);
		await fireEvent.press(empty.getByRole("button", { name: "locations.add" }));
		expect(empty.getByTestId("new-location-dialog")).toBeOnTheScreen();
		await empty.unmount();

		mockLocations = [kitchen, garden];
		const tree = await open();
		expect(
			tree.getByRole("button", { name: "locations.add" }),
		).toBeOnTheScreen();
		await fireEvent.press(tree.getByTestId("move-kitchen"));
		expect(tree.queryByRole("button", { name: "locations.add" })).toBeNull();
		await fireEvent.press(tree.getByTestId("target-garden"));
		expect(tree.queryByRole("button", { name: "locations.add" })).toBeNull();
		await fireEvent.press(tree.getByText("common.cancel"));
		expect(
			tree.getByRole("button", { name: "locations.add" }),
		).toBeOnTheScreen();
	},
);

it.each([
	[390, 0],
	[390, 34],
	[1280, 0],
])(
	"keeps the FAB and final row clear as a queued snackbar wraps at %i pixels with bottom inset %i",
	async (width, bottomInset) => {
		mockWidth = width;
		const screen = await open(bottomInset);
		const fabHeight = 56;
		const measureFab = async () =>
			fireEvent(screen.getByTestId("fab-container"), "layout", {
				nativeEvent: { layout: { height: fabHeight } },
			});
		const expectClearance = (bottom: number) => {
			expect(screen.getByTestId("fab-container-outer-layer")).toHaveStyle({
				bottom,
			});
			expect(
				screen.getByTestId("locations-scroll").props.contentContainerStyle
					.paddingBottom,
			).toBe(fabHeight + bottom + space.md);
		};
		await measureFab();
		expectClearance(space.md);
		await fireEvent.press(screen.getByTestId("move-kitchen"));
		await fireEvent.press(screen.getByTestId("target-garden"));
		await fireEvent.press(screen.getByText("locations.moveHere"));
		await waitFor(() =>
			expect(screen.getByText("Kitchen:garden")).toBeTruthy(),
		);
		await measureFab();
		for (const height of [68, 128, 48]) {
			await fireEvent(screen.getByTestId("surface"), "layout", {
				nativeEvent: { layout: { height } },
			});
			expectClearance(height + bottomInset + space.md + space.md);
		}
		await fireEvent.press(screen.getByText("common.undo"));
		await waitFor(() => expect(screen.getByText("Kitchen:root")).toBeTruthy());
		expectClearance(space.md);
	},
);

it("View menu keeps tree controls reachable below 320px and closes after each action", async () => {
	mockWidth = 195;
	const screen = await open();
	await act(async () => {});
	expect(screen.queryByText("locations.collapseAll")).toBeNull();
	expect(screen.queryByText("locations.expandAll")).toBeNull();
	expect(screen.queryByText("locations.showCards")).toBeNull();

	const choose = async (title: string) => {
		await fireEvent.press(screen.getByText("locations.view"));
		expect(screen.getAllByTestId("menu-view")).toHaveLength(1);
		await act(async () => {
			await fireEvent.press(screen.getByRole("menuitem", { name: title }));
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 300));
		});
		expect(screen.queryByTestId("menu-view")).toBeNull();
	};
	await choose("locations.collapseAll");
	expect(jest.mocked(LocationTree).mock.calls.at(-1)?.[0].collapsed).toEqual(
		new Set(["kitchen"]),
	);
	await choose("locations.expandAll");
	expect(jest.mocked(LocationTree).mock.calls.at(-1)?.[0].collapsed.size).toBe(
		0,
	);
	await choose("locations.showCards");
	expect(jest.mocked(LocationTree).mock.calls.at(-1)?.[0].cardsOpen).toBe(true);
	await choose("locations.hideCards");
	expect(jest.mocked(LocationTree).mock.calls.at(-1)?.[0].cardsOpen).toBe(
		false,
	);
});

it("retains direct tree controls at 320px", async () => {
	const screen = await open();
	await act(async () => {});
	expect(screen.queryByText("locations.view")).toBeNull();
	await fireEvent.press(screen.getByText("locations.collapseAll"));
	expect(jest.mocked(LocationTree).mock.calls.at(-1)?.[0].collapsed).toEqual(
		new Set(["kitchen"]),
	);
	await fireEvent.press(screen.getByText("locations.expandAll"));
	expect(jest.mocked(LocationTree).mock.calls.at(-1)?.[0].collapsed.size).toBe(
		0,
	);
	await fireEvent.press(screen.getByText("locations.showCards"));
	expect(screen.getByText("locations.hideCards")).toBeTruthy();
	await fireEvent.press(screen.getByText("locations.hideCards"));
	expect(jest.mocked(LocationTree).mock.calls.at(-1)?.[0].cardsOpen).toBe(
		false,
	);
});

it.each([
	["drained", undefined],
	["dropped", { code: "subject-not-found" }],
	["refused", { code: "move-own-subtree" }],
])(
	"removes queued snackbar and Undo immediately when intent is %s",
	async (_, reason) => {
		let reconnect!: (state: AppStateStatus) => void;
		const subscription = jest
			.spyOn(AppState, "addEventListener")
			.mockImplementation((_, listener) => {
				reconnect = listener;
				return { remove: jest.fn() };
			});
		try {
			if (reason) jest.mocked(replayIntent).mockRejectedValueOnce(reason);
			const screen = await open();
			await fireEvent.press(screen.getByTestId("move-kitchen"));
			await fireEvent.press(screen.getByTestId("target-garden"));
			await fireEvent.press(screen.getByText("locations.moveHere"));
			await waitFor(() => expect(screen.getByText("common.undo")).toBeTruthy());
			jest.mocked(isOnline).mockReturnValue(true);
			await act(async () => reconnect("active"));
			await waitFor(() =>
				expect(JSON.parse(mockStore["outbox:marcus"])).toEqual([]),
			);
			expect(screen.queryByText("common.undo")).toBeNull();
			expect(
				screen.queryByText(
					'outbox.queuedMove:{"name":"Kitchen","target":"Garden"}',
				),
			).toBeNull();
			if (reason?.code === "move-own-subtree") {
				expect(
					screen.getByText(
						'outbox.refusedMoveCycle:{"name":"Kitchen","target":"Garden"}',
					),
				).toBeTruthy();
			}
		} finally {
			subscription.mockRestore();
		}
	},
);

it("offline Move under projects subject and descendants, adds named Undo, and Undo restores listener tree", async () => {
	const screen = await open();
	await fireEvent.press(screen.getByTestId("move-kitchen"));
	await fireEvent.press(screen.getByTestId("target-garden"));
	await fireEvent.press(screen.getByText("locations.moveHere"));
	await waitFor(() => expect(screen.getByText("Kitchen:garden")).toBeTruthy());
	expect(moveLocation).not.toHaveBeenCalled();
	const persisted = JSON.parse(mockStore["outbox:marcus"]);
	expect(persisted).toEqual([
		expect.objectContaining({
			...queuedMove,
			queuedAt: expect.any(Number),
			rank: expect.any(String),
		}),
	]);
	expect(
		screen.getByText('outbox.queuedMove:{"name":"Kitchen","target":"Garden"}'),
	).toBeTruthy();
	expect(screen.getByText('outbox.pendingChanges:{"count":1}')).toBeTruthy();
	const props = jest.mocked(LocationTree).mock.calls.at(-1)?.[0];
	expect(props?.waitingIds.has("kitchen")).toBe(true);
	expect(
		props?.locations.find((each) => each.id === "pantry")?.ancestorIds,
	).toEqual(["garden", "kitchen"]);
	expect(jest.mocked(useLocationDrag).mock.calls.at(-1)?.[0].locations).toEqual(
		props?.locations,
	);
	expect(jest.mocked(useLocationCounts).mock.calls.at(-1)?.[1]).toEqual(
		props?.locations,
	);
	await fireEvent.press(screen.getByText("common.undo"));
	await waitFor(() => expect(screen.getByText("Kitchen:root")).toBeTruthy());
	expect(JSON.parse(mockStore["outbox:marcus"])).toEqual([]);
	expect(screen.queryByText('outbox.pendingChanges:{"count":1}')).toBeNull();
});

it("restores projected move on remount and counts only current home", async () => {
	mockStore["outbox:marcus"] = JSON.stringify([
		queuedMove,
		{ ...queuedMove, id: "other-home", homeId: "stugan" },
	]);
	const first = await open();
	await waitFor(() => expect(first.getByText("Kitchen:garden")).toBeTruthy());
	expect(first.getByText('outbox.pendingChanges:{"count":1}')).toBeTruthy();
	await first.unmount();
	const second = await open();
	await waitFor(() => expect(second.getByText("Kitchen:garden")).toBeTruthy());
	expect(second.getByText('outbox.pendingChanges:{"count":1}')).toBeTruthy();
});

it("weak connection queues failed online move without error or snap back", async () => {
	jest.mocked(isOnline).mockReturnValue(true);
	jest.mocked(moveLocation).mockRejectedValueOnce({ code: "unavailable" });
	const screen = await open();
	await act(async () => {});
	await fireEvent.press(screen.getByTestId("move-kitchen"));
	await fireEvent.press(screen.getByTestId("target-garden"));
	await fireEvent.press(screen.getByText("locations.moveHere"));
	await waitFor(() => expect(screen.getByText("Kitchen:garden")).toBeTruthy());
	expect(moveLocation).toHaveBeenCalledTimes(1);
	expect(
		screen.getByText('outbox.queuedMove:{"name":"Kitchen","target":"Garden"}'),
	).toBeTruthy();
	expect(screen.queryByText("error.saveFailed")).toBeNull();
});

it("pending deletion hides subtree and keeps count visible even when projected tree is empty", async () => {
	mockLocations = [kitchen, pantry];
	mockStore["outbox:marcus"] = JSON.stringify([
		{
			id: "delete-1",
			homeId: "huset",
			queuedAt: 1,
			title: "Kitchen",
			sourceParentId: null,
			sourceAncestorIds: [],
			kind: "deleteLocation",
			locationId: "kitchen",
		},
	]);
	const screen = await open();
	await waitFor(() =>
		expect(screen.getByText('outbox.pendingChanges:{"count":1}')).toBeTruthy(),
	);
	expect(screen.queryByText("Kitchen:root")).toBeNull();
	expect(screen.queryByText("Pantry:kitchen")).toBeNull();
	expect(screen.queryByText("locations.collapseAll")).toBeNull();
});

it("top-level queue uses distinct copy and successful online move has no waiting state", async () => {
	mockLocations = [garden, location("kitchen", "Kitchen", ["garden"])];
	const first = await open();
	await fireEvent.press(first.getByTestId("move-kitchen"));
	await fireEvent.press(first.getByText("locations.moveUnderTop"));
	await fireEvent.press(first.getByText("locations.moveHere"));
	await waitFor(() =>
		expect(
			first.getByText('outbox.queuedMoveTop:{"name":"Kitchen"}'),
		).toBeTruthy(),
	);
	await first.unmount();
	mockStore = {};
	jest.mocked(isOnline).mockReturnValue(true);
	const second = await open();
	await fireEvent.press(second.getByTestId("move-kitchen"));
	await fireEvent.press(second.getByText("locations.moveUnderTop"));
	await fireEvent.press(second.getByText("locations.moveHere"));
	await waitFor(() => expect(moveLocation).toHaveBeenCalledTimes(1));
	expect(mockStore["outbox:marcus"]).toBeUndefined();
	expect(second.queryByText("common.undo")).toBeNull();
});
