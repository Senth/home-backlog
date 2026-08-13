/**
 * The only sanctioned source of layout numbers.
 *
 * This project has no Tailwind and no utility classes, so nothing else stops a
 * `padding: 15` from drifting in next to a `padding: 16`. The rule that
 * replaces it: no numeric literal ever appears in a style prop, and no colour
 * literal appears outside `theme/`. See `CLAUDE.md`.
 */

/** Spacing scale. 4pt grid, matching Material 3's density steps. `none` exists
 *  so that *removing* a component's own default margin is still a token — Paper
 *  ships `IconButton` with one, and a bare `0` is the literal this file bans. */
export const space = {
	none: 0,
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
 * How wide a block of content is allowed to grow before it stops. A form
 * stretched across a desktop monitor is a form nobody can read — the eye loses
 * the line — so it clamps and centres instead. Below the clamp it simply fills
 * the screen.
 */
export const contentWidth = {
	form: 400,
	/** Material 3's maximum dialog width. Paper does not clamp it on web, where
	 *  the surface otherwise stretches the full window. */
	dialog: 560,
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
 * 48dp, and nothing tappable may undercut it.
 *
 * Paper does **not** give you this for free — its `Button` is 40dp tall, and
 * the buttons inside a `Dialog.Actions` are 38dp. Pass
 * `contentStyle={{ minHeight: touchTarget }}` to any Paper button that matters,
 * and set `minWidth` / `minHeight` on custom pressables.
 */
export const touchTarget = 48;

/**
 * The keyboard focus indicator. Chrome's default is a 1 px near-black ring,
 * which all but disappears against a dark app bar — and the focus ring is the
 * one affordance a keyboard user cannot do without. Web-only: there is no Tab
 * key on a phone.
 */
export const focusRing = {
	width: 2,
	offset: 2,
} as const;

/**
 * Width below which the layout is treated as a phone. Boards show one column
 * per screen under this, several side by side above it.
 */
export const compactBreakpoint = 720;

/**
 * Width below which comfortable padding costs more than it is worth, and the
 * controls get the room instead. Reached by a phone at 150–200 % browser zoom,
 * which is exactly when a label most needs somewhere to wrap into.
 */
export const denseBreakpoint = 320;

export type Space = keyof typeof space;
export type Radius = keyof typeof radius;
export type Size = keyof typeof size;
