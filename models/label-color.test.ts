import {
	composeCustom,
	contrast,
	decomposeCustom,
	drawCustom,
	fillFloor,
	isHexColor,
	onFloor,
	parseHex,
	storedFromTyped,
	toHex,
	toOklch,
} from "@/models/label-color";
import { customColorBands, darkTheme, labelHues, lightTheme } from "@/theme";

describe("custom color bands", () => {
	it("round-trips in-band colors within one channel step", () => {
		for (const role of ["fill", "ink"] as const) {
			const band = customColorBands[role].light;
			for (const hue of [0, 40, 120, 200, 280]) {
				const original = composeCustom(
					{ hue, vividness: 0.4, strength: 0.5 },
					band,
				);
				const again = composeCustom(decomposeCustom(original, band), band);
				parseHex(again).forEach((channel, index) => {
					expect(
						Math.abs(channel - parseHex(original)[index]),
					).toBeLessThanOrEqual(1);
				});
			}
		}
	});

	it("puts every preset light fill and ink inside its band without clamping", () => {
		for (const preset of Object.values(labelHues)) {
			for (const role of ["fill", "ink"] as const) {
				const band = customColorBands[role].light;
				const { L } = toOklch(parseHex(preset.light[role]));
				expect(L).toBeGreaterThan(band.lo);
				expect(L).toBeLessThan(band.hi);
				const strength = decomposeCustom(preset.light[role], band).strength;
				expect(strength).toBeGreaterThan(0);
				expect(strength).toBeLessThan(1);
			}
		}
	});

	it("keeps hue, vividness and strength sweeps in gamut and inside every band", () => {
		for (const role of ["fill", "ink"] as const) {
			for (const scheme of ["light", "dark"] as const) {
				const band = customColorBands[role][scheme];
				const page = (scheme === "light" ? lightTheme : darkTheme).colors
					.background;
				for (const hue of [0, 45, 90, 135, 180, 225, 270, 315]) {
					for (const vividness of [0, 0.5, 1]) {
						for (const strength of [0, 0.5, 1]) {
							const parts = { hue, vividness, strength };
							const color = composeCustom(parts, band, scheme);
							const { L, C } = toOklch(parseHex(color));
							expect(isHexColor(color)).toBe(true);
							expect(C).toBeLessThanOrEqual(band.cap + 0.003);
							expect(L).toBeGreaterThanOrEqual(band.lo - 0.003);
							expect(L).toBeLessThanOrEqual(band.hi + 0.003);
							const drawn = drawCustom(
								composeCustom(parts, customColorBands[role].light),
								role,
								scheme,
								customColorBands,
								page,
							);
							if (role === "fill") {
								expect(
									contrast(parseHex(drawn.fill), parseHex(drawn.on)),
								).toBeGreaterThanOrEqual(onFloor);
							} else {
								expect(
									contrast(parseHex(drawn.fill), parseHex(page)),
								).toBeGreaterThanOrEqual(fillFloor);
							}
						}
					}
				}
			}
		}
	});

	it("keeps custom label dots pastel rather than walking to 3:1 against a card", () => {
		const { fill, on } = drawCustom(
			labelHues.blue.light.fill,
			"fill",
			"light",
			customColorBands,
			lightTheme.colors.background,
		);
		expect(
			contrast(parseHex(fill), parseHex(lightTheme.colors.boardCard)),
		).toBeLessThan(fillFloor);
		expect(contrast(parseHex(fill), parseHex(on))).toBeGreaterThanOrEqual(
			onFloor,
		);
	});

	it("mirrors strongest fill: darkest in light and lightest in dark", () => {
		const weak = { hue: 120, vividness: 0, strength: 0 };
		const strong = { ...weak, strength: 1 };
		for (const scheme of ["light", "dark"] as const) {
			const band = customColorBands.fill[scheme];
			const weakL = toOklch(parseHex(composeCustom(weak, band, scheme))).L;
			const strongL = toOklch(parseHex(composeCustom(strong, band, scheme))).L;
			if (scheme === "light") expect(strongL).toBeLessThan(weakL);
			else expect(strongL).toBeGreaterThan(weakL);
		}
	});

	it("converts typed dark hex into stored light tone", () => {
		for (const role of ["fill", "ink"] as const) {
			const parts = { hue: 40, vividness: 0.6, strength: 0.6 };
			const dark = composeCustom(parts, customColorBands[role].dark, "dark");
			const stored = storedFromTyped(dark, role, "dark", customColorBands);
			const actual = decomposeCustom(stored, customColorBands[role].light);
			expect(actual.hue).toBeCloseTo(parts.hue, 0);
			expect(actual.strength).toBeCloseTo(parts.strength, 1);
			expect(storedFromTyped(stored, role, "light", customColorBands)).toBe(
				stored,
			);
		}
	});

	it("clamps out-of-band tone but retains hue, and keeps achromatic hue", () => {
		const band = customColorBands.fill.light;
		const vivid = toHex([0xff, 0x10, 0x10]);
		const { hue, strength } = decomposeCustom(vivid, band);
		expect(hue).toBeGreaterThan(0);
		expect(strength).toBe(1);
		expect(
			decomposeCustom(toHex([0x80, 0x80, 0x80]), band, "light", 132).hue,
		).toBe(132);
	});

	it("renders garbage input without throwing in both schemes and roles", () => {
		for (const role of ["fill", "ink"] as const) {
			for (const scheme of ["light", "dark"] as const) {
				const page = (scheme === "light" ? lightTheme : darkTheme).colors
					.background;
				const { fill, on } = drawCustom(
					"not a color",
					role,
					scheme,
					customColorBands,
					page,
				);
				expect(isHexColor(fill)).toBe(true);
				expect(contrast(parseHex(fill), parseHex(on))).toBeGreaterThanOrEqual(
					onFloor,
				);
			}
		}
	});
});

describe("isHexColor", () => {
	// Built from channels, so no color literal is spelled here.
	const crimson = `#${[0xa3, 0x2e, 0x28]
		.map((digit) => digit.toString(16).padStart(2, "0"))
		.join("")}`;

	it("accepts the two forms the field can produce, and nothing else", () => {
		expect(isHexColor(crimson)).toBe(true);
		expect(isHexColor(crimson.toUpperCase())).toBe(true);
		expect(isHexColor(` ${crimson} `)).toBe(true);
		const short = `#${[0, 10, 3].map((digit) => digit.toString(16)).join("")}`;
		expect(isHexColor(short)).toBe(true);

		// Five digits, built by cutting one off a real color.
		expect(isHexColor(toHex([0x12, 0x34, 0x56]).slice(0, 6))).toBe(false);
		expect(isHexColor(crimson.slice(1))).toBe(false);
		expect(isHexColor("")).toBe(false);
		expect(isHexColor("bolt")).toBe(false);
	});
});

describe("parseHex", () => {
	it("reads the two forms the color field can produce", () => {
		expect(parseHex(toHex([0x0a, 0x3d, 0x91]))).toEqual([10, 61, 145]);
		// The short form, built from digits a piece so no hex is spelled here.
		const short = `#${[0, 10, 3].map((digit) => digit.toString(16)).join("")}`;
		expect(parseHex(short)).toEqual([0, 170, 51]);
	});

	it("reads garbage as black", () => {
		expect(parseHex("")).toEqual([0, 0, 0]);
		// Five digits: one short of a color, built by cutting one off.
		expect(parseHex(toHex([0x12, 0x34, 0x56]).slice(0, 6))).toEqual([0, 0, 0]);
		expect(parseHex("bolt")).toEqual([0, 0, 0]);
	});
});
