import { contrast, fillFloor, parseHex } from "@/models/label-color";
import { darkTheme, type LabelHueName, labelHues, lightTheme } from "@/theme";

/**
 * The ink floor (#205): a bare colored glyph — a location drawn in a hue, no
 * fill behind it — reads against the page it sits on, in both schemes. Same
 * floor a clamped label fill clears against `boardCard`, here against
 * `background`, because that is the page a location glyph is drawn on.
 */
describe("every label hue's ink", () => {
	const hues = Object.entries(labelHues) as [
		LabelHueName,
		(typeof labelHues)[LabelHueName],
	][];

	it.each(hues)("clears 3:1 against the light page for %s", (_name, hue) => {
		expect(
			contrast(parseHex(hue.light.ink), parseHex(lightTheme.colors.background)),
		).toBeGreaterThanOrEqual(fillFloor);
	});

	it.each(hues)("clears 3:1 against the dark page for %s", (_name, hue) => {
		expect(
			contrast(parseHex(hue.dark.ink), parseHex(darkTheme.colors.background)),
		).toBeGreaterThanOrEqual(fillFloor);
	});
});
