import { fireEvent, render, screen } from "@testing-library/react-native";
// `Provider`, not `ThemeProvider`: the dialog mounts a Portal host.
import { Provider } from "react-native-paper";
// Paper's dialog reads the safe-area insets its provider carries.
import { SafeAreaProvider } from "react-native-safe-area-context";
import { CardEditSheet } from "@/components/overview/CardEditSheet";
import { lightTheme } from "@/theme";
import { space } from "@/theme/tokens";

jest.mock("react-i18next", () => ({
	// Keys asserted, not sentences — the sheet is translated elsewhere, and
	// `Board.test.tsx` carries the reasoning.
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values === undefined ? key : `${key}:${JSON.stringify(values)}`,
		i18n: { language: "en-US" },
	}),
}));

const renderSheet = (onSave = jest.fn()) =>
	render(
		<SafeAreaProvider
			initialMetrics={{
				insets: { top: 0, bottom: 0, left: 0, right: 0 },
				frame: { x: 0, y: 0, width: space.none, height: space.none },
			}}
		>
			<Provider theme={lightTheme}>
				<CardEditSheet
					visible
					card={null}
					scope="home"
					members={[]}
					locations={[]}
					onDismiss={() => {}}
					onSave={onSave}
				/>
			</Provider>
		</SafeAreaProvider>,
	);

describe("CardEditSheet", () => {
	/**
	 * #229 closed: a blank card plus one tap on *Färdiga* is the whole
	 * Recently done card — the mode selector seeds the window, the order and
	 * the empty state, and Save writes exactly what the seed carries.
	 */
	it("turns a blank card into Recently done with one tap on Färdiga", () => {
		const onSave = jest.fn();
		renderSheet(onSave);

		fireEvent.press(screen.getByText("overview.cards.editor.mode.done"));
		fireEvent.changeText(
			screen.getByTestId("overview-card-edit-title"),
			"Recently done",
		);
		fireEvent.press(screen.getByText("manageHome.save"));

		expect(onSave).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "done",
				conditions: [{ field: "completedAt", is: "within" }],
				sort: { field: "completedAt", direction: "desc" },
				empty: { mode: "hide" },
			}),
			"home",
		);
	});

	it("offers the done card no status, due or waiting group, and open no completed window", () => {
		renderSheet();

		expect(screen.queryByText("overview.cards.field.status")).toBeTruthy();
		expect(screen.queryByText("detail.dueDate")).toBeTruthy();
		expect(screen.queryByText("board.blocked")).toBeTruthy();
		expect(screen.queryByText("overview.cards.field.completedAt")).toBeNull();

		fireEvent.press(screen.getByText("overview.cards.editor.mode.done"));

		expect(screen.queryByText("overview.cards.field.status")).toBeNull();
		expect(screen.queryByText("detail.dueDate")).toBeNull();
		expect(screen.queryByText("board.blocked")).toBeNull();
		expect(screen.queryByText("overview.cards.field.completedAt")).toBeTruthy();

		fireEvent.press(screen.getByText("overview.cards.editor.mode.open"));

		expect(screen.queryByText("overview.cards.field.completedAt")).toBeNull();
		expect(screen.queryByText("overview.cards.field.status")).toBeTruthy();
	});

	it("says what each mode collects", () => {
		renderSheet();

		expect(
			screen.getByText("overview.cards.editor.mode.openDescription"),
		).toBeTruthy();
		fireEvent.press(screen.getByText("overview.cards.editor.mode.done"));
		expect(
			screen.getByText("overview.cards.editor.mode.doneDescription"),
		).toBeTruthy();
	});

	it("says where each scope stores the card, all three of them", () => {
		renderSheet();

		expect(
			screen.getByText("overview.cards.editor.scope.homeDescription"),
		).toBeTruthy();
		fireEvent.press(screen.getByText("overview.cards.editor.scope.global"));
		expect(
			screen.getByText("overview.cards.editor.scope.globalDescription"),
		).toBeTruthy();
		fireEvent.press(screen.getByText("overview.cards.editor.scope.shared"));
		expect(
			screen.getByText("overview.cards.editor.scope.sharedDescription"),
		).toBeTruthy();
	});
});
