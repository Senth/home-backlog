import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react-native";
import type { ComponentProps } from "react";
// `Provider`, not `ThemeProvider`: the menu mounts a Portal host.
import { Provider } from "react-native-paper";
import { CardMenu, type Notice } from "@/components/board/CardMenu";
import {
	boardOnce,
	deleteNode,
	getNode,
	moveNode,
	reparentNode,
} from "@/data/nodes";
import type { OutboxIntent } from "@/data/outbox-store";
import type { Node } from "@/models/node";
import { defaultColumns, rankAtEnd } from "@/models/node";
import { lightTheme } from "@/theme";

jest.mock("react-i18next", () => ({
	// Keys asserted, not sentences — `BoardCard.test.tsx` for the reasoning.
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
	useHome: () => ({ activeHome: null }),
}));

let mockOnline = true;
const mockSubmit = jest.fn();
const mockUndo = jest.fn();
jest.mock("@/contexts/OutboxContext", () => ({
	useOutbox: () => ({ submit: mockSubmit, undo: mockUndo }),
}));
jest.mock("@/data/outbox-store", () => ({
	intentMetadata: (homeId: string, subject: Node) => ({
		id: "intent-1",
		homeId,
		queuedAt: 1,
		title: subject.title,
		sourceParentId: subject.parentId,
		sourceAncestorIds: subject.ancestorIds,
	}),
}));
jest.mock("@/hooks/use-online-status", () => ({
	useOnlineStatus: () => mockOnline,
}));

// The menu's under page reads the board above from the server; the gate under
// test is not it. The same stub `Board.test.tsx` uses.
jest.mock("firebase/firestore", () => ({
	getDocsFromServer: jest.fn(),
}));

jest.mock("@/data/nodes", () => ({
	boardOnce: jest.fn(() => Promise.resolve([])),
	deleteNode: jest.fn(),
	getNode: jest.fn(),
	moveNode: jest.fn(() => Promise.resolve()),
	moveErrorKey: jest.fn(),
	reparentNode: jest.fn(),
	updateNode: jest.fn(),
}));

function node(id: string, overrides: Partial<Node> = {}): Node {
	return {
		id,
		title: `Card ${id}`,
		status: "backlog",
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
		...overrides,
	};
}

function renderMenu(props: {
	nodes: Node[];
	hidden?: Node[];
	node?: Node;
	parent?: Node | null;
	onNotice?: (notice: Notice) => void;
	selection?: ComponentProps<typeof CardMenu>["selection"];
}) {
	return render(
		<Provider theme={lightTheme}>
			<CardMenu
				homeId="home-1"
				node={props.node ?? node("self")}
				parent={props.parent ?? null}
				columns={defaultColumns}
				nodes={props.nodes}
				hidden={props.hidden}
				blockers={new Map()}
				onNotice={props.onNotice ?? (() => {})}
				onDetails={() => {}}
				selection={props.selection}
			/>
		</Provider>,
	);
}

