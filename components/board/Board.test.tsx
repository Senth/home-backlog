import { act, fireEvent, render, screen } from "@testing-library/react-native";
// `Provider`, not `ThemeProvider`: the board's Snackbar mounts a Portal host.
import { Provider, TextInput } from "react-native-paper";
// Paper's Snackbar reads the safe-area insets its provider carries.
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { ReactTestInstance } from "react-test-renderer";
import { Board } from "@/components/board/Board";
import { DragArea } from "@/components/board/DragArea";
import { createNode } from "@/data/nodes";
import type { BoardFilter } from "@/models/board-filter";
import type { Node } from "@/models/node";
import { defaultColumns, rankAtEnd } from "@/models/node";
import { lightTheme } from "@/theme";
import { space } from "@/theme/tokens";

jest.mock("react-i18next", () => ({
	// Keys asserted, not sentences — `BoardCard.test.tsx` for the reasoning.
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values === undefined ? key : `${key}:${JSON.stringify(values)}`,
		i18n: { language: "en-US" },
	}),
}));

let mockUser: { uid: string } | null = null;

jest.mock("@/contexts/AuthContext", () => ({
	useAuth: () => ({ user: mockUser }),
}));

jest.mock("@/contexts/HomeContext", () => ({
	useHome: () => ({ activeHome: null }),
}));

jest.mock("expo-router", () => ({
	useRouter: () => ({ push: jest.fn() }),
}));

// The real icon set loads its font map asynchronously — see `BoardCard.test.tsx`.
jest.mock("@expo/vector-icons/MaterialCommunityIcons", () => {
	const { View } = jest.requireActual("react-native");
	return {
		__esModule: true,
		default: ({ name }: { name: string }) => <View testID={name} />,
	};
});

jest.mock("@/hooks/use-reduced-motion", () => ({
	useReducedMotion: () => false,
}));

// CardMenu reaches BlockerSearchDialog, which imports the Firestore module
// itself — jest's node_modules cannot parse it. The same stub its test uses.
jest.mock("firebase/firestore", () => ({
	getDocsFromServer: jest.fn(),
}));

jest.mock("@/data/nodes", () => ({
	createNode: jest.fn(),
	moveNode: jest.fn(),
	// `useLabelAncestors` getDocs the chain nodes the pool does not hold; a
	// test's pool holds them all, so the fetch never fires.
	getNode: jest.fn(),
}));

// A live listener per cross-board blocker id; the gate under test is not it,
// and mocking it keeps Firestore out of a render test.
jest.mock("@/components/board/BlockerWatcher", () => ({
	BlockerWatcher: () => null,
}));

function node(status: Node["status"]): Node {
	return {
		id: `node-${status}`,
		title: "Fix the gutter",
		status,
		rank: "a0",
		parentId: null,
		ancestorIds: [],
		locationId: null,
		locationAncestorIds: [],
		participantIds: [],
		assigneeIds: [],
		visibility: "shared",
		columns: [...defaultColumns],
		childCount: 0,
		doneCount: 0,
		dueDate: null,
		priority: null,
		blockedBy: [],
		labelIds: [],
		notes: "",
		checklist: [],
		effort: null,
		attachments: [],
		attachmentCount: 0,
		attachmentDisplay: "count",
		heroAttachmentId: null,
		archived: false,
		createdVia: "app",
		completedAt: null,
		createdAt: null,
		createdBy: "uid-a",
		updatedAt: null,
	};
}

function renderBoard(props: {
	loading: boolean;
	viewport: number;
	nodes?: Node[];
	hidden?: Node[];
	filter?: BoardFilter | null;
	onChangeFilter?: (next: BoardFilter | null) => void;
	onOpenFilter?: () => void;
	reach?: "board" | "subtree";
	pool?: Node[];
}) {
	// Held as a tree over the props, so a test can re-render the same board
	// with the same props — the shape a board left open re-renders in.
	const tree = (current: typeof props) => (
		// Without `initialMetrics` the provider renders nothing in the test
		// environment; the values themselves are read by nothing under test.
		<SafeAreaProvider
			initialMetrics={{
				insets: { top: 0, bottom: 0, left: 0, right: 0 },
				frame: { x: 0, y: 0, width: space.none, height: space.none },
			}}
		>
			<Provider theme={lightTheme}>
				<Board
					homeId="home-1"
					parent={null}
					columns={defaultColumns}
					nodes={current.nodes ?? []}
					hidden={current.hidden}
					loading={current.loading}
					filter={current.filter}
					onChangeFilter={current.onChangeFilter}
					onOpenFilter={current.onOpenFilter}
					reach={current.reach}
					pool={current.pool}
				/>
			</Provider>
		</SafeAreaProvider>
	);
	const utils = render(tree(props));
	// The board measures itself before drawing any column; the layout event is
	// what a browser delivers on mount, and it is the board's own View that
	// carries `onLayout` — not the providers around it.
	const boardView = utils
		.UNSAFE_getByType(Board)
		.children.find(
			(child): child is ReactTestInstance => typeof child !== "string",
		);
	if (!boardView) throw new Error("Board rendered no root view");
	fireEvent(boardView, "layout", {
		nativeEvent: { layout: { width: props.viewport } },
	});
	return {
		...utils,
		rerenderBoard: (next: typeof props) => utils.rerender(tree(next)),
	};
}

