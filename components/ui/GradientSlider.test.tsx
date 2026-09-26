import { fireEvent, render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";
import { Provider } from "react-native-paper";
import { GradientSlider } from "@/components/ui/GradientSlider";
import { lightTheme } from "@/theme";

Object.defineProperty(Platform, "OS", { value: "web", configurable: true });

function slider(value: number, onChange = jest.fn()) {
	render(
		<Provider theme={lightTheme}>
			<GradientSlider
				value={value}
				onChange={onChange}
				stops={["red", "blue"]}
				thumbColor="red"
				label="Hue"
				valueText="Halfway"
			/>
		</Provider>,
	);
	return onChange;
}

describe("GradientSlider", () => {
	it("reports its accessible value", () => {
		slider(0.5);
		expect(
			screen.getByRole("adjustable", { name: "Hue" }).props.accessibilityValue,
		).toEqual({
			min: 0,
			max: 100,
			now: 50,
			text: "Halfway",
		});
	});

	it.each([
		["increment", 0.5, 0.51],
		["decrement", 0.5, 0.49],
		["increment", 1, 1],
		["decrement", 0, 0],
	])("%s from %s gives %s", (actionName, value, expected) => {
		const onChange = slider(value);
		fireEvent(screen.getByRole("adjustable"), "accessibilityAction", {
			nativeEvent: { actionName },
		});
		expect(onChange).toHaveBeenCalledWith(expected);
	});

	it.each([
		["ArrowRight", 0.5, 0.51],
		["ArrowUp", 0.5, 0.51],
		["ArrowLeft", 0.5, 0.49],
		["ArrowDown", 0.5, 0.49],
		["PageUp", 0.5, 0.6],
		["PageDown", 0.5, 0.4],
		["Home", 0.5, 0],
		["End", 0.5, 1],
		["ArrowLeft", 0, 0],
		["PageUp", 1, 1],
	])("%s from %s gives %s", (key, value, expected) => {
		const onChange = slider(value);
		const preventDefault = jest.fn();
		fireEvent(screen.getByRole("adjustable"), "keyDown", {
			key,
			preventDefault,
		});
		expect(preventDefault).toHaveBeenCalled();
		expect(onChange).toHaveBeenCalledWith(expected);
	});
});
