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

/**
 * The location palette's check mark (#328): the selected swatch rides the
 * hue's `ink` dot, and the mark inside it is drawn in the hue's own `fill`
 * tone — the one tone that reads against an ink. It is a mark, so it needs
 * the non-text floor, in both schemes.
 */
describe("every label hue's ink against its own fill", () => {
	const hues = Object.entries(labelHues) as [
		LabelHueName,
		(typeof labelHues)[LabelHueName],
	][];

	it.each(hues)("clears 3:1 in light for %s", (_name, hue) => {
		expect(
			contrast(parseHex(hue.light.ink), parseHex(hue.light.fill)),
		).toBeGreaterThanOrEqual(fillFloor);
	});

	it.each(hues)("clears 3:1 in dark for %s", (_name, hue) => {
		expect(
			contrast(parseHex(hue.dark.ink), parseHex(hue.dark.fill)),
		).toBeGreaterThanOrEqual(fillFloor);
	});
});

/**
 * The board's fill rule (#358): column recessed, page in the middle, card
 * raised, separated by fill alone above `compactBreakpoint` — where neither
 * the column nor the card draws its hairline. Light shipped the card at
 * 1.17:1 against the column, which dissolved without the edge; the ramp now
 * matches the separation dark has always carried (1.43:1), with 1.4 as the
 * floor both schemes must keep.
 */
describe("the board ramp's card-over-column separation", () => {
	it.each([
		["light", lightTheme],
		["dark", darkTheme],
	])("clears 1.4:1 on fill alone in $name", (_name, theme) => {
		expect(
			contrast(
				parseHex(theme.colors.boardCard),
				parseHex(theme.colors.boardColumn),
			),
		).toBeGreaterThanOrEqual(1.4);
	});
});
