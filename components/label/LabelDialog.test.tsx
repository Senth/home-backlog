import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ComponentProps } from "react";
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
import { toHex } from "@/models/label-color";
import type { RecordedComponent } from "@/tests/support/record-props";
import { defaultLabelHue, lightTheme } from "@/theme";

jest.mock("react-native-paper", () => {
	const { recordProps } = require("@/tests/support/record-props");
	const actual = jest.requireActual("react-native-paper");
	return { ...actual, HelperText: recordProps(actual.HelperText) };
});

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

function nameField() {
	return screen.getByDisplayValue(/.*/);
}

const mockHelperText = HelperText as unknown as RecordedComponent<
	ComponentProps<typeof HelperText>
>;

function titleHelper() {
	return mockHelperText.getProps().find((helper) => helper.type === "error");
}

afterEach(() => {
	mockHomes = [];
});

describe("LabelDialog", () => {
	it("creates at the end of the home's set", async () => {
		mockHomes = [{ id: "home-1", labels: [label("l1", { rank: "V0" })] }];
		await renderDialog();
		expect(
			screen.getByRole("button", { name: "icons.pick.star" }).props
				.accessibilityState,
		).toEqual({ selected: true });

		await fireEvent.changeText(nameField(), "Winter");
		await fireEvent.press(screen.getByText("labels.add"));

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

	it("says what is missing in a sentence and writes nothing", async () => {
		await renderDialog();

		await fireEvent.press(screen.getByText("labels.add"));

		expect(createLabel).not.toHaveBeenCalled();
		expect(titleHelper()?.visible).toBe(true);
		expect(screen.getByText("labels.titleRequired")).toBeOnTheScreen();
	});

	it("refuses a name another label already carries and writes nothing", async () => {
		mockHomes = [
			{ id: "home-1", labels: [label("taken", { title: "Winter" })] },
		];
		await renderDialog();

		await fireEvent.changeText(nameField(), "winter");
		await fireEvent.press(screen.getByText("labels.add"));

		expect(createLabel).not.toHaveBeenCalled();
		expect(titleHelper()?.visible).toBe(true);
		expect(screen.getByText("labels.titleTaken")).toBeOnTheScreen();
	});

	it("saves a rename to the label's own title in another case", async () => {
		mockHomes = [{ id: "home-1", labels: [label("l1", { title: "Winter" })] }];
		await renderDialog({ label: label("l1", { title: "Winter" }) });

		await fireEvent.changeText(nameField(), "winter");
		await fireEvent.press(screen.getByText("labels.save"));

		expect(renameLabel).toHaveBeenCalledWith("home-1", "l1", "winter");
	});

	it("edits only what changed", async () => {
		mockHomes = [{ id: "home-1", labels: [] }];
		await renderDialog({ label: label("l1") });

		await fireEvent.changeText(nameField(), "Renamed");
		await fireEvent.press(screen.getByLabelText("labels.hue.indigo"));
		await fireEvent.press(screen.getByText("labels.save"));

		expect(renameLabel).toHaveBeenCalledWith("home-1", "l1", "Renamed");
		expect(recolorLabel).toHaveBeenCalledWith("home-1", "l1", "indigo");
		expect(reiconLabel).not.toHaveBeenCalled();
	});

	it("writes nothing for a save that changes nothing", async () => {
		mockHomes = [{ id: "home-1", labels: [] }];
		await renderDialog({ label: label("l1") });

		await fireEvent.press(screen.getByText("labels.save"));

		expect(renameLabel).not.toHaveBeenCalled();
		expect(recolorLabel).not.toHaveBeenCalled();
		expect(reiconLabel).not.toHaveBeenCalled();
	});

	it("keeps the dialog open and writes nothing while the custom color draft is invalid", async () => {
		const onDismiss = jest.fn();
		await renderDialog({ onDismiss });
		await fireEvent.changeText(nameField(), "Winter");
		await fireEvent.press(
			screen.getByRole("button", { name: "labels.customColor" }),
		);
		const hexField = screen.getByDisplayValue(/^#/);
		const valid = toHex([0xaa, 0xbb, 0xcc]).slice(0, 4);
		await fireEvent.changeText(hexField, valid);
		await fireEvent.changeText(hexField, `${valid}d`);
		expect(screen.getByText("labels.colorInvalid")).toBeOnTheScreen();
		await fireEvent.press(screen.getByText("labels.add"));
		expect(onDismiss).not.toHaveBeenCalled();
		expect(createLabel).not.toHaveBeenCalled();
		await fireEvent.changeText(hexField, valid);
		await fireEvent.press(screen.getByText("labels.add"));
		expect(createLabel).toHaveBeenCalledTimes(1);
	});

	it("saves after IconPicker discards an invalid hex draft", async () => {
		const onDismiss = jest.fn();
		await renderDialog({ onDismiss });
		await fireEvent.changeText(nameField(), "Winter");
		await fireEvent.press(
			screen.getByRole("button", { name: "labels.customColor" }),
		);
		const hexField = screen.getByDisplayValue(/^#/);
		await fireEvent.changeText(hexField, toHex([0xaa, 0xbb, 0xcc]).slice(0, 4));
		await fireEvent.changeText(hexField, "invalid");
		expect(screen.getByText("labels.colorInvalid")).toBeOnTheScreen();
		await fireEvent.press(screen.getByRole("button", { name: "icons.more" }));
		await fireEvent.press(screen.getByRole("button", { name: "home-outline" }));
		expect(screen.queryByText("labels.colorInvalid")).toBeNull();
		await fireEvent.press(screen.getByText("labels.add"));
		expect(createLabel).toHaveBeenCalledTimes(1);
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it("saves the picked icon without rendering a card preview", async () => {
		await renderDialog({ label: label("l1") });
		expect(screen.queryByText("labels.onCard")).toBeNull();

		await fireEvent.press(
			screen.getByRole("button", { name: "icons.pick.hammer-wrench" }),
		);
		expect(
			screen.getByRole("button", { name: "icons.pick.hammer-wrench" }).props
				.accessibilityState,
		).toEqual({ selected: true });
		await fireEvent.press(screen.getByText("labels.save"));

		expect(reiconLabel).toHaveBeenCalledTimes(1);
		expect(reiconLabel).toHaveBeenCalledWith("home-1", "l1", "hammer-wrench");
		expect(renameLabel).not.toHaveBeenCalled();
		expect(recolorLabel).not.toHaveBeenCalled();
	});

	it("deletes from the edit path only, after a confirmation of its own", async () => {
		await renderDialog({ label: label("l1") });

		await fireEvent.press(screen.getByText("labels.delete"));
		expect(screen.getByText("labels.deleteBody")).toBeOnTheScreen();

		// The confirmation's confirming button shares its label with the action
		// that opened it, so take the one the confirmation rendered last.
		const answers = screen.getAllByText("labels.delete");
		await fireEvent.press(answers[answers.length - 1]);

		expect(deleteLabel).toHaveBeenCalledWith("home-1", "l1");
	});

	it("offers no delete on the create path", async () => {
		await renderDialog();

		expect(screen.queryByText("labels.delete")).toBeNull();
	});

	it("opens the icon picker and takes the chosen glyph back", async () => {
		mockHomes = [{ id: "home-1", labels: [] }];
		await renderDialog({ label: label("l1") });

		await fireEvent.press(screen.getByRole("button", { name: "icons.more" }));
		expect(screen.getByText("labels.iconPickerTitle")).toBeOnTheScreen();
		await fireEvent.press(screen.getByRole("button", { name: "home-outline" }));
		expect(
			screen.getByRole("button", { name: "icons.more" }).props
				.accessibilityState,
		).toEqual({ selected: true });

		await fireEvent.press(screen.getByText("labels.save"));
		expect(reiconLabel).toHaveBeenCalledWith("home-1", "l1", "home-outline");
	});
});
