import {
	act,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react-native";
import type { ComponentProps } from "react";
// `Provider`, not `ThemeProvider`: the board's Snackbar mounts a Portal host.
import { Provider } from "react-native-paper";
// Paper's Snackbar reads the safe-area insets its provider carries.
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Board } from "@/components/board/Board";
import { BoardColumn } from "@/components/board/BoardColumn";
import { CardMenu } from "@/components/board/CardMenu";
import { DetailsPane } from "@/components/node/DetailsPane";
import type { OutboxIntent } from "@/data/outbox-store";

let mockIntents: OutboxIntent[] = [];
let mockFeedbackVisible = false;

jest.mock("@/contexts/OutboxContext", () => ({
	useOutbox: () => ({
		intents: mockIntents,
		feedbackVisible: mockFeedbackVisible,
		submit: jest.fn(
			async (_intent: unknown, runOnline: () => Promise<void>) => {
				await runOnline();
				return "saved";
			},
		),
		undo: jest.fn(),
	}),
}));
jest.mock("@/data/outbox-store", () => ({
	intentMetadata: jest.fn(() => ({ id: "intent-1" })),
}));

import { Dimensions, Platform, View, type ViewInstance } from "react-native";
import { DragArea } from "@/components/board/DragArea";
import {
	SelectCardsAction,
	SelectionBar,
} from "@/components/board/SelectionBar";
import {
	boardKey,
	cardKey,
	columnKey,
} from "@/components/board/use-board-drag";
import { createNode, moveNodes } from "@/data/nodes";
import { useCardSelection } from "@/hooks/use-card-selection";
import type { BoardFilter } from "@/models/board-filter";
import type { Node } from "@/models/node";
import {
	appendRanks,
	defaultColumns,
	rankAtEnd,
	rankSequence,
} from "@/models/node";
import type { RecordedComponent } from "@/tests/support/record-props";
import { lightTheme } from "@/theme";
import { space } from "@/theme/tokens";

jest.mock("@/components/board/BoardColumn", () => {
	const { recordProps } = require("@/tests/support/record-props");
	const actual = jest.requireActual("@/components/board/BoardColumn");
	return { ...actual, BoardColumn: recordProps(actual.BoardColumn) };
});
jest.mock("@/components/board/CardMenu", () => {
	const { recordProps } = require("@/tests/support/record-props");
	const actual = jest.requireActual("@/components/board/CardMenu");
	return { ...actual, CardMenu: recordProps(actual.CardMenu) };
});
jest.mock("@/components/board/DragArea", () => {
	const { recordProps } = require("@/tests/support/record-props");
	const actual = jest.requireActual("@/components/board/DragArea");
	return { ...actual, DragArea: recordProps(actual.DragArea) };
});

const mockBoardColumn = BoardColumn as RecordedComponent<
	ComponentProps<typeof BoardColumn>
>;
const mockCardMenu = CardMenu as RecordedComponent<
	ComponentProps<typeof CardMenu>
>;
const mockDragArea = DragArea as RecordedComponent<
	ComponentProps<typeof DragArea>
>;
const mockDetailsPane = DetailsPane as RecordedComponent<
	ComponentProps<typeof DetailsPane>
>;

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

const mockPush = jest.fn();
const mockSetParams = jest.fn();
let mockSearchParams: { card?: string } = {};
jest.mock("expo-router", () => ({
	useRouter: () => ({ push: mockPush, setParams: mockSetParams }),
	useLocalSearchParams: () => mockSearchParams,
}));
jest.mock("@/components/node/DetailsPane", () => {
	const { recordProps } = require("@/tests/support/record-props");
	return { DetailsPane: recordProps(() => null) };
});
jest.mock("@react-navigation/native", () => ({
	useIsFocused: () => true,
}));

jest.mock("@/hooks/use-reduced-motion", () => ({
	useReducedMotion: () => false,
}));
jest.mock("@/hooks/use-online-status", () => ({
	useOnlineStatus: () => true,
}));
jest.mock("@/components/ui/AppMenu", () => ({
	AppMenu: ({
		visible,
		anchor,
		children,
	}: ComponentProps<typeof import("@/components/ui/AppMenu").AppMenu>) => (
		<>
			{typeof anchor === "object" && anchor !== null && "x" in anchor
				? null
				: anchor}
			{visible ? children : null}
		</>
	),
}));