describe("Board", () => {
	// #266: first launch holds `loading` while the cache-only snapshot waits for
	// the server, and the board below the spinner must not read as empty.
	it("shows the spinner instead of the columns while loading", () => {
		renderBoard({ loading: true, viewport: 800 });

		expect(screen.getByLabelText("common.loading")).toBeOnTheScreen();
		expect(screen.queryByTestId("board-column-backlog")).not.toBeOnTheScreen();
		expect(screen.queryByTestId("board-column-done")).not.toBeOnTheScreen();
	});

	it("shows the columns once loading has ended", () => {
		renderBoard({ loading: false, viewport: 800 });

		expect(screen.getByTestId("board-column-backlog")).toBeOnTheScreen();
		// #310: the empty board is said per column, not once above them all.
		expect(screen.getAllByText("board.columnEmpty")).toHaveLength(4);
		expect(screen.queryByText("board.empty")).not.toBeOnTheScreen();
	});

	it("renders the cards it was given once loaded", () => {
		renderBoard({
			loading: false,
			viewport: 800,
			nodes: [node("backlog"), node("done")],
		});

		expect(screen.getAllByText("Fix the gutter")).toHaveLength(2);
		expect(screen.queryByText("board.empty")).not.toBeOnTheScreen();
	});

	it("does not offer the compact add FAB while loading", () => {
		renderBoard({ loading: true, viewport: 400 });

		expect(screen.queryByText(/board\.addTo:/)).not.toBeOnTheScreen();
	});

	it("offers the compact add FAB once loading has ended", () => {
		renderBoard({ loading: false, viewport: 400 });

		expect(screen.getByText(/board\.addTo:/)).toBeOnTheScreen();
	});

	/**
	 * #90: the participant filter hides the column's last card, but that card
	 * still owns the column's end. A new card ranks after it — where the next
	 * unhide finds it — instead of stacking on top of it.
	 */
	it("ranks a new card after the sibling the filter is hiding", () => {
		const hiddenCard = node("backlog");
		hiddenCard.id = "hidden";
		hiddenCard.rank = "V5";
		mockUser = { uid: "uid-me" };
		renderBoard({
			loading: false,
			viewport: 400,
			nodes: [],
			hidden: [hiddenCard],
		});

		fireEvent.press(screen.getByText(/board\.addTo:/));
		fireEvent.changeText(screen.UNSAFE_getByType(TextInput), "Paint the shed");
		fireEvent.press(screen.getByText("board.add"));

		expect(createNode).toHaveBeenCalledWith(
			"home-1",
			"uid-me",
			expect.objectContaining({
				status: "backlog",
				rank: rankAtEnd("V5"),
			}),
		);
	});

	it("hides the cards the stored filter's conditions do not answer to", () => {
		const matching = node("backlog");
		matching.id = "matching";
		matching.priority = "low";
		const held = node("backlog");
		held.id = "held";
		held.priority = "urgent";

		renderBoard({
			loading: false,
			viewport: 800,
			nodes: [matching, held],
			filter: {
				mode: "open",
				reach: "board",
				conditions: [{ field: "priority", anyOf: ["low"] }],
			},
			onChangeFilter: jest.fn(),
		});

		expect(screen.getByText("Fix the gutter")).toBeOnTheScreen();
		expect(screen.getAllByText("Fix the gutter")).toHaveLength(1);
		// The pills say what is being held back, and tapping one opens the sheet.
		expect(screen.getByTestId("board-filter-pill-priority")).toBeOnTheScreen();
	});

	it("with a filter on and nothing matching, one board-level state replaces the columns", () => {
		const onChangeFilter = jest.fn();
		renderBoard({
			loading: false,
			viewport: 800,
			nodes: [],
			filter: {
				mode: "open",
				reach: "board",
				conditions: [{ field: "priority", anyOf: ["low"] }],
			},
			onChangeFilter,
		});

		expect(screen.getByText("board.filterEmpty")).toBeOnTheScreen();
		expect(screen.queryByTestId("board-column-backlog")).not.toBeOnTheScreen();
		expect(screen.queryByText("board.empty")).not.toBeOnTheScreen();

		fireEvent.press(screen.getByText("board.clearFilters"));
		expect(onChangeFilter).toHaveBeenCalledWith(null);
	});

	it("says the filter is hiding things even when the preference is what hides them", () => {
		// A participant-hidden card in every column and a filter on top: the
		// filter is the active lens, so its sentence is the one on screen.
		renderBoard({
			loading: false,
			viewport: 800,
			nodes: [],
			hidden: [node("backlog")],
			filter: {
				mode: "open",
				reach: "subtree",
				conditions: [{ field: "priority", anyOf: ["low"] }],
			},
		});

		expect(screen.getByText("board.filterEmpty")).toBeOnTheScreen();
		expect(screen.queryByText("board.allHidden")).not.toBeOnTheScreen();
	});

	it("subtree reach shows a card three levels down that an inherited label answers for", async () => {
		const boardId = "board-1";
		const project = node("backlog");
		project.id = "project";
		project.parentId = boardId;
		project.ancestorIds = [boardId];
		project.labelIds = ["garden"];
		const deep = node("backlog");
		deep.id = "deep";
		deep.parentId = "project";
		deep.ancestorIds = [boardId, "project"];
		deep.labelIds = [];

		renderBoard({
			loading: false,
			viewport: 800,
			nodes: [deep],
			pool: [project, deep],
			reach: "subtree",
			filter: {
				mode: "open",
				reach: "subtree",
				conditions: [{ field: "labelIds", anyOf: ["garden"] }],
			},
			onChangeFilter: jest.fn(),
		});

		// The card carries no label of its own; the one it inherits from the
		// project above it is what lets it through (D7 and F3 in one).
		expect(screen.getAllByText("Fix the gutter")).toHaveLength(1);
		// The drag is off in subtree reach: nothing on this board can be
		// carried, because nothing here has a neighbour to swap ranks with.
		expect(screen.UNSAFE_queryAllByType(DragArea)).toHaveLength(0);
		// And the Done column says its bound.
		expect(screen.getByText('board.doneWindow:{"count":30}')).toBeOnTheScreen();
		await act(async () => {});
	});

	it("this-board reach keeps the drag and does not bound the Done column", () => {
		renderBoard({
			loading: false,
			viewport: 800,
			nodes: [node("backlog")],
		});

		expect(screen.UNSAFE_queryAllByType(DragArea).length).toBeGreaterThan(0);
		expect(screen.queryByText(/board\.doneWindow/)).not.toBeOnTheScreen();
	});

	/**
	 * #62 review: the match context memoized `now`, so a board left open kept
	 * filtering against the moment it last re-rendered — past a window
	 * boundary the answer stays wrong until some unrelated prop changes.
	 * Reading the clock in the render body is what lets a re-render move it.
	 */
	it("re-reads the clock on re-render, so a stale now cannot hold a window edge", () => {
		jest.useFakeTimers();
		try {
			// The card is due in five days — outside the filter's three-day
			// "coming up" window, so it starts held back.
			jest.setSystemTime(new Date(2026, 8, 10, 12, 0, 0));
			const coming = node("backlog");
			coming.id = "coming";
			coming.dueDate = "2026-09-15";
			// One identity across renders: a new array or a new callback would
			// recompute the match context on its own, and the gate would pass
			// for the wrong reason.
			const cards = [coming];
			const onChangeFilter = jest.fn();

			const filter = {
				mode: "open",
				reach: "board",
				conditions: [{ field: "dueDate", is: "comingUp", n: 3 }],
			} as BoardFilter;
			const board = renderBoard({
				loading: false,
				viewport: 800,
				nodes: cards,
				filter,
				onChangeFilter,
			});
			expect(screen.queryByText("Fix the gutter")).toBeNull();

			// Three days pass with the board open. A re-render is what a live
			// update delivers, and the window has since closed over the card.
			jest.setSystemTime(new Date(2026, 8, 13, 12, 0, 0));
			board.rerenderBoard({
				loading: false,
				viewport: 800,
				nodes: cards,
				filter,
				onChangeFilter,
			});

			expect(screen.getByText("Fix the gutter")).toBeOnTheScreen();
		} finally {
			jest.useRealTimers();
		}
	});
});
