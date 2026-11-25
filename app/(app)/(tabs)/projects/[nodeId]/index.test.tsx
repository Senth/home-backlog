import { fireEvent, render, screen } from "@testing-library/react-native";
import { Dimensions } from "react-native";
import { Provider } from "react-native-paper";
import NodeBoard from "@/app/(app)/(tabs)/projects/[nodeId]/index";
import { finishHref } from "@/components/board/board-href";
import { PaperIcon } from "@/components/ui/PaperIcon";
import type { Node, Status } from "@/models/node";
import { lightTheme } from "@/theme";

const mockDismissTo = jest.fn();
const mockSelection = {
	selecting: false,
	start: jest.fn(),
	clear: jest.fn(),
	state: { ids: [] },
	openMove: jest.fn(),
};
let mockNode: Node | null;
let mockNodes: Node[];
let mockLoading: boolean;
let mockFailed: boolean;
const viewportHeight = 800;
const viewportScale = 1;
const viewportFontScale = 1;

jest.mock("expo-router", () => ({
	router: {
		get dismissTo() {
			return mockDismissTo;
		},
	},
	useLocalSearchParams: () => ({ nodeId: "project" }),
}));
jest.mock("expo-router/react-navigation", () => ({
	useIsFocused: () => true,
}));
jest.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: { column?: string }) =>
			key === "detail.moveToColumn"
				? `Move to ${values?.column}`
				: key === "status.done"
					? "Done"
					: key,
	}),
}));
jest.mock("@/components/auth/AccountMenu", () => ({
	AccountMenu: () => null,
}));
jest.mock("@/components/board/Board", () => ({
	Board: () => null,
}));
jest.mock("@/components/board/BoardFilterSheet", () => ({
	BoardFilterAction: () => null,
	BoardFilterSheet: () => null,
}));
jest.mock("@/components/board/BoardMenu", () => ({
	BoardMenu: () => null,
}));
jest.mock("@/components/board/Breadcrumbs", () => ({
	Breadcrumbs: () => null,
}));
jest.mock("@/components/board/SelectionBar", () => ({
	SelectCardsAction: () => null,
	SelectionBar: () => null,
}));
jest.mock("@/components/ui/BackAction", () => ({
	BackAction: () => null,
}));
jest.mock("@/components/ui/LoadingIndicator", () => ({
	LoadingIndicator: () => null,
}));
jest.mock("@/contexts/HomeContext", () => ({
	useHome: () => ({
		activeHome: { id: "home", name: "Huset", labels: [], members: {} },
	}),
}));
jest.mock("@/hooks/use-ancestors", () => ({
	useAncestors: () => ({ crumbs: [] }),
}));
jest.mock("@/hooks/use-board-filter", () => ({
	useBoardFilter: () => ({
		filter: null,
		loading: false,
		setFilter: jest.fn(),
	}),
}));
jest.mock("@/hooks/use-board-nodes", () => ({
	useBoardNodes: () => ({
		nodes: mockNodes,
		pool: mockNodes,
		loading: mockLoading,
		failed: mockFailed,
		retry: jest.fn(),
	}),
}));
jest.mock("@/hooks/use-card-selection", () => ({
	useCardSelection: () => mockSelection,
}));
jest.mock("@/hooks/use-gone-notice", () => ({
	useGoneNotice: () => ({ showing: false, dismiss: jest.fn() }),
}));
jest.mock("@/hooks/use-locations", () => ({
	useLocations: () => ({ locations: [] }),
}));
jest.mock("@/hooks/use-node", () => ({
	useNode: () => ({ node: mockNode, gone: false }),
}));
jest.mock("@/hooks/use-participant-filter", () => ({
	useParticipantFilter: (nodes: Node[]) => ({
		nodes,
		hidden: [],
		showEveryone: false,
		setShowEveryone: jest.fn(),
	}),
}));
jest.mock("@/models/board-filter", () => ({
	filterActionVisible: () => false,
}));
jest.mock("@/models/home", () => ({
	membersOf: () => [],
}));

function node(id: string, parentId: string | null, status: Status): Node {
	return {
		id,
		parentId,
		status,
		title: id === "project" ? "Renovera badrummet" : "Step",
		columns: [],
		ancestorIds: [],
		labelIds: [],
		visibility: "shared",
	} as unknown as Node;
}

async function renderBoard(width: number) {
	Dimensions.set({
		window: {
			width,
			height: viewportHeight,
			scale: viewportScale,
			fontScale: viewportFontScale,
		},
	});
	return render(
		<Provider theme={lightTheme} settings={{ icon: PaperIcon }}>
			<NodeBoard />
		</Provider>,
	);
}

beforeEach(() => {
	jest.clearAllMocks();
	mockSelection.selecting = false;
	mockNode = node("project", "parent", "execution");
	mockNodes = [node("step", "project", "done")];
	mockLoading = false;
	mockFailed = false;
});

it("shows desktop offer and returns to the parent board", async () => {
	await renderBoard(1280);

	expect(screen.getByText("board.allStepsDone")).toBeOnTheScreen();
	expect(
		screen.getByRole("button", { name: "Move to Done" }),
	).toBeOnTheScreen();
	await fireEvent.press(screen.getByRole("button", { name: "Move to Done" }));
	expect(mockDismissTo).toHaveBeenCalledWith(finishHref("parent", "project"));
});

it("shows phone offer below the home subtitle", async () => {
	await renderBoard(390);

	expect(screen.getByText("Huset")).toBeOnTheScreen();
	expect(screen.getByText("board.allStepsDone")).toBeOnTheScreen();
	expect(
		screen.getByRole("button", { name: "Move to Done" }),
	).toBeOnTheScreen();
});

it.each([
	["zero steps", [], "execution"],
	["unfinished step", [node("step", "project", "next_up")], "execution"],
	["project in Done", [node("step", "project", "done")], "done"],
])("hides offer with %s", async (_name, steps, status) => {
	mockNode = node("project", "parent", status as Status);
	mockNodes = steps;
	await renderBoard(1280);

	expect(screen.queryByText("board.allStepsDone")).toBeNull();
	expect(screen.queryByRole("button", { name: "Move to Done" })).toBeNull();
});

it("hides offer during selection", async () => {
	mockSelection.selecting = true;
	await renderBoard(1280);

	expect(screen.queryByText("board.allStepsDone")).toBeNull();
	expect(screen.queryByRole("button", { name: "Move to Done" })).toBeNull();
});
