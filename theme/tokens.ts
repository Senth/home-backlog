/**
 * The only sanctioned source of layout numbers.
 *
 * This project has no Tailwind and no utility classes, so nothing else stops a
 * `padding: 15` from drifting in next to a `padding: 16`. The rule that
 * replaces it: no numeric literal ever appears in a style prop, and no color
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
 * the line — so it clamps and centers instead. Below the clamp it simply fills
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
	/**
	 * The location tree's content (#205). The old 400 (`form`) put a four-deep
	 * tree in a single narrow column adrift on a 1280px monitor; 800 carries
	 * the widest row — name, count and menu — at a measure the eye can walk,
	 * and stops there for the same reason a form does.
	 */
	tree: 800,
	/**
	 * The cap on a place's own card list (#205). At and above it the list
	 * splits into two columns, so each card is ~292px — inside the 300–400
	 * band the card face is built for, and above `cardGutterBreakpoint` so
	 * both gutters survive. Below it the list is one column at full width,
	 * which is the width the face was designed for.
	 */
	cards: 600,
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
	attachmentButtonMin: 144,
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
	/**
	 * One dot in the card's left gutter (#100) — the priority glyph's dot and a
	 * label dot are the same size, so a gutter mixing both reads as one column of
	 * marks. The glyph inside it is `icon.sm`.
	 */
	labelDot: 20,
	/**
	 * The card's left gutter (#100), which carries the priority glyph and the
	 * label dots. Narrowed below `cardGutterBreakpoint`, where the same 36px is
	 * a fifth of the card before the title has had a word.
	 */
	cardGutter: 36,
	cardGutterNarrow: 28,
	/**
	 * The card's right gutter (#100): the menu at the top, the assignees and the
	 * step count anchored to the foot. It disappears below
	 * `cardGutterBreakpoint`, where the menu floats in the card's corner
	 * instead and the people and the count join the content as a trailing
	 * line.
	 *
	 * 44 rather than the 40 the settled card face was first written with: the
	 * step count's glyph and its `2/5` measure almost exactly 40, and a mark
	 * that wide in a rail that wide lands flush against the card's rounded
	 * edge — the review that settled the face reproduced it. Four more give
	 * the foot room to sit inside the card.
	 */
	cardRail: 44,
	/**
	 * Fallback height for a `CardMenu` page that scrolls, for the frames before
	 * the root page's own `onLayout` has measured — Paper measures its menu once
	 * and never again, and an uncapped page hangs off the bottom of the window
	 * and takes the whole document scroll with it (#96 again). Roughly 6.5 menu
	 * rows, and it fits a 390x844 phone at 200% text, where the viewport is 422
	 * CSS px tall. Once the root page has measured, every later page is capped at
	 * exactly that height and this value is never used.
	 */
	menuPage: 320,
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
 * The location tree's row indent (#50). One `step` per level of depth, capped
 * at `levels` steps: past the cap a deep row at 200 % text would spend its
 * width on indentation instead of its name, so there the structure yields and
 * the name keeps its room.
 */
export const indent = {
	step: 16,
	levels: 3,
} as const;

/**
 * The FAB's footprint. The one primary action per surface earns its color,
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
 * WCAG 2.5.8's target-size floor, and the smallest a **mark** may be.
 * `touchTarget` (48) is Material's and this project's floor for a *control*;
 * 24 is the absolute floor below which nothing tappable may go.
 */
export const markTargetMinimum = 24;

/**
 * The touch box around a **mark** — a label dot in the card gutter, not a
 * control. It is the gutter it actually sits in, by the dot stack's own pitch,
 * so each mark owns one band of that column exactly: no overlap with the mark
 * above or below, and no spill sideways into the card body, where the card's
 * own `onPress` would win the tap.
 *
 * **It takes the gutter's width, so it must be told which gutter.** The gutter
 * narrows to `size.cardGutterNarrow` below `cardGutterBreakpoint`; a box fixed
 * at the wide width spills ~3.5px over the card there and hands those taps to
 * the card. The hairline comes off because the gutter's border is drawn inside
 * its own width, so the content box is that much narrower.
 *
 * **A mark does not get `touchTarget`, and cannot.** Six 20px dots on a
 * `space.xs` pitch put 24px between their centers; a 48px box around each one
 * overlaps its neighbour by 24px, and the later sibling wins the hit test — a
 * tap on one dot opens the next one's disclosure. That was measured in a real
 * browser, not reasoned about. The floor a mark can honestly hold is its own
 * pitch, which meets `markTargetMinimum`; the tap is a convenience over the
 * hover tooltip either way, and nothing in the app is reachable only by it.
 *
 * React Native Web's `Pressable` drops `hitSlop`, so the box is a real box and
 * negative margins hand the room back to the flow.
 */
export function markTouch(gutterWidth: number) {
	return {
		width: gutterWidth - border.hairline,
		height: size.labelDot + space.xs,
	} as const;
}

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

/**
 * Width below which a card's left gutter gives up room it does not have (#100):
 * the gutter narrows, the right gutter disappears and the menu floats in the
 * card's top-right corner. A 390px phone at 200 % text is a 195px viewport, so
 * the gutter's 36px is a fifth of the card before the title has had a word.
 */
export const cardGutterBreakpoint = 250;

/**
 * The priority ramp's ordinal glyphs and colors (#100), indexed with
 * `priorityOrder` from `models/node.ts` — low, normal, high, urgent.
 *
 * The dot is the ramp color with its glyph knocked out in `on`, the way a
 * label dot is filled with its hue and carries its own on-color. Blue carries
 * low so the bottom step is not another grey among greys, and urgent holds one
 * notch of red back from the overdue amber: a color here may say *more*,
 * never *how you should feel*, and overdue must stay the loudest thing the
 * footer can say. `docs/DESIGN.md` still describes the older single-hue ramp;
 * #100's documentation pass replaces that section.
 */
export const priorityRamp = [
	{ glyph: "thermometer-chevron-down", color: "#4F6BA8", on: "#FFFFFF" },
	{ glyph: "thermometer", color: "#636C64", on: "#FFFFFF" },
	{ glyph: "thermometer-chevron-up", color: "#CC6565", on: "#FFFFFF" },
	{ glyph: "fire", color: "#A32E28", on: "#FFFFFF" },
] as const;

export type Space = keyof typeof space;
export type Radius = keyof typeof radius;
export type Size = keyof typeof size;
