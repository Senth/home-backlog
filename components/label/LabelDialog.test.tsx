import {
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react-native";
import { TextInput as RNTextInput } from "react-native";
import { HelperText, Provider } from "react-native-paper";
import { LabelDialog } from "@/components/label/LabelDialog";
import {
	createLabel,
	deleteLabel,
	recolorLabel,
	reiconLabel,
	renameLabel,
} from "@/data/homes";
import type { LabelWithId } from "@/models/label";
import { defaultLabelHue, lightTheme } from "@/theme";

jest.mock("react-i18next", () => ({
	// The keys are asserted rather than the sentences — the parity of the locale
	// files is `yarn invariants`' job, and pinning English here would fail on a
	// rewording that is not a behavior change.
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values === undefined ? key : `${key}:${JSON.stringify(values)}`,
		i18n: { language: "en-US" },
	}),
}));

// The dialog reads the home's set for a new label's rank off the homes
// listener, the same source the screen holds.
let mockHomes: { id: string; labels: LabelWithId[] }[] = [];
jest.mock("@/contexts/HomeContext", () => ({
	useHome: () => ({ homes: mockHomes }),
}));

jest.mock("@/data/homes", () => ({
	createLabel: jest.fn(() => Promise.resolve()),
	renameLabel: jest.fn(() => Promise.resolve()),
	recolorLabel: jest.fn(() => Promise.resolve()),
	reiconLabel: jest.fn(() => Promise.resolve()),
	deleteLabel: jest.fn(() => Promise.resolve()),
}));

// The real icon set loads its font map asynchronously — the same double the
// card face's test uses, with the glyph name as the testID. `icon-search`
// reads the glyph map once at module scope to build the catalog, so the
// double carries a handful of real names.
jest.mock("@expo/vector-icons/MaterialCommunityIcons", () => {
	const { View } = jest.requireActual("react-native");
	const Mock = ({ name }: { name: string }) => <View testID={name} />;
	const withGlyphMap = Mock as unknown as { glyphMap: Record<string, number> };
	withGlyphMap.glyphMap = {
		bolt: 0x0e33,
		home: 0x0f2d,
		"home-outline": 0x0f2e,
		sprout: 0x0f95,
		star: 0x0f4c,
	};
	return { __esModule: true, default: Mock };
});

function label(id: string, overrides: Partial<LabelWithId> = {}): LabelWithId {
	return {
		id,
		title: `Label ${id}`,
		icon: "sprout",
		color: "teal",
		rank: id,
		...overrides,
	};
}

function renderDialog(props: Partial<Parameters<typeof LabelDialog>[0]> = {}) {
	return render(
		<Provider theme={lightTheme}>
			<LabelDialog
				homeId="home-1"
				label={null}
				onDismiss={() => {}}
				onError={() => {}}
				testID="label-dialog"
				{...props}
			/>
		</Provider>,
	);
}

/** The name field, which Paper renders as one inner `TextInput`. */
function nameField() {
	return screen.UNSAFE_getByType(RNTextInput);
}

/** The title sentence, whose slot `HelperText` keeps even while hidden. */
function titleHelper() {
	return screen
		.UNSAFE_getAllByType(HelperText)
		.find((helper) => helper.props.type === "error");
}

afterEach(() => {
	mockHomes = [];
});

