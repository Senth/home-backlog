import { fireEvent, render, screen } from "@testing-library/react-native";
import { ThemeProvider } from "react-native-paper";
import { NotesField } from "@/components/node/NotesField";
import enUS from "@/i18n/locales/en-US.json";
import svSE from "@/i18n/locales/sv-SE.json";
import { lightTheme } from "@/theme";

jest.mock("react-i18next", () => ({
	// The keys are asserted rather than the sentences: both locale files are
	// checked for parity by `yarn invariants`, and a test that pinned the
	// English would fail on a rewording that is not a behavior change.
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values === undefined ? key : `${key}:${JSON.stringify(values)}`,
		i18n: { language: "en-US" },
	}),
}));

// The background trigger is the app's, not this field's behavior under test.
jest.mock("@/hooks/use-background", () => ({
	useBackgrounded: () => {},
}));

// The real icon set loads its font map asynchronously, which warns about
// updates outside `act`. A test double that carries the glyph name is enough —
// the glyph itself is Paper's. See `BoardCard.test.tsx` for the full story.
jest.mock("@expo/vector-icons/MaterialCommunityIcons", () => {
	const { View } = jest.requireActual("react-native");
	return {
		__esModule: true,
		default: ({ name }: { name: string }) => <View testID={name} />,
	};
});

function renderNotes(stored: string, onSave: (notes: string) => void) {
	return render(
		<ThemeProvider theme={lightTheme}>
			<NotesField label="Notes" stored={stored} onSave={onSave} />
		</ThemeProvider>,
	);
}

describe("NotesField", () => {
	it("reads as text on arrival, with the editor closed", () => {
		renderNotes("Wait for the grout to cure.", () => {});

		expect(screen.getByText("Wait for the grout to cure.")).toBeOnTheScreen();
		expect(screen.queryByPlaceholderText("detail.notesPlaceholder")).toBeNull();
		expect(screen.getByText("Notes")).toBeOnTheScreen();
	});

	it("opens the editor from the pencil", () => {
		renderNotes("", () => {});

		fireEvent.press(screen.getByLabelText("detail.notesEdit"));
		expect(
			screen.getByPlaceholderText("detail.notesPlaceholder"),
		).toBeOnTheScreen();
	});

	it("opens the editor from the label too", () => {
		renderNotes("Somebody wrote this.", () => {});

		fireEvent.press(screen.getByText("Notes"));
		expect(
			screen.getByPlaceholderText("detail.notesPlaceholder"),
		).toBeOnTheScreen();
	});

	it("blur writes and closes: the editor goes away again", () => {
		const onSave = jest.fn();
		renderNotes("", onSave);

		fireEvent.press(screen.getByLabelText("detail.notesEdit"));
		fireEvent.changeText(
			screen.getByPlaceholderText("detail.notesPlaceholder"),
			"Acetyl fog, do not sand",
		);
		fireEvent(screen.getByPlaceholderText("detail.notesPlaceholder"), "blur");

		expect(onSave).toHaveBeenCalledWith("Acetyl fog, do not sand");
		expect(screen.queryByPlaceholderText("detail.notesPlaceholder")).toBeNull();
	});

	it("does not carry an unsaved draft across to the next card", () => {
		const onSave = jest.fn();
		const view = render(
			<ThemeProvider theme={lightTheme}>
				<NotesField key="a" label="Notes" stored="First card" onSave={onSave} />
			</ThemeProvider>,
		);

		fireEvent.press(screen.getByLabelText("detail.notesEdit"));
		fireEvent.changeText(
			screen.getByPlaceholderText("detail.notesPlaceholder"),
			"A draft",
		);

		// Re-pointed at another card: the draft flushes to the card it was
		// typed on, and the new card opens on its own note, in read mode.
		view.rerender(
			<ThemeProvider theme={lightTheme}>
				<NotesField
					key="b"
					label="Notes"
					stored="Second card"
					onSave={onSave}
				/>
			</ThemeProvider>,
		);

		expect(onSave).toHaveBeenCalledWith("A draft");
		expect(screen.getByText("Second card")).toBeOnTheScreen();
		expect(screen.queryByPlaceholderText("detail.notesPlaceholder")).toBeNull();
	});

	it("carries the edit label in both locales", () => {
		expect(enUS.detail.notesEdit.length).toBeGreaterThan(0);
		expect(svSE.detail.notesEdit.length).toBeGreaterThan(0);
	});
});
