/**
 * The only sanctioned source of layout numbers.
 *
 * This project has no Tailwind and no utility classes, so nothing else stops a
 * `padding: 15` from drifting in next to a `padding: 16`. The rule that
 * replaces it: no numeric literal ever appears in a style prop, and no colour
 * literal appears outside `theme/`. See `CLAUDE.md`.
 */

/** Spacing scale. 4pt grid, matching Material 3's density steps. */
export const space = {
	xs: 4,
	sm: 8,
	md: 16,
	lg: 24,
	xl: 32,
	xxl: 48,
} as const;

/** Corner radii. `full` is a large number rather than a percentage because
 *  React Native has no `border-radius: 50%`. */
export const radius = {
	sm: 8,
	md: 12,
	lg: 16,
	xl: 28,
	full: 999,
} as const;

/** Paper's `elevation` prop takes these levels; kept here so non-Paper
 *  surfaces can match them. */
export const elevation = {
	none: 0,
	low: 1,
	medium: 2,
	high: 3,
} as const;

/**
 * Fixed component sizes that are not spacing — anything given a width and a
 * height rather than a margin. `avatarSm` is the app-bar avatar, `avatarMd` the
 * larger one in the account menu header, `brandMark` the app icon on the splash
 * and login screens.
 */
export const size = {
	avatarSm: 32,
	avatarMd: 48,
	brandMark: 96,
} as const;

/**
 * Minimum touch target. Material and the WCAG target-size rule both land at
 * 48dp; Paper's own controls already honour it, custom pressables must not
 * undercut it.
 */
export const touchTarget = 48;

/**
 * Width below which the layout is treated as a phone. Boards show one column
 * per screen under this, several side by side above it.
 */
export const compactBreakpoint = 720;

export type Space = keyof typeof space;
export type Radius = keyof typeof radius;
export type Size = keyof typeof size;
