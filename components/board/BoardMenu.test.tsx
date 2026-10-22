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

async function renderMenu(
	props: Partial<ComponentProps<typeof BoardMenu>> = {},
) {
	return await render(
		<Provider theme={lightTheme}>
			<BoardMenu homeId="home" node={node} {...props} />
		</Provider>,
	);
}

describe("BoardMenu", () => {
	it("offers Filter first and opens the sheet when pressed", async () => {
		const onFilter = jest.fn();
		await renderMenu({ onFilter });
		await fireEvent.press(screen.getByLabelText("board.boardActions"));
		const menu = screen.getByTestId("board-menu-project");
		expect(within(menu).getAllByRole("menuitem")[0]).toHaveTextContent(
			"board.filter.title",
		);
		await fireEvent.press(screen.getByText("board.filter.title"));
		expect(onFilter).toHaveBeenCalledTimes(1);
	});

	it("marks an active filter even when the project has no details", async () => {
		await renderMenu({ filterSet: true, onFilter: jest.fn() });
		expect(screen.getByTestId("board-menu-mark")).toBeOnTheScreen();
	});

	it("keeps the details mark without a Filter route", async () => {
		await renderMenu({ node: { ...node, notes: "Details" } });
		expect(screen.getByTestId("board-menu-mark")).toBeOnTheScreen();
	});

	it("has no Filter item or mark when neither is needed", async () => {
		await renderMenu();
		expect(screen.queryByTestId("board-menu-mark")).toBeNull();
		await fireEvent.press(screen.getByLabelText("board.boardActions"));
		expect(screen.queryByText("board.filter.title")).toBeNull();
		expect(screen.getByText("detail.title")).toBeOnTheScreen();
	});
});
