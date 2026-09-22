import { fireEvent, render, screen } from "@testing-library/react-native";
import { TextInput as RNTextInput } from "react-native";
import { Provider } from "react-native-paper";
import { LocationDialog } from "@/components/location/LocationDialog";
import { PaperIcon } from "@/components/ui/PaperIcon";
import { createLocation, editLocation } from "@/data/locations";
import type { Location } from "@/models/locations";
import { labelHues, lightTheme } from "@/theme";

jest.mock("react-i18next", () => ({
	// Keys asserted, not sentences — `LabelDialog.test.tsx` for the reasoning.
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values === undefined ? key : `${key}:${JSON.stringify(values)}`,
		i18n: { language: "en-US" },
	}),
}));

jest.mock("@/contexts/AuthContext", () => ({
	useAuth: () => ({ user: { uid: "uid-me" } }),
}));

jest.mock("@/data/locations", () => ({
	createLocation: jest.fn(() => ({
		id: "new-location",
		acknowledged: Promise.resolve(),
	})),
	editLocation: jest.fn(() => Promise.resolve()),
}));

// The real icon set loads its font map asynchronously — the same double the
// label dialog's test uses. The color PaperIcon hands the glyph is painted as
// the mock's background, so the icon preview's color stays assertable past
// the renderer's prop mapping (and the glyph stays aria-hidden, like the real
// one, which is why the preview test opts into hidden elements).
jest.mock("@expo/vector-icons/MaterialCommunityIcons", () => {
	const { View } = jest.requireActual("react-native");
	const Mock = ({ name, color }: { name: string; color?: string }) => (
		<View
			testID={name}
			style={color === undefined ? undefined : { backgroundColor: color }}
		/>
	);
	const withGlyphMap = Mock as unknown as { glyphMap: Record<string, number> };
	withGlyphMap.glyphMap = { home: 0x0f2d };
	return { __esModule: true, default: Mock };
});

function place(overrides: Partial<Location> = {}): Location {
	return {
		id: "garden",
		title: "Garden",
		parentId: null,
		ancestorIds: [],
		rank: "a0",
		icon: "crosshairs-gps",
		color: "stone",
		createdAt: null,
		createdBy: "uid-me",
		updatedAt: null,
		...overrides,
	};
}

function renderDialog(
	props: Partial<Parameters<typeof LocationDialog>[0]> = {},
) {
	return render(
		<Provider theme={lightTheme} settings={{ icon: PaperIcon }}>
			<LocationDialog
				homeId="home-1"
				location={null}
				parent={null}
				siblings={[]}
				onDismiss={() => {}}
				testID="location-dialog"
				{...props}
			/>
		</Provider>,
	);
}

/** The name field, which Paper renders as one inner `TextInput`. */
function nameField() {
	return screen.UNSAFE_getByType(RNTextInput);
}

describe("LocationDialog", () => {
	it("trims the name on the create path", () => {
		renderDialog();

		fireEvent.changeText(nameField(), "  Garden  ");
		fireEvent.press(screen.getByText("board.add"));

		expect(createLocation).toHaveBeenCalledWith(
			"home-1",
			"uid-me",
			expect.objectContaining({
				title: "Garden",
				icon: "crosshairs-gps",
				color: "stone",
			}),
		);
	});

	it("trims the name on the edit path", () => {
		renderDialog({ location: place() });

		fireEvent.changeText(nameField(), "  Trädgården  ");
		fireEvent.press(screen.getByText("labels.save"));

		expect(editLocation).toHaveBeenCalledWith("home-1", "garden", {
			title: "Trädgården",
		});
	});

	it("writes nothing when the trimmed name is the one already stored", () => {
		renderDialog({ location: place() });

		fireEvent.changeText(nameField(), "  Garden  ");
		fireEvent.press(screen.getByText("labels.save"));

		expect(editLocation).not.toHaveBeenCalled();
	});

	it("paints the palette swatches in the ink tone the tree will draw", () => {
		renderDialog();

		const swatch = screen.getByLabelText("labels.hue.stone");
		const dot = swatch.props.children[0];
		expect(dot.props.style.backgroundColor).toBe(labelHues.stone.light.ink);
	});

	it("tints the icon preview with the color the tree will draw", () => {
		renderDialog();

		const glyph = screen.getByTestId("crosshairs-gps", {
			includeHiddenElements: true,
		});
		expect(glyph.props.style.backgroundColor).toBe(labelHues.stone.light.ink);
	});
});
