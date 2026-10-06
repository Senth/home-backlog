import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { Provider, Snackbar } from "react-native-paper";
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
jest.mock("@/components/location/LocationDialog", () => ({
	LocationDialog: () => null,
}));
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
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
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

function open() {
	return render(
		<SafeAreaProvider
			initialMetrics={{
				insets: { top: 0, bottom: 0, left: 0, right: 0 },
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
	mockStore = {};
	mockLocations = [kitchen, garden, pantry];
	jest.mocked(isOnline).mockReturnValue(false);
	jest.mocked(moveLocation).mockReset().mockResolvedValue();
	jest.mocked(replayIntent).mockReset().mockResolvedValue();
	jest
		.spyOn(AppState, "addEventListener")
		.mockReturnValue({ remove: jest.fn() });
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
			const screen = open();
			fireEvent.press(screen.getByTestId("move-kitchen"));
			fireEvent.press(screen.getByTestId("target-garden"));
			fireEvent.press(screen.getByText("locations.moveHere"));
			await waitFor(() => expect(screen.getByText("common.undo")).toBeTruthy());
			jest.mocked(isOnline).mockReturnValue(true);
			await act(async () => reconnect("active"));
			await waitFor(() =>
				expect(JSON.parse(mockStore["outbox:marcus"])).toEqual([]),
			);
			expect(
				screen.UNSAFE_getAllByType(Snackbar).filter((bar) => bar.props.action),
			).toHaveLength(0);
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
	const screen = open();
	fireEvent.press(screen.getByTestId("move-kitchen"));
	fireEvent.press(screen.getByTestId("target-garden"));
	fireEvent.press(screen.getByText("locations.moveHere"));
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
	fireEvent.press(screen.getByText("common.undo"));
	await waitFor(() => expect(screen.getByText("Kitchen:root")).toBeTruthy());
	expect(JSON.parse(mockStore["outbox:marcus"])).toEqual([]);
	expect(screen.queryByText('outbox.pendingChanges:{"count":1}')).toBeNull();
});

it("restores projected move on remount and counts only current home", async () => {
	mockStore["outbox:marcus"] = JSON.stringify([
		queuedMove,
		{ ...queuedMove, id: "other-home", homeId: "stugan" },
	]);
	const first = open();
	await waitFor(() => expect(first.getByText("Kitchen:garden")).toBeTruthy());
	expect(first.getByText('outbox.pendingChanges:{"count":1}')).toBeTruthy();
	first.unmount();
	const second = open();
	await waitFor(() => expect(second.getByText("Kitchen:garden")).toBeTruthy());
	expect(second.getByText('outbox.pendingChanges:{"count":1}')).toBeTruthy();
});

it("weak connection queues failed online move without error or snap back", async () => {
	jest.mocked(isOnline).mockReturnValue(true);
	jest.mocked(moveLocation).mockRejectedValueOnce({ code: "unavailable" });
	const screen = open();
	await act(async () => {});
	fireEvent.press(screen.getByTestId("move-kitchen"));
	fireEvent.press(screen.getByTestId("target-garden"));
	fireEvent.press(screen.getByText("locations.moveHere"));
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
	const screen = open();
	await waitFor(() =>
		expect(screen.getByText('outbox.pendingChanges:{"count":1}')).toBeTruthy(),
	);
	expect(screen.queryByText("Kitchen:root")).toBeNull();
	expect(screen.queryByText("Pantry:kitchen")).toBeNull();
	expect(screen.queryByText("locations.collapseAll")).toBeNull();
});

it("top-level queue uses distinct copy and successful online move has no waiting state", async () => {
	mockLocations = [garden, location("kitchen", "Kitchen", ["garden"])];
	const first = open();
	fireEvent.press(first.getByTestId("move-kitchen"));
	fireEvent.press(first.getByText("locations.moveUnderTop"));
	fireEvent.press(first.getByText("locations.moveHere"));
	await waitFor(() =>
		expect(
			first.getByText('outbox.queuedMoveTop:{"name":"Kitchen"}'),
		).toBeTruthy(),
	);
	first.unmount();
	mockStore = {};
	jest.mocked(isOnline).mockReturnValue(true);
	const second = open();
	fireEvent.press(second.getByTestId("move-kitchen"));
	fireEvent.press(second.getByText("locations.moveUnderTop"));
	fireEvent.press(second.getByText("locations.moveHere"));
	await waitFor(() => expect(moveLocation).toHaveBeenCalledTimes(1));
	expect(mockStore["outbox:marcus"]).toBeUndefined();
	expect(second.queryByText("common.undo")).toBeNull();
});
