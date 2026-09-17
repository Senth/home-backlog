import { fireEvent, render, screen } from "@testing-library/react-native";
// `Provider`, not `ThemeProvider`: the menu mounts a Portal host.
import { Provider } from "react-native-paper";
import { CardMenu } from "@/components/board/CardMenu";
import { moveNode } from "@/data/nodes";
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

jest.mock("@/hooks/use-online-status", () => ({
	useOnlineStatus: () => true,
}));

jest.mock("@expo/vector-icons/MaterialCommunityIcons", () => {
	const { View } = jest.requireActual("react-native");
	return {
		__esModule: true,
		default: ({ name }: { name: string }) => <View testID={name} />,
	};
});

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
		photos: [],
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
				onNotice={() => {}}
				onDetails={() => {}}
			/>
		</Provider>,
	);
}

describe("CardMenu", () => {
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
