import { render, screen } from "@testing-library/react-native";
import { Provider } from "react-native-paper";
import { Breadcrumbs } from "@/components/board/Breadcrumbs";
import { lightTheme } from "@/theme";

jest.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { language: "en-US" },
	}),
}));

function renderCrumbs(isPrivate?: boolean) {
	render(
		<Provider theme={lightTheme}>
			<Breadcrumbs
				crumbs={[{ id: "root", node: null }]}
				current="Kakla om"
				onNavigate={jest.fn()}
				isPrivate={isPrivate}
			/>
		</Provider>,
	);
}

describe("Breadcrumbs", () => {
	it("ends the row with the private fact on a private project's board", () => {
		renderCrumbs(true);

		expect(screen.getByText("board.private")).toBeOnTheScreen();
		expect(
			screen.getByTestId("lock-outline", { includeHiddenElements: true }),
		).toBeOnTheScreen();
		expect(screen.getByText("Kakla om")).toBeOnTheScreen();
	});

	it("says nothing about privacy otherwise", () => {
		renderCrumbs();

		expect(screen.queryByText("board.private")).toBeNull();
	});
});
