/**
 * The label colour clamp (#100).
 *
 * A custom label colour is stored exactly as picked and clamped only at draw
 * time: light, dark and the on-colour are derived here, so a change to
 * `boardCard` or to a floor re-derives every stored colour instead of letting
 * stored values go stale.
 *
 * Pure by design — no React, no theme import. The caller hands in the card
 * colour it is drawing against, which keeps this testable without a theme.
 *
 * The rules language cannot inspect a map's values, so the hex this receives is
 * whatever ended up in the document; nothing here may throw a render away.
 */

/** WCAG 1.4.11, non-text: the dot must read as a shape against the card. */
export const fillFloor = 3;

/** WCAG 1.4.3, text: the glyph inside the dot. */
export const onFloor = 4.5;

export type Rgb = [number, number, number];

const HEX_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Whether a string is a hex colour at all — the test the native colour field
 * commits against, and the one grammar `parseHex` accepts.
 */
export function isHexColor(hex: string): boolean {
	return HEX_PATTERN.test(hex.trim());
}

/** Steps the search takes from the picked colour toward black or white. */
const searchSteps = 64;

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

/**
 * `#rgb` or `#rrggbb`, as channels. Anything else reads as black — an
 * unparseable colour is unreachable through the app and the REST API, and a
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

/** Channels back to the `#rrggbb` form the theme spells colours in. */
export function toHex([r, g, b]: Rgb): string {
	const channel = (value: number) =>
		Math.round(Math.min(255, Math.max(0, value)))
			.toString(16)
			.padStart(2, "0");
	return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

function channel(value: number): number {
	const s = value / 255;
	return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: Rgb): number {
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: Rgb, b: Rgb): number {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function mix(from: Rgb, to: Rgb, t: number): Rgb {
	return [
		from[0] + (to[0] - from[0]) * t,
		from[1] + (to[1] - from[1]) * t,
		from[2] + (to[2] - from[2]) * t,
	];
}

/**
 * The colour to draw a label dot in, and the colour of the glyph inside it.
 *
 * The fill is the picked colour moved toward black in light and toward white in
 * dark — the direction away from the card — by the smallest step that clears
 * `fillFloor` against `boardCard`; a colour that already clears it is drawn
 * untouched. The on-colour is whichever of black and white reads better against
 * that fill: one of the two always clears `onFloor`, because black works down
 * to a luminance of 0.175 and white works up to 0.183.
 */
export function clampLabelColor(
	picked: string,
	scheme: "light" | "dark",
	boardCard: string,
): { fill: string; on: string } {
	const source = parseHex(picked);
	const card = parseHex(boardCard);
	const target = scheme === "light" ? BLACK : WHITE;

	let fill = source;
	for (let step = 1; step <= searchSteps; step += 1) {
		if (contrast(fill, card) >= fillFloor) break;
		fill = mix(source, target, step / searchSteps);
	}

	const onBlack = contrast(fill, BLACK);
	const onWhite = contrast(fill, WHITE);
	return {
		fill: toHex(fill),
		on: toHex(onBlack >= onWhite ? BLACK : WHITE),
	};
}