describe("CardMenu", () => {
	const selection = (ids: string[] = []) => ({
		state: {
			status: ids.length ? ("backlog" as const) : null,
			ids,
			anchor: ids[0] ?? null,
		},
		toggleCard: jest.fn(),
		moveTo: jest.fn(),
	});

	it("Select starts selection with this card", () => {
		const picking = selection();
		renderMenu({ nodes: [node("self")], selection: picking });
		fireEvent.press(screen.getByLabelText("board.actions"), {
			stopPropagation: jest.fn(),
		});
		expect(screen.getByText("board.moveTo")).toBeTruthy();
		fireEvent.press(screen.getByText("board.select"));
		expect(picking.toggleCard).toHaveBeenCalledWith(node("self"));
	});

	it("selected card offers Deselect and moves the whole selection through the batch path", () => {
		const picking = selection(["self", "other"]);
		renderMenu({ nodes: [node("self"), node("other")], selection: picking });
		fireEvent.press(screen.getByLabelText("board.actions"), {
			stopPropagation: jest.fn(),
		});
		expect(screen.getByText("board.deselect")).toBeTruthy();
		expect(screen.queryByText("board.select")).toBeNull();
		fireEvent.press(screen.getByText('board.moveCardsTo:{"count":2}'));
		fireEvent.press(screen.getByText("status.done"));
		expect(picking.moveTo).toHaveBeenCalledWith("done");
		expect(moveNode).not.toHaveBeenCalled();
	});

	it("Deselect toggles only this card", () => {
		const picking = selection(["self", "other"]);
		renderMenu({ nodes: [node("self"), node("other")], selection: picking });
		fireEvent.press(screen.getByLabelText("board.actions"), {
			stopPropagation: jest.fn(),
		});
		fireEvent.press(screen.getByText("board.deselect"));
		expect(picking.toggleCard).toHaveBeenCalledWith(node("self"));
		expect(picking.moveTo).not.toHaveBeenCalled();
	});

	it("unselected card in selection column offers Select but moves only itself", () => {
		const picking = selection(["other"]);
		renderMenu({ nodes: [node("self"), node("other")], selection: picking });
		fireEvent.press(screen.getByLabelText("board.actions"), {
			stopPropagation: jest.fn(),
		});
		expect(screen.getByText("board.select")).toBeEnabled();
		fireEvent.press(screen.getByText("board.moveTo"));
		fireEvent.press(screen.getByText("status.done"));
		expect(moveNode).toHaveBeenCalledWith(
			"home-1",
			node("self"),
			"done",
			rankAtEnd(null),
		);
		expect(picking.moveTo).not.toHaveBeenCalled();
	});

	it("selected card Change position still moves only this card", () => {
		const picking = selection(["self", "other"]);
		renderMenu({
			nodes: [node("self"), node("other", { rank: "V5" })],
			selection: picking,
		});
		fireEvent.press(screen.getByLabelText("board.actions"), {
			stopPropagation: jest.fn(),
		});
		fireEvent.press(screen.getByText("board.changePosition"));
		fireEvent.press(
			screen.getByText('board.positionAfter:{"title":"Card other"}'),
		);
		expect(moveNode).toHaveBeenCalledWith(
			"home-1",
			node("self"),
			"backlog",
			rankAtEnd("V5"),
		);
		expect(picking.moveTo).not.toHaveBeenCalled();
	});
	beforeEach(() => {
		mockOnline = true;
		mockUndo.mockReset().mockResolvedValue(undefined);
		jest.mocked(reparentNode).mockReset().mockResolvedValue();
		jest.mocked(deleteNode).mockReset().mockResolvedValue();
		jest.mocked(boardOnce).mockReset().mockResolvedValue([]);
		jest.mocked(getNode).mockReset();
		mockSubmit
			.mockReset()
			.mockImplementation(
				async (_intent: OutboxIntent, runOnline: () => Promise<void>) => {
					if (!mockOnline) return "queued";
					try {
						await runOnline();
						return "saved";
					} catch (reason) {
						if ((reason as { code?: string }).code === "unavailable")
							return "queued";
						throw reason;
					}
				},
			);
	});

	it("offline enables Move under and Delete, removes root hint but keeps search gate", () => {
		mockOnline = false;
		renderMenu({ nodes: [node("self"), node("host")] });
		fireEvent.press(screen.getByLabelText("board.actions"), {
			stopPropagation: jest.fn(),
		});
		expect(screen.getByText("board.moveUnder")).toBeEnabled();
		expect(screen.getByText("board.delete")).toBeEnabled();
		expect(screen.queryByText("board.offlineHint")).toBeNull();
		fireEvent.press(screen.getByText("board.waitingOn"));
		expect(screen.getByText("board.waitingSearch")).toBeDisabled();
		expect(screen.getByText("board.offlineHint")).toBeTruthy();
	});

	it("offline Delete submits hierarchy and offers queued Undo", async () => {
		mockOnline = false;
		const onNotice = jest.fn();
		renderMenu({ nodes: [node("self")], onNotice });
		fireEvent.press(screen.getByLabelText("board.actions"), {
			stopPropagation: jest.fn(),
		});
		fireEvent.press(screen.getByText("board.delete"));
		fireEvent.press(
			within(screen.getByTestId("delete-card-self")).getByText("board.delete"),
		);
		await waitFor(() => expect(onNotice).toHaveBeenCalled());
		expect(mockSubmit).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "deleteNode",
				nodeId: "self",
				homeId: "home-1",
				title: "Card self",
				sourceParentId: null,
				sourceAncestorIds: [],
			}),
			expect.any(Function),
		);
		expect(deleteNode).not.toHaveBeenCalled();
		expect(onNotice.mock.calls[0][0].text).toBe(
			'outbox.queuedDelete:{"name":"Card self"}',
		);
		expect(onNotice.mock.calls[0][0].intentId).toBe("intent-1");
		await act(async () => onNotice.mock.calls[0][0].undo());
		expect(mockUndo).toHaveBeenCalledWith("intent-1");
	});

	it("unavailable Delete offers queued Undo and reports failed cancellation", async () => {
		jest.mocked(deleteNode).mockRejectedValueOnce({ code: "unavailable" });
		mockUndo.mockRejectedValueOnce(new Error("Storage failed"));
		const onNotice = jest.fn();
		renderMenu({ nodes: [node("self")], onNotice });
		fireEvent.press(screen.getByLabelText("board.actions"), {
			stopPropagation: jest.fn(),
		});
		fireEvent.press(screen.getByText("board.delete"));
		fireEvent.press(
			within(screen.getByTestId("delete-card-self")).getByText("board.delete"),
		);
		await waitFor(() => expect(onNotice).toHaveBeenCalled());
		expect(deleteNode).toHaveBeenCalled();
		expect(onNotice.mock.calls[0][0].text).toBe(
			'outbox.queuedDelete:{"name":"Card self"}',
		);
		await act(async () => onNotice.mock.calls[0][0].undo());
		expect(mockUndo).toHaveBeenCalledWith("intent-1");
		expect(onNotice).toHaveBeenLastCalledWith({ text: "error.saveFailed" });
	});

	it("offline Move under queues without fetching destination board and names target", async () => {
		mockOnline = false;
		const onNotice = jest.fn();
		renderMenu({ nodes: [node("self"), node("host")], onNotice });
		fireEvent.press(screen.getByLabelText("board.actions"), {
			stopPropagation: jest.fn(),
		});
		fireEvent.press(screen.getByText("board.moveUnder"));
		fireEvent.press(screen.getByText("Card host"));
		await waitFor(() => expect(onNotice).toHaveBeenCalled());
		expect(mockSubmit.mock.calls[0][0]).toEqual(
			expect.objectContaining({
				kind: "reparentNode",
				nodeId: "self",
				parentId: "host",
				targetTitle: "Card host",
				title: "Card self",
				sourceParentId: null,
				sourceAncestorIds: [],
				rank: rankAtEnd(null),
			}),
		);
		expect(boardOnce).not.toHaveBeenCalled();
		expect(reparentNode).not.toHaveBeenCalled();
		expect(onNotice.mock.calls[0][0].text).toBe(
			'outbox.queuedMove:{"name":"Card self","target":"Card host"}',
		);
		expect(onNotice.mock.calls[0][0].intentId).toBe("intent-1");
		await act(async () => onNotice.mock.calls[0][0].undo());
		expect(mockUndo).toHaveBeenCalledWith("intent-1");
	});

	it("offline up-one-level queues known ancestor id even when its title is uncached", async () => {
		mockOnline = false;
		const onNotice = jest.fn();
		renderMenu({
			node: node("self", {
				parentId: "parent",
				ancestorIds: ["ancestor", "parent"],
			}),
			parent: node("parent", {
				parentId: "ancestor",
				ancestorIds: ["ancestor"],
			}),
			nodes: [],
			onNotice,
		});
		fireEvent.press(screen.getByLabelText("board.actions"), {
			stopPropagation: jest.fn(),
		});
		fireEvent.press(screen.getByText("board.moveUnder"));
		fireEvent.press(screen.getByText("board.moveUnderUp"));
		await waitFor(() => expect(onNotice).toHaveBeenCalled());
		expect(mockSubmit.mock.calls[0][0]).toEqual(
			expect.objectContaining({
				parentId: "ancestor",
				sourceParentId: "parent",
				sourceAncestorIds: ["ancestor", "parent"],
			}),
		);
		expect(getNode).not.toHaveBeenCalled();
	});

	it("online move keeps destination-board rank and existing success notice", async () => {
		jest
			.mocked(boardOnce)
			.mockResolvedValue([node("child", { parentId: "host", rank: "V5" })]);
		const onNotice = jest.fn();
		renderMenu({ nodes: [node("self"), node("host")], onNotice });
		fireEvent.press(screen.getByLabelText("board.actions"), {
			stopPropagation: jest.fn(),
		});
		fireEvent.press(screen.getByText("board.moveUnder"));
		fireEvent.press(screen.getByText("Card host"));
		await waitFor(() => expect(onNotice).toHaveBeenCalled());
		expect(reparentNode).toHaveBeenCalledWith(
			"home-1",
			expect.objectContaining({ id: "self" }),
			expect.objectContaining({ id: "host" }),
			rankAtEnd("V5"),
			"uid-me",
		);
		expect(onNotice.mock.calls[0][0]).toEqual({
			text: 'board.movedUnder:{"title":"Card host"}',
		});
	});

	it("offline promotion uses top-level copy and offers Undo", async () => {
		mockOnline = false;
		const onNotice = jest.fn();
		renderMenu({
			node: node("self", { parentId: "parent", ancestorIds: ["parent"] }),
			parent: node("parent"),
			nodes: [],
			onNotice,
		});
		fireEvent.press(screen.getByLabelText("board.actions"), {
			stopPropagation: jest.fn(),
		});
		fireEvent.press(screen.getByText("board.moveUnder"));
		fireEvent.press(screen.getByText("board.moveUnderTop"));
		await waitFor(() => expect(onNotice).toHaveBeenCalled());
		expect(mockSubmit.mock.calls[0][0].parentId).toBeNull();
		expect(onNotice.mock.calls[0][0].text).toBe(
			'outbox.queuedMoveTop:{"name":"Card self"}',
		);
		expect(onNotice.mock.calls[0][0].undo).toEqual(expect.any(Function));
	});

	it("unavailable ancestor lookup queues up-one-level rather than treating it as refusal", async () => {
		jest.mocked(getNode).mockResolvedValueOnce(undefined);
		const onNotice = jest.fn();
		renderMenu({
			node: node("self", {
				parentId: "parent",
				ancestorIds: ["ancestor", "parent"],
			}),
			parent: node("parent", { parentId: "ancestor" }),
			nodes: [],
			onNotice,
		});
		fireEvent.press(screen.getByLabelText("board.actions"), {
			stopPropagation: jest.fn(),
		});
		fireEvent.press(screen.getByText("board.moveUnder"));
		fireEvent.press(screen.getByText("board.moveUnderUp"));
		await waitFor(() => expect(onNotice).toHaveBeenCalled());
		expect(mockSubmit.mock.calls[0][0].parentId).toBe("ancestor");
		expect(onNotice.mock.calls[0][0].undo).toEqual(expect.any(Function));
		expect(boardOnce).not.toHaveBeenCalled();
	});

	it("unavailable during destination read queues instead of losing move", async () => {
		jest.mocked(boardOnce).mockRejectedValueOnce({ code: "unavailable" });
		const onNotice = jest.fn();
		renderMenu({ nodes: [node("self"), node("host")], onNotice });
		fireEvent.press(screen.getByLabelText("board.actions"), {
			stopPropagation: jest.fn(),
		});
		fireEvent.press(screen.getByText("board.moveUnder"));
		fireEvent.press(screen.getByText("Card host"));
		await waitFor(() => expect(onNotice).toHaveBeenCalled());
		expect(onNotice.mock.calls[0][0].text).toBe(
			'outbox.queuedMove:{"name":"Card self","target":"Card host"}',
		);
		expect(onNotice.mock.calls[0][0].undo).toEqual(expect.any(Function));
	});
	/**
	 * #90: a filter that hides the destination column's last card must not
	 * shorten the column the move lands at the end of. The real sibling set
	 * holds the hidden one, and `rankAtEnd` reads its rank.
	 */
	it("lands a moved card at the true end of a column whose last card is hidden", () => {
		renderMenu({
			nodes: [node("self")],
			hidden: [node("hidden", { status: "done", rank: "V5" })],
		});

		fireEvent.press(screen.getByLabelText("board.actions"), {
			stopPropagation: () => {},
		});
		fireEvent.press(screen.getByText("board.moveTo"));
		fireEvent.press(screen.getByText("status.done"));

		expect(moveNode).toHaveBeenCalledWith(
			"home-1",
			expect.objectContaining({ id: "self" }),
			"done",
			rankAtEnd("V5"),
		);
	});

	it("offers a hidden sibling as a host for Move under", () => {
		renderMenu({
			nodes: [node("self")],
			hidden: [
				node("host", {
					status: "done",
					childCount: 2,
					rank: "V5",
				}),
			],
		});

		fireEvent.press(screen.getByLabelText("board.actions"), {
			stopPropagation: () => {},
		});
		fireEvent.press(screen.getByText("board.moveUnder"));

		expect(screen.getByText("Card host")).toBeOnTheScreen();
	});

	/**
	 * Subtree reach (#62 review): a deep card's siblings are the children of
	 * *its own* parent, not of the board's. Deriving them from the board's
	 * parent appends a level-1 card's rank into the deep card's own column —
	 * out of order, and on top of a rank that may already be taken.
	 */
	it("reads a deep card's siblings from its own parent, not the board's", () => {
		renderMenu({
			node: node("self", { parentId: "mid" }),
			parent: node("board-card"),
			nodes: [
				node("mid", { parentId: "board-card" }),
				node("cousin", {
					parentId: "board-card",
					status: "done",
					rank: "V9",
				}),
				node("sib", { parentId: "mid", status: "done", rank: "V5" }),
			],
		});

		fireEvent.press(screen.getByLabelText("board.actions"), {
			stopPropagation: () => {},
		});
		fireEvent.press(screen.getByText("board.moveTo"));
		fireEvent.press(screen.getByText("status.done"));

		expect(moveNode).toHaveBeenCalledWith(
			"home-1",
			expect.objectContaining({ id: "self" }),
			"done",
			rankAtEnd("V5"),
		);
	});
});
