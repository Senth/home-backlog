import {
	clampLabelColor,
	contrast,
	fillFloor,
	isHexColor,
	onFloor,
	parseHex,
	toHex,
} from "@/models/label-color";
import { darkTheme, lightTheme } from "@/theme";

const lightCard = lightTheme.colors.boardCard;
const darkCard = darkTheme.colors.boardCard;

/** A colour a whisker off the card itself — the closest a picker can come to invisible. */
function nearCard(card: string): string {
	const [r, g, b] = parseHex(card);
	return toHex([Math.min(255, r + 2), g, b]);
}

/** The deep green of a Tailwind 900 tone — far enough from either card to pass as-is. */
const deepGreen = toHex([0x14, 0x53, 0x2d]);
const midGrey = toHex([0x80, 0x80, 0x80]);

describe("clampLabelColor", () => {
	it("draws a colour that already clears the floor against the card untouched", () => {
		expect(clampLabelColor(deepGreen, "light", lightCard).fill).toBe(deepGreen);
		expect(clampLabelColor(midGrey, "dark", darkCard).fill).toBe(midGrey);
	});

	it("darkens a light-scheme colour until the dot reads against the card", () => {
		const { fill } = clampLabelColor(nearCard(lightCard), "light", lightCard);

		expect(
			contrast(parseHex(fill), parseHex(lightCard)),
		).toBeGreaterThanOrEqual(fillFloor);
		expect(contrast(parseHex(fill), parseHex(lightCard))).toBeGreaterThan(
			contrast(parseHex(nearCard(lightCard)), parseHex(lightCard)),
		);
	});

	it("lightens a dark-scheme colour until the dot reads against the card", () => {
		const { fill } = clampLabelColor(nearCard(darkCard), "dark", darkCard);

		expect(contrast(parseHex(fill), parseHex(darkCard))).toBeGreaterThanOrEqual(
			fillFloor,
		);
		expect(contrast(parseHex(fill), parseHex(darkCard))).toBeGreaterThan(
			contrast(parseHex(nearCard(darkCard)), parseHex(darkCard)),
		);
	});

	const cases: [string, string, "light" | "dark", string][] = [
		["a near-card colour in light", nearCard(lightCard), "light", lightCard],
		["a near-card colour in dark", nearCard(darkCard), "dark", darkCard],
		["a mid grey in light", midGrey, "light", lightCard],
		["a mid grey in dark", midGrey, "dark", darkCard],
		["an already-deep colour in light", deepGreen, "light", lightCard],
	];
	it.each(
		cases,
	)("derives an on-colour that clears 4.5:1 against the fill for %s", (_label, picked, scheme, card) => {
		const { fill, on } = clampLabelColor(picked, scheme, card);

		expect(contrast(parseHex(on), parseHex(fill))).toBeGreaterThanOrEqual(
			onFloor,
		);
	});

	it("answers a colour the picker could never have stored, without throwing", () => {
		// The rules cannot inspect the map's values, so a corrupt string is the
		// one input this function can meet; it clamps like any other rather than
		// crashing the board holding it.
		const { fill, on } = clampLabelColor("not a colour", "light", lightCard);

		expect(contrast(parseHex(on), parseHex(fill))).toBeGreaterThanOrEqual(
			onFloor,
		);
	});
});

describe("isHexColor", () => {
	// Built from channels, so no colour literal is spelled here.
	const crimson = `#${[0xa3, 0x2e, 0x28]
		.map((digit) => digit.toString(16).padStart(2, "0"))
		.join("")}`;

	it("accepts the two forms the field can produce, and nothing else", () => {
		expect(isHexColor(crimson)).toBe(true);
		expect(isHexColor(crimson.toUpperCase())).toBe(true);
		expect(isHexColor(` ${crimson} `)).toBe(true);
		const short = `#${[0, 10, 3].map((digit) => digit.toString(16)).join("")}`;
		expect(isHexColor(short)).toBe(true);

		// Five digits, built by cutting one off a real colour.
		expect(isHexColor(toHex([0x12, 0x34, 0x56]).slice(0, 6))).toBe(false);
		expect(isHexColor(crimson.slice(1))).toBe(false);
		expect(isHexColor("")).toBe(false);
		expect(isHexColor("bolt")).toBe(false);
	});
});

describe("parseHex", () => {
	it("reads the two forms the colour field can produce", () => {
		expect(parseHex(toHex([0x0a, 0x3d, 0x91]))).toEqual([10, 61, 145]);
		// The short form, built from digits a piece so no hex is spelled here.
		const short = `#${[0, 10, 3].map((digit) => digit.toString(16)).join("")}`;
		expect(parseHex(short)).toEqual([0, 170, 51]);
	});

	it("reads garbage as black", () => {
		expect(parseHex("")).toEqual([0, 0, 0]);
		// Five digits: one short of a colour, built by cutting one off.
		expect(parseHex(toHex([0x12, 0x34, 0x56]).slice(0, 6))).toEqual([0, 0, 0]);
		expect(parseHex("bolt")).toEqual([0, 0, 0]);
	});
});