// CardMenu reaches BlockerSearchDialog, which imports the Firestore module
// itself — jest's node_modules cannot parse it. The same stub its test uses.
jest.mock("firebase/firestore", () => ({
	getDocsFromServer: jest.fn(),
}));

jest.mock("@/data/nodes", () => ({
	createNode: jest.fn(),
	moveNode: jest.fn(),
	moveNodes: jest.fn(async () => {}),
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

interface TestBoardProps {
	loading: boolean;
	viewport: number;
	nodes?: Node[];
	hidden?: Node[];
	filter?: BoardFilter | null;
	onChangeFilter?: (next: BoardFilter | null) => void;
	onOpenFilter?: () => void;
	reach?: "board" | "subtree";
	pool?: Node[];
	parent?: Node | null;
}

function SelectionBoard({ current }: { current: TestBoardProps }) {
	const selection = useCardSelection(
		`home-1 ${current.parent?.id ?? ""}`,
		(current.reach ?? "board") === "board",
	);
	return (
		<>
			{selection.selecting ? (
				<SelectionBar selection={selection} />
			) : (
				<SelectCardsAction onPress={selection.start} />
			)}
			<Board
				homeId="home-1"
				parent={current.parent ?? null}
				columns={defaultColumns}
				nodes={current.nodes ?? []}
				hidden={current.hidden}
				loading={current.loading}
				filter={current.filter}
				onChangeFilter={current.onChangeFilter}
				onOpenFilter={current.onOpenFilter}
				reach={current.reach}
				pool={current.pool}
				selection={selection}
			/>
		</>
	);
}

const viewportHeight = 844;

async function renderBoard(props: TestBoardProps) {
	Dimensions.set({
		window: {
			width: props.viewport,
			height: viewportHeight,
			scale: 1,
			fontScale: 1,
		},
	});
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
				<SelectionBoard current={current} />
			</Provider>
		</SafeAreaProvider>
	);
	const utils = await render(tree(props));
	// The board measures itself before drawing any column; the layout event is
	// what a browser delivers on mount, and it is the board's own View that
	// carries `onLayout` — not the providers around it.
	const boardView = utils.container.queryAll(
		(child) => child.props.collapsable === false && child.props.onLayout,
	)[0];
	if (!boardView) throw new Error("Board rendered no root view");
	await fireEvent(boardView, "layout", {
		nativeEvent: { layout: { width: props.viewport } },
	});
	return {
		...utils,
		rerenderBoard: (next: typeof props) => utils.rerender(tree(next)),
	};
}

function measureAnchors() {
	jest
		.spyOn(View.prototype as ViewInstance, "measureInWindow")
		.mockImplementation(
			(callback: Parameters<ViewInstance["measureInWindow"]>[0]) =>
				callback(100, 100, 100, 48),
		);
}

describe("Board", () => {
	it.each([390, 720, 1440, 1920])(
		"opens details using the phone route or current board query at %ipx",
		async (viewport) => {
			const card = node("backlog");
			await renderBoard({ loading: false, viewport, nodes: [card] });
			await fireEvent.press(screen.getByText(card.title));
			if (viewport < 720) {
				expect(mockPush).toHaveBeenCalledWith({
					pathname: "/projects/[nodeId]/details",
					params: { nodeId: card.id },
				});
				expect(mockSetParams).not.toHaveBeenCalled();
			} else {
				expect(mockPush).not.toHaveBeenCalled();
				expect(mockSetParams).toHaveBeenCalledWith({ card: card.id });
			}
		},
	);

	it("opens project details from its menu, switches cards, closes, and clears details before drilling in", async () => {
		mockSearchParams = { card: "other-card" };
		const project = { ...node("backlog"), childCount: 1 };
		await renderBoard({ loading: false, viewport: 1920, nodes: [project] });
		const pane = () => mockDetailsPane.getProps()[0];
		expect(pane().nodeId).toBe("other-card");
		await fireEvent.press(screen.getAllByLabelText("board.actions")[0], {
			stopPropagation: jest.fn(),
		});
		await fireEvent.press(screen.getByText("board.details"));
		expect(mockSetParams).toHaveBeenLastCalledWith({ card: project.id });
		await act(() => pane().onOpenNode("third-card"));
		expect(mockSetParams).toHaveBeenLastCalledWith({ card: "third-card" });
		await act(() => pane().onClose());
		expect(mockSetParams).toHaveBeenLastCalledWith({ card: undefined });
		await fireEvent.press(screen.getByText(project.title));
		expect(mockSetParams).toHaveBeenLastCalledWith({ card: undefined });
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/projects/[nodeId]",
			params: { nodeId: project.id },
		});
		mockSearchParams = {};
	});

	it.each([false, true])(
		"keeps an interleaved participant-hidden sibling in displayed order for range selection and drag with filter=%s",
		async (filtered) => {
			jest.replaceProperty(Platform, "OS", "web");
			try {
				const [a, b, c] = ["a", "b", "c"].map((title, index) => ({
					...node("backlog"),
					id: title,
					title,
					rank: rankSequence(null, null, 3)[index],
					participantIds: [title === "b" ? "uid-other" : "uid-me"],
				}));
				await renderBoard({
					loading: false,
					viewport: 1440,
					nodes: [a, c],
					hidden: [b],
					filter: filtered
						? {
								mode: "open",
								reach: "board",
								conditions: [{ field: "priority", anyOf: ["none"] }],
							}
						: null,
				});
				const column = () => mockBoardColumn.getProps()[0];
				expect(column().nodes).toEqual([a, b, c]);
				await fireEvent.press(screen.getByText("a"), {
					nativeEvent: { ctrlKey: true },
				});
				await fireEvent.press(screen.getByText("b"), {
					nativeEvent: { shiftKey: true },
				});
				expect(column().selectedIds).toEqual([a.id, b.id]);
				await fireEvent.press(screen.getByLabelText("board.stopSelecting"));
				const register = column().drag?.register;
				if (!register)
					throw new Error("Board column rendered no drag registry");
				const frame = (top: number, height: number) =>
					({
						measureInWindow: (callback: (...values: number[]) => void) =>
							callback(0, top, 300, height),
					}) as unknown as ViewInstance;
				register(boardKey)(frame(0, 600));
				for (const status of defaultColumns)
					register(columnKey(status))(
						status === "backlog" ? frame(0, 600) : null,
					);
				column().nodes.forEach((card: Node, index: number) => {
					register(cardKey(card.id))(frame(index * 100, 100));
				});
				await act(async () => {
					mockDragArea.getProps()[0].onGrab({ x: 10, y: 50 });
				});
				expect(screen.getByTestId("board-drag-overlay")).toBeOnTheScreen();
				expect(column().nodes).toEqual([a, b, c]);
				expect(column().drag?.gapAt).toBe(0);
				await act(() => {
					mockDragArea.getProps()[0].onMove({ x: 10, y: 175 });
				});
				expect(column().drag?.gapAt).toBe(1);
				await act(() => mockDragArea.getProps()[0].onDrop({ x: 10, y: 175 }));
				expect(moveNodes).toHaveBeenCalledTimes(1);
				const move = jest.mocked(moveNodes).mock.calls[0][1][0];
				expect(move.node.id).toBe(a.id);
				expect(move.rank > b.rank && move.rank < c.rank).toBe(true);
			} finally {
				jest.restoreAllMocks();
			}
		},
	);

	it("card menu starts selection and reuses batch move notice and Undo", async () => {
		const cards = [
			node("backlog"),
			{ ...node("backlog"), id: "second", title: "second", rank: "a1" },
		];
		await renderBoard({ loading: false, viewport: 1440, nodes: cards });
		await fireEvent.press(screen.getAllByLabelText("board.actions")[0], {
			stopPropagation: jest.fn(),
		});
		await fireEvent.press(screen.getByText("board.select"));
		await fireEvent.press(screen.getByText("second"));
		await fireEvent.press(screen.getAllByLabelText("board.actions")[0], {
			stopPropagation: jest.fn(),
		});
		await fireEvent.press(screen.getByText('board.moveCardsTo:{"count":2}'));
		await fireEvent.press(screen.getByText("status.done"));
		const ranks = appendRanks([], 2);
		expect(moveNodes).toHaveBeenCalledWith(
			"home-1",
			cards.map((card, index) => ({
				node: card,
				status: "done",
				rank: ranks[index],
			})),
		);
		expect(
			screen.getByText('board.movedCardsTo:{"count":2,"column":"status.done"}'),
		).toBeOnTheScreen();
		expect(screen.getByLabelText("board.selectCards")).toBeOnTheScreen();
		await fireEvent.press(screen.getByText("common.undo"));
		expect(moveNodes).toHaveBeenLastCalledWith(
			"home-1",
			cards.map((card, index) => ({
				node: { ...card, status: "done", rank: ranks[index] },
				status: card.status,
				rank: card.rank,
			})),
		);
	});
	beforeEach(() => {
		mockIntents = [];
		mockFeedbackVisible = false;
		mockSearchParams = {};
	});

	it.each(["ctrlKey", "metaKey"])(
		"%s starts selection, taps toggle instead of opening",
		async (key) => {
			jest.replaceProperty(Platform, "OS", "web");
			try {
				await renderBoard({
					loading: false,
					viewport: 1440,
					nodes: [node("backlog")],
				});
				await fireEvent.press(screen.getByText("Fix the gutter"), {
					nativeEvent: { [key]: true },
				});
				expect(
					screen.getByLabelText(/^board.selectedCardA11y:/),
				).toBeOnTheScreen();
				expect(mockPush).not.toHaveBeenCalled();
				await fireEvent.press(screen.getByText("Fix the gutter"));
				expect(screen.queryByLabelText(/^board.selectedCardA11y:/)).toBeNull();
				expect(mockPush).not.toHaveBeenCalled();
				await fireEvent.press(screen.getByText("Fix the gutter"));
				expect(
					screen.getByLabelText(/^board.selectedCardA11y:/),
				).toBeOnTheScreen();
				await fireEvent.press(screen.getByLabelText("board.stopSelecting"));
				await fireEvent.press(screen.getByText("Fix the gutter"));
				expect(mockSetParams).toHaveBeenCalledWith({ card: "node-backlog" });
			} finally {
				jest.restoreAllMocks();
			}
		},
	);

	it("shift-click selects a visible range, then another column replaces the notice without changing selection", async () => {
		jest.replaceProperty(Platform, "OS", "web");
		try {
			const cards = ["first", "middle", "last"].map((title, index) => ({
				...node("backlog"),
				id: title,
				title,
				rank: `a${index}`,
			}));
			const other = { ...node("execution"), title: "elsewhere" };
			await renderBoard({
				loading: false,
				viewport: 1440,
				nodes: [...cards, other],
			});
			await act(() =>
				mockCardMenu.getProps()[0].onNotice({ text: "old notice" }),
			);
			await fireEvent.press(screen.getByText("first"), {
				nativeEvent: { ctrlKey: true },
			});
			await fireEvent.press(screen.getByText("last"), {
				nativeEvent: { shiftKey: true },
			});
			expect(screen.getAllByLabelText(/^board.selectedCardA11y:/)).toHaveLength(
				3,
			);
			await fireEvent.press(screen.getByText("elsewhere"));
			expect(
				screen.getByText(
					'board.selectionElsewhere:{"column":"status.backlog"}',
				),
			).toBeOnTheScreen();
			expect(screen.queryByText("old notice")).toBeNull();
			expect(screen.getAllByLabelText(/^board.selectedCardA11y:/)).toHaveLength(
				3,
			);
			expect(mockPush).not.toHaveBeenCalled();
		} finally {
			jest.restoreAllMocks();
		}
	});

	it.each([390, 1440])(
		"select starts empty, Move is disabled or absent, and close restores the controls at %ipx",
		async (viewport) => {
			await renderBoard({ loading: false, viewport, nodes: [node("backlog")] });
			await fireEvent.press(screen.getByLabelText("board.selectCards"));
			expect(
				screen.getByText('board.selectedCount:{"count":0}'),
			).toBeOnTheScreen();
			if (viewport === 390)
				expect(screen.queryByText(/board\.addTo:/)).toBeNull();
			if (viewport === 1440)
				expect(screen.getByText("board.moveTo")).toBeDisabled();
			else expect(screen.queryByText(/board\.moveCardsTo(?::|$)/)).toBeNull();
			await fireEvent.press(screen.getByText("Fix the gutter"));
			expect(
				screen.getByText('board.selectedCount:{"count":1}'),
			).toBeOnTheScreen();
			if (viewport === 390)
				expect(
					screen.getByText('board.moveCardsToFab:{"count":1}'),
				).toBeOnTheScreen();
			await fireEvent.press(screen.getByLabelText("board.stopSelecting"));
			expect(screen.getByLabelText("board.selectCards")).toBeOnTheScreen();
			expect(screen.getAllByText(/board\.addTo:/).length).toBeGreaterThan(0);
		},
	);

	it.each([390, 1440])(
		"moves three selected cards in old order after a hidden destination card, and one Undo restores all at %ipx",
		async (viewport) => {
			const cards = ["first", "middle", "last"].map((title, index) => ({
				...node("backlog"),
				id: title,
				title,
				rank: rankSequence(null, null, 3)[index],
			}));
			const destination = {
				...node("done"),
				title: "hidden destination",
				rank: rankAtEnd(null),
				priority: "high" as const,
			};
			await renderBoard({
				loading: false,
				viewport,
				nodes: [...cards, destination],
				filter: {
					mode: "open",
					reach: "board",
					conditions: [{ field: "priority", anyOf: ["none"] }],
				},
			});
			await fireEvent.press(screen.getByLabelText("board.selectCards"));
			for (const title of ["last", "first", "middle"])
				await fireEvent.press(screen.getByText(title));
			expect(screen.queryByText("hidden destination")).toBeNull();
			measureAnchors();
			await fireEvent.press(
				screen.getByText(
					viewport === 390
						? 'board.moveCardsToFab:{"count":3}'
						: "board.moveTo",
				),
			);
			expect(
				within(screen.getByTestId("selection-move-menu")).queryByRole(
					"menuitem",
					{ name: "status.backlog" },
				),
			).toBeNull();
			await fireEvent.press(screen.getByText("status.done"));
			const ranks = appendRanks([destination], 3);
			expect(moveNodes).toHaveBeenCalledWith(
				"home-1",
				cards.map((card, index) => ({
					node: card,
					status: "done",
					rank: ranks[index],
				})),
			);
			expect(screen.getByLabelText("board.selectCards")).toBeOnTheScreen();
			expect(
				screen.getAllByText(
					'board.movedCardsTo:{"count":3,"column":"status.done"}',
				),
			).toHaveLength(1);
			await fireEvent.press(screen.getByText("common.undo"));
			expect(moveNodes).toHaveBeenLastCalledWith(
				"home-1",
				cards.map((card, index) => ({
					node: { ...card, status: "done", rank: ranks[index] },
					status: card.status,
					rank: card.rank,
				})),
			);
		},
	);

	it("one selected card keeps the existing moved notice", async () => {
		await renderBoard({
			loading: false,
			viewport: 390,
			nodes: [node("backlog")],
		});
		await fireEvent.press(screen.getByLabelText("board.selectCards"));
		await fireEvent.press(screen.getByText("Fix the gutter"));
		measureAnchors();
		await fireEvent.press(screen.getByText('board.moveCardsToFab:{"count":1}'));
		await fireEvent.press(screen.getByText("status.done"));
		expect(
			screen.getByText('board.moved:{"column":"status.done"}'),
		).toBeOnTheScreen();
	});

	it("filter changes prune hidden selections without selecting them again when cleared", async () => {
		jest.replaceProperty(Platform, "OS", "web");
		try {
			const cards = [
				{
					...node("backlog"),
					id: "first",
					title: "first",
					priority: "low" as const,
				},
				{
					...node("backlog"),
					id: "second",
					title: "second",
					priority: "high" as const,
				},
			];
			const props = { loading: false, viewport: 390, nodes: cards };
			const board = await renderBoard(props);
			await fireEvent.press(screen.getByText("first"), {
				nativeEvent: { metaKey: true },
			});
			await fireEvent.press(screen.getByText("second"));
			await board.rerenderBoard({
				...props,
				filter: {
					mode: "open",
					reach: "board",
					conditions: [{ field: "priority", anyOf: ["low"] }],
				},
			});
			expect(screen.queryByText("second")).toBeNull();
			expect(
				screen.getByLabelText('board.selectedCardA11y:{"title":"first"}'),
			).toBeOnTheScreen();
			await board.rerenderBoard(props);
			expect(screen.getByText("second")).toBeOnTheScreen();
			expect(
				screen.getByLabelText('board.selectedCardA11y:{"title":"first"}'),
			).toBeOnTheScreen();
			expect(
				screen.queryByLabelText('board.selectedCardA11y:{"title":"second"}'),
			).toBeNull();
		} finally {
			jest.restoreAllMocks();
		}
	});

	it("subtree reach ignores selection modifiers and opens the card", async () => {
		jest.replaceProperty(Platform, "OS", "web");
		try {
			await renderBoard({
				loading: false,
				viewport: 1440,
				nodes: [node("backlog")],
				reach: "subtree",
			});
			await fireEvent.press(screen.getByText("Fix the gutter"), {
				nativeEvent: { ctrlKey: true },
			});
			expect(mockSetParams).toHaveBeenCalledWith({ card: "node-backlog" });
			expect(screen.queryByLabelText(/^board.selectedCardA11y:/)).toBeNull();
		} finally {
			jest.restoreAllMocks();
		}
	});

	it.each(["intent leaves outbox", "global feedback appears"])(
		"removes card menu queued snackbar immediately when %s",
		async (reason) => {
			mockIntents = [
				{
					id: "intent-1",
					homeId: "home-1",
					kind: "deleteNode",
					nodeId: "node-backlog",
					title: "Fix the gutter",
					queuedAt: 1,
					sourceParentId: null,
					sourceAncestorIds: [],
				},
			];
			const props = { loading: false, viewport: 800, nodes: [node("backlog")] };
			const board = await renderBoard(props);
			await act(() =>
				mockCardMenu.getProps()[0].onNotice({
					text: "outbox.queuedDelete",
					intentId: "intent-1",
					undo: jest.fn(),
				}),
			);
			expect(screen.getByText("outbox.queuedDelete")).toBeOnTheScreen();
			expect(screen.getByText("common.undo")).toBeOnTheScreen();
			if (reason === "intent leaves outbox") mockIntents = [];
			else mockFeedbackVisible = true;
			await board.rerenderBoard(props);
			expect(screen.queryByText("outbox.queuedDelete")).toBeNull();
			expect(screen.queryByText("common.undo")).toBeNull();
		},
	);

	// #266: first launch holds `loading` while the cache-only snapshot waits for
	// the server, and the board below the spinner must not read as empty.
	it("shows the spinner instead of the columns while loading", async () => {
		await renderBoard({ loading: true, viewport: 800 });

		expect(screen.getByLabelText("common.loading")).toBeOnTheScreen();
		expect(screen.queryByTestId("board-column-backlog")).not.toBeOnTheScreen();
		expect(screen.queryByTestId("board-column-done")).not.toBeOnTheScreen();
	});

	it("shows the columns once loading has ended", async () => {
		await renderBoard({ loading: false, viewport: 800 });

		expect(screen.getByTestId("board-column-backlog")).toBeOnTheScreen();
		// #310: the empty board is said per column, not once above them all.
		expect(screen.getAllByText("board.columnEmpty")).toHaveLength(4);
		expect(screen.queryByText("board.empty")).not.toBeOnTheScreen();
	});

	it("renders the cards it was given once loaded", async () => {
		await renderBoard({
			loading: false,
			viewport: 800,
			nodes: [node("backlog"), node("done")],
		});

		expect(screen.getAllByText("Fix the gutter")).toHaveLength(2);
		expect(screen.queryByText("board.empty")).not.toBeOnTheScreen();
	});

	it("leaves the private line off the cards of a private project's own board", async () => {
		const privately = (status: Node["status"]): Node => ({
			...node(status),
			visibility: "private",
		});
		await renderBoard({
			loading: false,
			viewport: 800,
			parent: { ...privately("backlog"), id: "project" },
			nodes: [privately("backlog")],
		});

		expect(screen.getByText("Fix the gutter")).toBeOnTheScreen();
		expect(screen.queryByText("board.private")).not.toBeOnTheScreen();
	});

	it("does not offer the compact add FAB while loading", async () => {
		await renderBoard({ loading: true, viewport: 400 });

		expect(screen.queryByText(/board\.addTo:/)).not.toBeOnTheScreen();
	});

	it("offers the compact add FAB once loading has ended", async () => {
		await renderBoard({ loading: false, viewport: 400 });

		expect(screen.getByText(/board\.addTo:/)).toBeOnTheScreen();
	});

	/**
	 * #90: the participant filter hides the column's last card, but that card
	 * still owns the column's end. A new card ranks after it — where the next
	 * unhide finds it — instead of stacking on top of it.
	 */
	it("ranks a new card after the sibling the filter is hiding", async () => {
		const hiddenCard = node("backlog");
		hiddenCard.id = "hidden";
		hiddenCard.rank = "V5";
		mockUser = { uid: "uid-me" };
		await renderBoard({
			loading: false,
			viewport: 400,
			nodes: [],
			hidden: [hiddenCard],
		});

		await fireEvent.press(screen.getByText(/board\.addTo:/));
		await fireEvent.changeText(screen.getByDisplayValue(""), "Paint the shed");
		await fireEvent.press(screen.getByText("board.add"));

		expect(createNode).toHaveBeenCalledWith(
			"home-1",
			"uid-me",
			expect.objectContaining({
				status: "backlog",
				rank: rankAtEnd("V5"),
			}),
		);
	});

	it("hides the cards the stored filter's conditions do not answer to", async () => {
		const matching = node("backlog");
		matching.id = "matching";
		matching.priority = "low";
		const held = node("backlog");
		held.id = "held";
		held.priority = "urgent";

		await renderBoard({
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

	it("with a filter on and nothing matching, one board-level state replaces the columns", async () => {
		const onChangeFilter = jest.fn();
		await renderBoard({
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

		await fireEvent.press(screen.getByText("board.clearFilters"));
		expect(onChangeFilter).toHaveBeenCalledWith(null);
	});

	it("says the filter is hiding things even when the preference is what hides them", async () => {
		// A participant-hidden card in every column and a filter on top: the
		// filter is the active lens, so its sentence is the one on screen.
		await renderBoard({
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

		await renderBoard({
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
		expect(mockDragArea.getProps()).toHaveLength(0);
		// And the Done column says its bound.
		expect(screen.getByText('board.doneWindow:{"count":30}')).toBeOnTheScreen();
		await act(async () => {});
	});

	it("this-board reach keeps the drag and does not bound the Done column", async () => {
		const props = {
			loading: false,
			viewport: 800,
			nodes: [node("backlog")],
		};
		const board = await renderBoard(props);

		expect(mockDragArea.getProps().length).toBeGreaterThan(0);
		expect(screen.queryByText(/board\.doneWindow/)).not.toBeOnTheScreen();
		await board.rerenderBoard({ ...props, reach: "subtree" });
		expect(mockDragArea.getProps()).toHaveLength(0);
	});

	/**
	 * #62 review: the match context memoized `now`, so a board left open kept
	 * filtering against the moment it last re-rendered — past a window
	 * boundary the answer stays wrong until some unrelated prop changes.
	 * Reading the clock in the render body is what lets a re-render move it.
	 */
	it("re-reads the clock on re-render, so a stale now cannot hold a window edge", async () => {
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
			const board = await renderBoard({
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
			await board.rerenderBoard({
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
