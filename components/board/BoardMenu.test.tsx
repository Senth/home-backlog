import {
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react-native";
import type { ComponentProps } from "react";
import { Provider } from "react-native-paper";
import { BoardMenu } from "@/components/board/BoardMenu";
import { type Node, newNodeData } from "@/models/node";
import { lightTheme } from "@/theme";

jest.mock("expo-router", () => ({
	useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock("@/data/nodes", () => ({ updateNode: jest.fn() }));

const node: Node = {
	...newNodeData({ title: "Project", rank: "a0" }),
	id: "project",
	completedAt: null,
	createdAt: null,
	createdBy: "member",
	updatedAt: null,
};

function renderMenu(props: Partial<ComponentProps<typeof BoardMenu>> = {}) {
	return render(
		<Provider theme={lightTheme}>
			<BoardMenu homeId="home" node={node} {...props} />
		</Provider>,
	);
}

describe("BoardMenu", () => {
	it("offers Filter first and opens the sheet when pressed", () => {
		const onFilter = jest.fn();
		renderMenu({ onFilter });
		fireEvent.press(screen.getByLabelText("board.boardActions"));
		const menu = screen.getByTestId("board-menu-project");
		expect(within(menu).getAllByRole("menuitem")[0]).toHaveTextContent(
			"board.filter.title",
		);
		fireEvent.press(screen.getByText("board.filter.title"));
		expect(onFilter).toHaveBeenCalledTimes(1);
	});

	it("marks an active filter even when the project has no details", () => {
		renderMenu({ filterSet: true, onFilter: jest.fn() });
		expect(screen.getByTestId("board-menu-mark")).toBeOnTheScreen();
	});

	it("keeps the details mark without a Filter route", () => {
		renderMenu({ node: { ...node, notes: "Details" } });
		expect(screen.getByTestId("board-menu-mark")).toBeOnTheScreen();
	});

	it("has no Filter item or mark when neither is needed", () => {
		renderMenu();
		expect(screen.queryByTestId("board-menu-mark")).toBeNull();
		fireEvent.press(screen.getByLabelText("board.boardActions"));
		expect(screen.queryByText("board.filter.title")).toBeNull();
		expect(screen.getByText("detail.title")).toBeOnTheScreen();
	});
});
