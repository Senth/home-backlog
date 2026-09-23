import { fireEvent, render, screen } from "@testing-library/react-native";
import { Provider } from "react-native-paper";
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

// `Provider`, not `ThemeProvider`: the editor is a sheet (#237), and the
// portal it renders into needs the host `Provider` sets up — the same
// renderer `LabelDialog.test.tsx` uses for its dialog.
function renderNotes(stored: string, onSave: (notes: string) => void) {
	return render(
		<Provider theme={lightTheme}>
			<NotesField label="Notes" stored={stored} onSave={onSave} />
		</Provider>,
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

	it("the dismissal writes and closes: the editor goes away again", () => {
		const onSave = jest.fn();
		renderNotes("", onSave);

		fireEvent.press(screen.getByLabelText("detail.notesEdit"));
		fireEvent.changeText(
			screen.getByPlaceholderText("detail.notesPlaceholder"),
			"Acetyl fog, do not sand",
		);
		fireEvent.press(screen.getByTestId("notes-editor-backdrop"));

		expect(onSave).toHaveBeenCalledWith("Acetyl fog, do not sand");
		expect(screen.queryByPlaceholderText("detail.notesPlaceholder")).toBeNull();
	});

	it("does not carry an unsaved draft across to the next card", () => {
		const onSave = jest.fn();
		const view = render(
			<Provider theme={lightTheme}>
				<NotesField key="a" label="Notes" stored="First card" onSave={onSave} />
			</Provider>,
		);

		fireEvent.press(screen.getByLabelText("detail.notesEdit"));
		fireEvent.changeText(
			screen.getByPlaceholderText("detail.notesPlaceholder"),
			"A draft",
		);

		// Re-pointed at another card: the draft flushes to the card it was
		// typed on, and the new card opens on its own note, in read mode.
		view.rerender(
			<Provider theme={lightTheme}>
				<NotesField
					key="b"
					label="Notes"
					stored="Second card"
					onSave={onSave}
				/>
			</Provider>,
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
