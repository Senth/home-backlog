import {
	MD3DarkTheme,
	MD3LightTheme,
	useTheme as usePaperTheme,
} from "react-native-paper";

/**
 * Material 3 palettes for Home Backlog.
 *
 * Green is the brand colour, deliberately unlike the sibling project's purple
 * so the two apps are distinguishable in a tab strip or app switcher. It also
 * leaves red and amber free to mean *overdue* and *waiting* on a board, which
 * matters once seven statuses need colours.
 *
 * `warning` and `success` are additions, not part of MD3. They are read through
 * `useAppTheme()` below, which carries their types; plain `useTheme()` from
 * Paper does not know about them.
 */

/**
 * The neutral ramp, re-hued off Material's default.
 *
 * MD3's stock `neutral` / `neutralVariant` families lean violet — the outline
 * everyone reads as white is `rgb(147,143,153)` — so every grey surface in the
 * app quietly fought the green brand. `primary` was overridden when the app was
 * built; the neutrals never were.
 *
 * Each tone below is its Material counterpart with **the exact relative
 * luminance preserved and only the hue changed**: chroma 0.016 at hue 150.
 * Largest luminance delta across the ramp is 6.5e-03, so every contrast ratio
 * in the app is unchanged by construction and a repaint of every surface cannot
 * regress an axe check anywhere.
 *
 * These are tones, not roles. The two palettes below assign them to the MD3
 * roles Paper already reads — `background`, `surface`, `onSurface`, `outline`,
 * `elevation.level1–3` and the rest — which is why no call site changes.
 */
const neutral = {
	/** Dark `background` / `surface`, and light `onSurface`. */
	n10: "#161D17",
	/** Light `inverseSurface`, dark `inverseOnSurface`. */
	n20: "#2B332C",
	/** Dark `onSurface`, dark `inverseSurface`. */
	n90: "#DBE6DD",
	/** Light `inverseOnSurface`. */
	n95: "#E9F4EB",
	/** Light `background` / `surface`. */
	n99: "#F4FFF6",
	/** Light `onSurfaceVariant`, dark `surfaceVariant` / `outlineVariant`. */
	nv30: "#404942",
	/** Light `outline`. */
	nv50: "#6F7871",
	/** Dark `outline`. */
	nv60: "#8A948B",
	/** Light `outlineVariant`. */
	nv80: "#BFC9C0",
	/** Light `surfaceVariant`. */
	nv90: "#DBE6DD",
} as const;

/**
 * Paper's elevation levels are opaque colours rather than shadows on web, so
 * they are part of the ramp too. Levels 4 and 5 are left as Paper ships them:
 * `elevation` in `tokens.ts` stops at `high: 3`, so nothing in this app can
 * reach them.
 */
const lightElevation = {
	...MD3LightTheme.colors.elevation,
	level1: "#EDF7EF",
	level2: "#E7F2E9",
	level3: "#E2EDE4",
};

const darkElevation = {
	...MD3DarkTheme.colors.elevation,
	level1: "#1E2620",
	level2: "#242B25",
	level3: "#283029",
};

/**
 * The board's own surfaces, named once and read everywhere they matter.
 *
 * The rule they encode is **column recessed, page in the middle, card raised**,
 * in both schemes. Before this, a dark card was `surface` — the same colour as
 * the page — on a column of `elevation.level1`, so the board read dark → grey →
 * dark with the card darker than the thing it sat on.
 *
 * `boardCard` is read by the card face, by the drag overlay and by the drop
 * landing zone, so a lifted card cannot be a different shade from the gap it
 * left. `onCardMuted` is the step count: about 2× dimmer than the title in dark
 * and 3× in light, and still 5.10:1 / 5.36:1 against the card — half a stop of
 * headroom over the 4.5:1 floor `e2e/craft.spec.ts` enforces.
 */
const lightBoard = {
	boardColumn: "#E4EEE6",
	boardCard: "#F8FFFA",
	// Darker than its dark-scheme twin, and deliberately: the light card fill is
	// within 1.01:1 of the light page, so below `compactBreakpoint` — where the
	// column carries no fill — this border is the only thing separating a card
	// from the page it sits on, and it has to clear 3:1 against that page to be
	// an edge rather than a suggestion. Still far softer than the 4.44:1
	// `outline` it replaces, which is the glare the issue called white.
	boardCardBorder: "#889289",
	onCardMuted: "#636C64",
};

