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
	/** Material 3's maximum snackbar width, which Paper does not clamp either —
	 *  on a wide monitor the message and its action end up two metres apart. */
	snackbar: 600,
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
	 * The range a board column flexes between above `compactBreakpoint`, so the
	 * columns divide the width they are given instead of taking a fixed slice.
	 * `components/board/column-width.ts` does the dividing.
	 *
	 * `boardColumnMin` is the fixed width every column used to have: wide enough
	 * for a two-line title at a comfortable measure, and below it that title
	 * stops fitting — so a board with more columns than fit falls back here and
	 * scrolls, exactly as it always did. `boardColumnMax` is where a wider column
	 * stops helping: past 400 the title is one long line and the eye loses it,
	 * the same reason `contentWidth.form` clamps.
	 */
	boardColumnMin: 300,
	boardColumnMax: 400,
	/**
	 * The mark on an app-bar action that has something behind it. Small enough to
	 * read as a mark rather than a badge, large enough to survive a dark theme.
	 */
	dot: 8,
} as const;

/**
 * The look of a card while it is being dragged, and the room a drop needs.
 *
 * `lift` is a scale rather than a size: a card picked up grows just enough to
 * read as *off the board* without the title reflowing under the finger.
 *
 * `landing` is the height every column keeps free for a drop even when it is
 * empty. Two of four columns are empty in a small household, and an empty
 * column is otherwise one line of grey text — nothing to aim at, and below the
 * breakpoint no clue that a drop is allowed at all.
 *
 * `edgeZone` is how far into the screen the pane-switching strip reaches while
 * a card is held. Narrow on purpose: a thumb rests near the right edge of a
 * 390px screen, and that edge is the one a one-handed drag walks into by
 * accident.
 */
export const drag = {
	lift: 1.04,
	landing: 72,
	edgeZone: 36,
} as const;

/**
 * The FAB's footprint. The one primary action per surface earns its colour,
 * and what it must not take is room: at 200% text a full-label FAB once
 * spanned 91.8% of a 195px window — essentially the whole screen. Capped at
 * this share of the width it is laid out in, the label wraps and the words
 * stay. Measured against the *viewport* the claim names, and applied through
 * the box the FAB actually sits in.
 */
export const fab = {
	widthShare: 0.6,
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
 * The minimum tappable box, as a style prop.
 *
 * Paper's `IconButton` and `Appbar.Action` render a 40dp container, under this
 * project's 48. Neither takes a prop for the container — `size` changes the
 * glyph inside it — so every call site carries this style instead. Missing one
 * is not a judgement call any more: `e2e/craft.spec.ts` measures every
 * interactive element on every route and fails the build.
 */
export const touchTargetStyle = {
	width: touchTarget,
	height: touchTarget,
} as const;

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
 * Below this, an app bar puts its title on its own line.
 *
 * A back arrow, an overflow and the account menu are three 48dp targets, and
 * with the bar's own padding they claim ~192px of the row whatever the text
 * size. A 390px phone at 200% text is a 195px viewport, so a single-line bar
 * has three pixels left for the title and the screen loses its name. Material's
 * medium top app bar is the component for a title that needs the room, so
 * narrow screens get it and roomy ones keep the compact bar.
 */
export const appBarStackBreakpoint = 360;

/**
 * Width below which comfortable padding costs more than it is worth, and the
 * controls get the room instead. Reached by a phone at 150–200 % browser zoom,
 * which is exactly when a label most needs somewhere to wrap into.
 */
export const denseBreakpoint = 320;

export type Space = keyof typeof space;
export type Radius = keyof typeof radius;
export type Size = keyof typeof size;
