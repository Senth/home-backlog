import { fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";
import { TextInput as RNTextInput } from "react-native";
import { Provider } from "react-native-paper";
import { ColorSwatches } from "@/components/label/ColorSwatches";
import {
	composeCustom,
	decomposeCustom,
	drawCustom,
	storedFromTyped,
	toHex,
} from "@/models/label-color";
import { customColorBands, darkTheme, labelHues, lightTheme } from "@/theme";

const typedBlue = toHex([0x33, 0x66, 0xcc]).toLowerCase();
const customRed = toHex([0xb0, 0x1f, 0x1b]);
const darkPink = toHex([0xff, 0xb5, 0xaa]);

jest.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

function renderPicker(
	initial = "blue",
	variant: "label" | "location" = "label",
	dark = false,
) {
	const onChange = jest.fn();
	function Controlled() {
		const [value, setValue] = useState(initial);
		return (
			<Provider theme={dark ? darkTheme : lightTheme}>
				<ColorSwatches
					value={value}
					variant={variant}
					onChange={(next) => {
						setValue(next);
						onChange(next);
					}}
				/>
			</Provider>
		);
	}
	render(<Controlled />);
	return onChange;
}

function field() {
	return screen.UNSAFE_getByType(RNTextInput);
}

describe("ColorSwatches", () => {
	it("opens from a preset at its hue and vividness, without committing or changing the selection", () => {
		const onChange = renderPicker();
		fireEvent.press(screen.getByRole("button", { name: "labels.customColor" }));
		expect(
			screen.getByRole("adjustable", { name: "labels.hueSlider" }),
		).toBeOnTheScreen();
		expect(
			screen.getByRole("adjustable", { name: "labels.vividness" }),
		).toBeOnTheScreen();
		expect(
			screen.getByRole("adjustable", { name: "labels.strength" }).props
				.accessibilityValue.now,
		).toBe(50);
		expect(
			screen.getByRole("button", { name: "labels.hue.blue" }).props
				.accessibilityState.selected,
		).toBe(true);
		expect(
			screen.getByRole("button", { name: "labels.customColor" }).props
				.accessibilityState.selected,
		).toBe(false);
		expect(onChange).not.toHaveBeenCalled();
	});

	it("one slider step commits a light-band hex and selects the live custom swatch", () => {
		const onChange = renderPicker();
		fireEvent.press(screen.getByRole("button", { name: "labels.customColor" }));
		fireEvent(
			screen.getByRole("adjustable", { name: "labels.strength" }),
			"accessibilityAction",
			{ nativeEvent: { actionName: "increment" } },
		);
		const seed = decomposeCustom(
			labelHues.blue.light.fill,
			customColorBands.fill.light,
		);
		expect(onChange).toHaveBeenCalledWith(
			composeCustom({ ...seed, strength: 0.51 }, customColorBands.fill.light),
		);
		expect(
			screen.getByRole("button", { name: "labels.customColor" }).props
				.accessibilityState.selected,
		).toBe(true);
		expect(field().props.value).toBe(onChange.mock.lastCall?.[0]);
	});

	it("accepts an in-band hex without the adjustment helper", () => {
		const onChange = renderPicker();
		fireEvent.press(screen.getByRole("button", { name: "labels.customColor" }));
		const hex = composeCustom(
			{ hue: 0, vividness: 0, strength: 0.5 },
			customColorBands.fill.light,
		);
		fireEvent.changeText(field(), hex);
		expect(onChange).toHaveBeenCalledWith(
			storedFromTyped(hex, "fill", "light", customColorBands),
		);
		expect(screen.queryByText("labels.colorAdjusted")).toBeNull();
	});

	it("snaps an out-of-band hex and explains the adjustment", () => {
		const onChange = renderPicker();
		fireEvent.press(screen.getByRole("button", { name: "labels.customColor" }));
		fireEvent.changeText(field(), typedBlue);
		expect(onChange).toHaveBeenCalledWith(
			storedFromTyped(typedBlue, "fill", "light", customColorBands),
		);
		expect(screen.getByText("labels.colorAdjusted")).toBeOnTheScreen();
		expect(field().props.value).toBe(typedBlue);
	});

	it("shows an error and does not write invalid input", () => {
		const onChange = renderPicker();
		fireEvent.press(screen.getByRole("button", { name: "labels.customColor" }));
		fireEvent.changeText(field(), "#wrong");
		expect(screen.getByText("labels.colorInvalid")).toBeOnTheScreen();
		expect(screen.queryByText("labels.colorAdjusted")).toBeNull();
		expect(onChange).not.toHaveBeenCalled();
	});

	it("uses the ink band for locations", () => {
		const onChange = renderPicker("stone", "location");
		fireEvent.press(screen.getByRole("button", { name: "labels.customColor" }));
		fireEvent.changeText(field(), typedBlue);
		expect(onChange).toHaveBeenCalledWith(
			storedFromTyped(typedBlue, "ink", "light", customColorBands),
		);
	});

	it("shows dark tone and stores its light equivalent when typed in dark mode", () => {
		const onChange = renderPicker(customRed, "location", true);
		expect(field().props.value).toBe(
			drawCustom(
				customRed,
				"ink",
				"dark",
				customColorBands,
				darkTheme.colors.background,
			).fill,
		);
		fireEvent.changeText(field(), darkPink);
		expect(onChange).toHaveBeenCalledWith(
			storedFromTyped(darkPink, "ink", "dark", customColorBands),
		);
	});

	it("a preset selection re-points an invalid draft", () => {
		renderPicker(customRed);
		fireEvent.changeText(field(), "#wrong");
		fireEvent.press(screen.getByRole("button", { name: "labels.hue.red" }));
		expect(field().props.value).not.toBe("#wrong");
		expect(screen.queryByText("labels.colorInvalid")).toBeNull();
	});
});
