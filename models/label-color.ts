/**
 * Custom color derivation (#337).
 *
 * A custom hex stores its light-scheme tone. Dark tones and on-colors are
 * derived at draw time inside the label or location band.
 *
 * Pure by design — no React, no theme import. The caller hands in bands and
 * the page color, which keeps this testable without a theme.
 *
 * The rules language cannot inspect a map's values, so the hex this receives is
 * whatever ended up in the document; nothing here may throw a render away.
 */

/** WCAG 1.4.11, non-text: the bare location glyph against the page. */
export const fillFloor = 3;

/** WCAG 1.4.3, text: the glyph inside the dot. */
export const onFloor = 4.5;

export type Rgb = [number, number, number];

const HEX_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Whether a string is a hex color at all — the test the native color field
 * commits against, and the one grammar `parseHex` accepts.
 */
export function isHexColor(hex: string): boolean {
	return HEX_PATTERN.test(hex.trim());
}

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

/**
 * `#rgb` or `#rrggbb`, as channels. Anything else reads as black — an
 * unparseable color is unreachable through the app and the REST API, and a
 * black dot clamps like any other, so a corrupt document renders rather than
 * crashes the board holding it.
 */
export function parseHex(hex: string): Rgb {
	if (!isHexColor(hex)) return BLACK;
	const digits = HEX_PATTERN.exec(hex.trim())?.[1] ?? "";
	if (digits.length === 3) {
		return digits.split("").map((digit) => parseInt(digit + digit, 16)) as Rgb;
	}
	return [
		parseInt(digits.slice(0, 2), 16),
		parseInt(digits.slice(2, 4), 16),
		parseInt(digits.slice(4, 6), 16),
	];
}

/** Channels back to the `#rrggbb` form the theme spells colors in. */
export function toHex([r, g, b]: Rgb): string {
	const channel = (value: number) =>
		Math.round(Math.min(255, Math.max(0, value)))
			.toString(16)
			.padStart(2, "0");
	return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

function channel(value: number): number {
	const s = value / 255;
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: Rgb): number {
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: Rgb, b: Rgb): number {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export type Band = { lo: number; hi: number; cap: number };
export type CustomParts = { hue: number; vividness: number; strength: number };
export type Scheme = "light" | "dark";
export type Role = "fill" | "ink";
export type CustomBands = Record<Role, Record<Scheme, Band>>;

const clamp = (value: number, lo: number, hi: number) =>
	Math.min(hi, Math.max(lo, value));

function linearRgb(
	L: number,
	C: number,
	hue: number,
): [number, number, number] {
	const a = C * Math.cos((hue * Math.PI) / 180);
	const b = C * Math.sin((hue * Math.PI) / 180);
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
}

function toSrgb(value: number): number {
	return value <= 0.0031308
		? 12.92 * value
		: 1.055 * value ** (1 / 2.4) - 0.055;
}

function fromOklch(L: number, C: number, hue: number): Rgb {
	let low = 0;
	let high = C;
	let rgb = linearRgb(L, C, hue);
	if (rgb.some((value) => value < 0 || value > 1)) {
		for (let i = 0; i < 24; i += 1) {
			const mid = (low + high) / 2;
			const candidate = linearRgb(L, mid, hue);
			if (candidate.every((value) => value >= 0 && value <= 1)) low = mid;
			else high = mid;
		}
		rgb = linearRgb(L, low, hue);
	}
	return rgb.map((value) =>
		Math.round(clamp(toSrgb(value), 0, 1) * 255),
	) as Rgb;
}

export function toOklch([red, green, blue]: Rgb) {
	const r = channel(red);
	const g = channel(green);
	const b = channel(blue);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	return {
		L,
		C: Math.hypot(a, bb),
		hue: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360,
	};
}

export function decomposeCustom(
	hex: string,
	band: Band,
	scheme: Scheme = "light",
	previousHue = 0,
): CustomParts {
	const { L, C, hue } = toOklch(parseHex(hex));
	return {
		hue: C < 0.0001 ? previousHue : hue,
		vividness: clamp(C / band.cap, 0, 1),
		strength: clamp(
			(scheme === "light" ? band.hi - L : L - band.lo) / (band.hi - band.lo),
			0,
			1,
		),
	};
}

export function composeCustom(
	parts: CustomParts,
	band: Band,
	scheme: Scheme = "light",
): string {
	const strength = clamp(parts.strength, 0, 1);
	const L =
		scheme === "light"
			? band.hi - strength * (band.hi - band.lo)
			: band.lo + strength * (band.hi - band.lo);
	return toHex(
		fromOklch(L, clamp(parts.vividness, 0, 1) * band.cap, parts.hue),
	);
}

export function drawCustom(
	stored: string,
	role: Role,
	scheme: Scheme,
	bands: CustomBands,
	page: string,
): { fill: string; on: string } {
	const parts = decomposeCustom(stored, bands[role].light);
	let fill = composeCustom(parts, bands[role][scheme], scheme);
	if (role === "ink" && contrast(parseHex(fill), parseHex(page)) < fillFloor) {
		let low = parts.strength;
		let high = 1;
		for (let i = 0; i < 16; i += 1) {
			const mid = (low + high) / 2;
			const candidate = composeCustom(
				{ ...parts, strength: mid },
				bands.ink[scheme],
				scheme,
			);
			if (contrast(parseHex(candidate), parseHex(page)) >= fillFloor)
				high = mid;
			else low = mid;
		}
		fill = composeCustom(
			{ ...parts, strength: high },
			bands.ink[scheme],
			scheme,
		);
	}
	const rgb = parseHex(fill);
	return {
		fill,
		on: toHex(contrast(rgb, BLACK) >= contrast(rgb, WHITE) ? BLACK : WHITE),
	};
}

export function storedFromTyped(
	hex: string,
	role: Role,
	scheme: Scheme,
	bands: CustomBands,
): string {
	return composeCustom(
		decomposeCustom(hex, bands[role][scheme], scheme),
		bands[role].light,
	);
}