describe("LabelDialog", () => {
	it("creates at the end of the home's set", () => {
		mockHomes = [{ id: "home-1", labels: [label("l1", { rank: "V0" })] }];
		renderDialog();
		expect(
			screen.getByRole("button", { name: "icons.pick.star" }).props
				.accessibilityState,
		).toEqual({ selected: true });

		fireEvent.changeText(nameField(), "Winter");
		fireEvent.press(screen.getByText("labels.add"));

		expect(createLabel).toHaveBeenCalledWith(
			"home-1",
			expect.objectContaining({
				title: "Winter",
				icon: "star",
				color: defaultLabelHue,
			}),
		);
		const input = jest.mocked(createLabel).mock.calls[0][1];
		expect(input.rank).not.toBeNull();
		expect(input.rank > "V0").toBe(true);
	});

	it("says what is missing in a sentence and writes nothing", () => {
		renderDialog();

		fireEvent.press(screen.getByText("labels.add"));

		expect(createLabel).not.toHaveBeenCalled();
		expect(titleHelper()?.props.visible).toBe(true);
		expect(screen.getByText("labels.titleRequired")).toBeOnTheScreen();
	});

	it("refuses a name another label already carries and writes nothing", () => {
		mockHomes = [
			{ id: "home-1", labels: [label("taken", { title: "Winter" })] },
		];
		renderDialog();

		fireEvent.changeText(nameField(), "winter");
		fireEvent.press(screen.getByText("labels.add"));

		expect(createLabel).not.toHaveBeenCalled();
		expect(titleHelper()?.props.visible).toBe(true);
		expect(screen.getByText("labels.titleTaken")).toBeOnTheScreen();
	});

	it("saves a rename to the label's own title in another case", () => {
		mockHomes = [{ id: "home-1", labels: [label("l1", { title: "Winter" })] }];
		renderDialog({ label: label("l1", { title: "Winter" }) });

		fireEvent.changeText(nameField(), "winter");
		fireEvent.press(screen.getByText("labels.save"));

		expect(renameLabel).toHaveBeenCalledWith("home-1", "l1", "winter");
	});

	it("edits only what changed", () => {
		mockHomes = [{ id: "home-1", labels: [] }];
		renderDialog({ label: label("l1") });

		fireEvent.changeText(nameField(), "Renamed");
		fireEvent.press(screen.getByLabelText("labels.hue.indigo"));
		fireEvent.press(screen.getByText("labels.save"));

		expect(renameLabel).toHaveBeenCalledWith("home-1", "l1", "Renamed");
		expect(recolorLabel).toHaveBeenCalledWith("home-1", "l1", "indigo");
		expect(reiconLabel).not.toHaveBeenCalled();
	});

	it("writes nothing for a save that changes nothing", () => {
		mockHomes = [{ id: "home-1", labels: [] }];
		renderDialog({ label: label("l1") });

		fireEvent.press(screen.getByText("labels.save"));

		expect(renameLabel).not.toHaveBeenCalled();
		expect(recolorLabel).not.toHaveBeenCalled();
		expect(reiconLabel).not.toHaveBeenCalled();
	});

	it("updates the card preview when a pick changes and saves only the icon once", () => {
		renderDialog({ label: label("l1") });

		fireEvent.press(
			screen.getByRole("button", { name: "icons.pick.hammer-wrench" }),
		);
		expect(
			screen.getByRole("button", { name: "icons.pick.hammer-wrench" }).props
				.accessibilityState,
		).toEqual({ selected: true });
		for (const gutter of screen.getAllByTestId("card-gutter")) {
			expect(
				within(gutter).getByTestId("hammer-wrench", {
					includeHiddenElements: true,
				}),
			).toBeOnTheScreen();
		}
		fireEvent.press(screen.getByText("labels.save"));

		expect(reiconLabel).toHaveBeenCalledTimes(1);
		expect(reiconLabel).toHaveBeenCalledWith("home-1", "l1", "hammer-wrench");
		expect(renameLabel).not.toHaveBeenCalled();
		expect(recolorLabel).not.toHaveBeenCalled();
	});

	it("deletes from the edit path only, after a confirmation of its own", () => {
		renderDialog({ label: label("l1") });

		fireEvent.press(screen.getByText("labels.delete"));
		expect(screen.getByText("labels.deleteBody")).toBeOnTheScreen();

		// The confirmation's confirming button shares its label with the action
		// that opened it, so take the one the confirmation rendered last.
		const answers = screen.getAllByText("labels.delete");
		fireEvent.press(answers[answers.length - 1]);

		expect(deleteLabel).toHaveBeenCalledWith("home-1", "l1");
	});

	it("offers no delete on the create path", () => {
		renderDialog();

		expect(screen.queryByText("labels.delete")).toBeNull();
	});

	it("opens the icon picker and takes the chosen glyph back", () => {
		mockHomes = [{ id: "home-1", labels: [] }];
		renderDialog({ label: label("l1") });

		fireEvent.press(screen.getByRole("button", { name: "icons.more" }));
		expect(screen.getByText("labels.iconPickerTitle")).toBeOnTheScreen();
		fireEvent.press(screen.getByRole("button", { name: "home-outline" }));
		expect(
			screen.getByRole("button", { name: "icons.more" }).props
				.accessibilityState,
		).toEqual({ selected: true });

		fireEvent.press(screen.getByText("labels.save"));
		expect(reiconLabel).toHaveBeenCalledWith("home-1", "l1", "home-outline");
	});
});
