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
