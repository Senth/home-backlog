import { renderHook } from "@testing-library/react-native";
import { Provider } from "react-native-paper";
import { useLocationColors } from "@/hooks/use-location-colors";
import {
	contrast,
	decomposeCustom,
	fillFloor,
	onFloor,
	parseHex,
	toHex,
} from "@/models/label-color";
import {
	type AppTheme,
	customColorBands,
	darkTheme,
	labelHues,
	lightTheme,
} from "@/theme";

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

	it("draws a custom color in the ink band against the page in both schemes", () => {
		const custom = toHex([0xfe, 0xca, 0xca]);
		for (const [scheme, theme] of [
			["light", lightTheme],
			["dark", darkTheme],
		] as const) {
			const colors = renderColors(custom, theme as AppTheme);
			const strength = decomposeCustom(
				colors.fill,
				customColorBands.ink[scheme],
				scheme,
			).strength;
			expect(strength).toBeGreaterThanOrEqual(0);
			expect(strength).toBeLessThanOrEqual(1);
			expect(
				contrast(parseHex(colors.fill), parseHex(theme.colors.background)),
			).toBeGreaterThanOrEqual(fillFloor);
			expect(
				contrast(parseHex(colors.fill), parseHex(colors.on)),
			).toBeGreaterThanOrEqual(onFloor);
		}
	});
});
