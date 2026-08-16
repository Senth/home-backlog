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
	/** No rounding — the same reason `space.none` exists: a bare `0` is a literal. */
	none: 0,
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
	/** On a card face, beside a title — a mark that somebody is on it, not a
	 *  portrait. Any larger and a row of three outweighs the title itself. */
	avatarXs: 24,
	avatarSm: 32,
	avatarMd: 48,
	brandMark: 96,
	/**
	 * One board column, side by side above `compactBreakpoint`. Wide enough for a
	 * two-line title at a comfortable measure, narrow enough that three columns
	 * and part of a fourth are on a laptop screen — a board that shows two
	 * columns is a board you scroll to use.
	 */
	boardColumn: 300,
	/**
	 * The mark on an app-bar action that has something behind it. Small enough to
	 * read as a mark rather than a badge, large enough to survive a dark theme.
	 */
	dot: 8,
} as const;

/**
 * Icon sizes. Paper's `Icon` and `@expo/vector-icons` both take a plain number
 * for `size`, which is exactly the literal this file exists to keep out of
 * components. `md` is Material's standard 24dp; `sm` sits with label text.
 */
export const icon = {
	sm: 16,
	md: 24,
} as const;

/**
 * Border widths. `hairline` is Material's outline on an outlined surface —
 * a card, a chip — and is the only one an outline should ever be.
 */
export const border = {
	hairline: 1,
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
 * `touchTarget` for a control that carries an outline — Paper's `Chip`, which
 * keeps a 1dp border in **both** its flat and outlined modes.
 *
 * A bordered box measures its border inside its own height, so a `minHeight` of
 * `touchTarget` on the chip leaves the pressable inside it at 46dp: the border
 * eats into the target instead of sitting outside it. Two hairlines back, and
 * the flat and outlined chips stay the same height as each other.
 */
export const outlinedTouchTarget = touchTarget + border.hairline * 2;

/**
 * Line height for a `SegmentedButtons` label, and the only way to make that
 * control meet `touchTarget`.
 *
 * Paper hard-codes `paddingVertical: 9` on the segment's content and exposes no
 * `contentStyle`, `hitSlop` that web honours, or any other prop that reaches the
 * pressable — `density` only makes it smaller. The ripple is therefore exactly
 * as tall as its label box, and growing the label is what grows the target:
 * 9 + 30 + 9 = 48. A plain `minHeight` on the segment inflates the *box* and
 * leaves the pressable at 38, which is the bug this exists to fix.
 */
export const segmentedLabelLineHeight = 30;

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
