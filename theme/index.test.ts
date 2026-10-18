import { readFileSync } from "node:fs";
import {
	contrast,
	fillFloor,
	isHexColor,
	onFloor,
	parseHex,
	type Rgb,
} from "@/models/label-color";
import {
	darkTheme,
	type LabelHueName,
	labelHues,
	lightTheme,
	themeColor,
} from "@/theme";

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

const lightTextRoles = [
	["primary", lightTheme.colors.primary],
	["warning", lightTheme.colors.warning],
	["success", lightTheme.colors.success],
	["error", lightTheme.colors.error],
	["onSurface", lightTheme.colors.onSurface],
	["onSurfaceVariant", lightTheme.colors.onSurfaceVariant],
	["onCardMuted", lightTheme.colors.onCardMuted],
] as const;

const lightTextSurfaces = [
	["background", lightTheme.colors.background],
	["boardCard", lightTheme.colors.boardCard],
	["elevation.level1", lightTheme.colors.elevation.level1],
	["elevation.level2", lightTheme.colors.elevation.level2],
	["elevation.level3", lightTheme.colors.elevation.level3],
] as const;

function parseThemeColor(color: string): Rgb {
	const normalized = color.trim();
	if (isHexColor(normalized)) return parseHex(normalized);

	const rgba =
		/^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d+(?:\.\d+)?)\s*\)$/i.exec(
			normalized,
		);
	if (rgba) {
		const [red, green, blue, alpha] = rgba.slice(1).map(Number);
		if (alpha === 1 && [red, green, blue].every((channel) => channel <= 255)) {
			return [red, green, blue];
		}
	}

	throw new Error(`Unsupported color format: ${color}`);
}

function expectTextContrast(textColor: string, surfaceColor: string) {
	expect(
		contrast(parseThemeColor(textColor), parseThemeColor(surfaceColor)),
	).toBeGreaterThanOrEqual(onFloor);
}

describe("light text roles against every surface", () => {
	it.each(
		lightTextRoles.flatMap(([role, textColor]) =>
			lightTextSurfaces.map(([surface, surfaceColor]) => ({
				role,
				textColor,
				surface,
				surfaceColor,
			})),
		),
	)("$role clears 4.5:1 against $surface", ({ textColor, surfaceColor }) => {
		expectTextContrast(textColor, surfaceColor);
	});

	it("rejects low-contrast rgba text against elevation.level3", () => {
		expect(() =>
			expectTextContrast(
				"rgba(230, 235, 230, 1)",
				lightTheme.colors.elevation.level3,
			),
		).toThrow();
	});

	it("rejects unsupported color formats", () => {
		expect(() => parseThemeColor("rgba(230, 235, 230, 0.5)")).toThrow(
			"Unsupported color format: rgba(230, 235, 230, 0.5)",
		);
	});
});

describe("the PWA manifest", () => {
	it("uses the light primary as its theme color", () => {
		const manifest = JSON.parse(
			readFileSync("public/manifest.webmanifest", "utf8"),
		) as { theme_color: string };

		expect(manifest.theme_color).toBe(themeColor.light);
	});
});
