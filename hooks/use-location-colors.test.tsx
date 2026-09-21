import { renderHook } from "@testing-library/react-native";
import { Provider } from "react-native-paper";
import { useLocationColors } from "@/hooks/use-location-colors";
import {
	contrast,
	fillFloor,
	onFloor,
	parseHex,
	toHex,
} from "@/models/label-color";
import { type AppTheme, darkTheme, labelHues, lightTheme } from "@/theme";

function renderColors(color: string, theme: AppTheme = lightTheme) {
	return renderHook(() => useLocationColors(color), {
		wrapper: ({ children }) => <Provider theme={theme}>{children}</Provider>,
	}).result.current;
}

describe("useLocationColors", () => {
	it("resolves a preset hue to its ink tone, with the fill as the on-color", () => {
		expect(renderColors("blue")).toEqual({
			fill: labelHues.blue.light.ink,
			on: labelHues.blue.light.fill,
		});
	});

	it("resolves the dark scheme's tones in dark", () => {
		// The app types every scheme through the light theme's shape; the dark
		// theme is the runtime value behind the same type.
		expect(renderColors("blue", darkTheme as unknown as AppTheme)).toEqual({
			fill: labelHues.blue.dark.ink,
			on: labelHues.blue.dark.fill,
		});
	});

	it("clamps a custom color against the page, not the card, and derives an on-color that reads on it", () => {
		const custom = toHex([0xfe, 0xca, 0xca]);
		const colors = renderColors(custom);

		expect(colors.fill).not.toBe(custom);
		expect(
			contrast(parseHex(colors.fill), parseHex(lightTheme.colors.background)),
		).toBeGreaterThanOrEqual(fillFloor);
		expect(
			contrast(parseHex(colors.fill), parseHex(colors.on)),
		).toBeGreaterThanOrEqual(onFloor);
	});
});