const darkBoard = {
	boardColumn: "#080F0A",
	boardCard: "#28302A",
	boardCardBorder: "#636C64",
	onCardMuted: "#98A199",
};

const lightColors = {
	...MD3LightTheme.colors,
	primary: "#2E7D32",
	onPrimary: "#FFFFFF",
	primaryContainer: "#C8E6C9",
	onPrimaryContainer: "#0B2E12",
	secondary: "#4E6A52",
	onSecondary: "#FFFFFF",
	secondaryContainer: "#D1E8D5",
	onSecondaryContainer: "#0C1F10",
	tertiary: "#37656B",
	onTertiary: "#FFFFFF",
	tertiaryContainer: "#BCEBF1",
	onTertiaryContainer: "#002023",
	warning: "#B45309",
	onWarning: "#FFFFFF",
	warningContainer: "#FEF3C7",
	onWarningContainer: "#78350F",
	success: "#047857",
	onSuccess: "#FFFFFF",
	successContainer: "#D1FAE5",
	onSuccessContainer: "#064E3B",
	background: neutral.n99,
	onBackground: neutral.n10,
	surface: neutral.n99,
	onSurface: neutral.n10,
	surfaceVariant: neutral.nv90,
	onSurfaceVariant: neutral.nv30,
	outline: neutral.nv50,
	outlineVariant: neutral.nv80,
	inverseSurface: neutral.n20,
	inverseOnSurface: neutral.n95,
	// The three alpha compositions MD3 derives rather than names, re-derived on
	// the new tones at the opacities Paper uses: `onSurface` at 12 % and 38 %,
	// and the re-hued neutralVariant20 — `rgb(42,50,44)` — at 40 % for the
	// scrim behind a dialog.
	surfaceDisabled: "rgba(22, 29, 23, 0.12)",
	onSurfaceDisabled: "rgba(22, 29, 23, 0.38)",
	backdrop: "rgba(42, 50, 44, 0.4)",
	elevation: lightElevation,
	...lightBoard,
};

const darkColors = {
	...MD3DarkTheme.colors,
	primary: "#A5D6A7",
	onPrimary: "#0B2E12",
	primaryContainer: "#1B5E20",
	onPrimaryContainer: "#C8E6C9",
	secondary: "#B5CCB8",
	onSecondary: "#203524",
	secondaryContainer: "#364B39",
	onSecondaryContainer: "#D1E8D5",
	tertiary: "#A0CFD5",
	onTertiary: "#00363B",
	tertiaryContainer: "#1E4D53",
	onTertiaryContainer: "#BCEBF1",
	warning: "#FCD34D",
	onWarning: "#78350F",
	warningContainer: "#92400E",
	onWarningContainer: "#FEF3C7",
	success: "#34D399",
	onSuccess: "#064E3B",
	successContainer: "#065F46",
	onSuccessContainer: "#D1FAE5",
	background: neutral.n10,
	onBackground: neutral.n90,
	surface: neutral.n10,
	onSurface: neutral.n90,
	surfaceVariant: neutral.nv30,
	onSurfaceVariant: neutral.nv80,
	outline: neutral.nv60,
	outlineVariant: neutral.nv30,
	inverseSurface: neutral.n90,
	inverseOnSurface: neutral.n20,
	surfaceDisabled: "rgba(219, 230, 221, 0.12)",
	onSurfaceDisabled: "rgba(219, 230, 221, 0.38)",
	backdrop: "rgba(42, 50, 44, 0.4)",
	elevation: darkElevation,
	...darkBoard,
};

export const lightTheme = {
	...MD3LightTheme,
	colors: lightColors,
};

export const darkTheme = {
	...MD3DarkTheme,
	colors: darkColors,
};

export type AppTheme = typeof lightTheme;

/**
 * Use this instead of Paper's `useTheme()` everywhere. It is the same object,
 * typed so that `colors.warning` and `colors.success` resolve.
 */
export const useAppTheme = () => usePaperTheme<AppTheme>();

/**
 * The browser tab / status bar colour per scheme. Kept next to the palettes so
 * `app/+html.tsx` and `app.json` cannot drift away from `primary`.
 */
export const themeColor = {
	light: lightColors.primary,
	dark: darkColors.primary,
} as const;
