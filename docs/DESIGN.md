# Design contract

`theme/tokens.ts` holds layout values and `theme/index.ts` the palettes. When they and this
document disagree, **the file is right and this document is stale**.

## Character

**Legible, calm, unhurried.** When two pull against each other, legible wins. Households use
this irregularly and nobody lives in it all day, so a screen re-orients someone who has not
opened it for three weeks. Quiet and slightly domestic: the one saturated thing on screen is
the button that adds another job.

**This must never look like:**

- **Trello or Jira's color habit.** No card whose *status* is a hue, no swimlane tinted by
  urgency, no red card for late. Color for which project or label a card belongs to is
  wanted; color for how you should feel about it is not.
- **A productivity dashboard.** No charts, streaks, completion percentage, progress ring, or
  number that grades the household.
- **An app that nags.** No badge counts, red dot on a tab, urgency banner, or empty state
  that implies you are behind.
- No card nested inside a card. No gradient, except a color slider's track. No emoji. No
  decorative illustration.

## Token roles

Color does three separate jobs, and one color never does two of them: **brand** says whose
app this is, **status** says something is wrong or done, **identity** says which group a
thing belongs to.

- **`primary`** — brand, and the way forward: the FAB, the active tab, a link, the focus
  ring. Never a background for content, a status, or a card's identity.
- **`boardColumn` / `boardCard` / `boardCardGutter` / `boardCardBorder`** — the board's own
  surfaces. The card face, drag overlay and drop landing zone share `boardCard`.
- **`outline`** — a boundary that has to be seen. **`outlineVariant`** — a deliberately
  faint divider between related content, never the only thing separating two things a user
  must tell apart.
- **Presence**, three tiers set by tone *and* weight: **`onSurface`** to read,
  **`onSurfaceVariant`** for support, a muted tier for metadata (**`onCardMuted`** on a
  card). No fourth tier; louder than `onSurface` takes weight.
- **`warning` / `success`** — status only, **always carried with words**. A color may sit
  beside the words, never replace them (`components/board/DueChip.tsx`: *overdue is words,
  never color*). **`error`** is a failure the app is reporting, not *late*.
- **Priority ramp** (`priorityRamp`) — ordinal: glyph and hue together. It says *more*,
  never *different*; identity says *different*, never *more*.
- **Label palette** — identity: preset hues in `labelHues`, plus user-chosen custom colors.

**Themes.** Both are palettes, not inversions: a change is not verified until it has been
looked at in both. A style prop that reads a color from anywhere but `useAppTheme()` is a
defect.

### Labels

**A label is an icon plus a color. The icon carries the identity; the color accelerates it.**
Preset hues are tokens with both schemes explicit; custom colors are data, kept inside the
presets' OKLCH band per scheme. A label dot is a mark, not a block. Every label has a title:
a tooltip on desktop, on tap on mobile, and the accessible name of an icon-only label's
wrapper, because `components/ui/PaperIcon.tsx` hides every glyph from the accessibility tree.
The card title stays the loudest text on the card.

### The card face

`components/board/BoardCard.tsx` owns it. The left gutter is identity (priority glyph, label
dots); the footer is system context (location, effort, due, waiting). Position is the only
thing separating them: a priority in the footer or a label above the title destroys both
readings. The content column reads **project breadcrumbs → title → footer**. Gutter and
footer items are marks and bare text, never chips. Waiting is quieter than overdue,
deliberately. Inherited labels render like a card's own. The privacy marker is plain
`onCardMuted` text, never a control; a private project's own board says it once, not on every card.

## Surfaces and elevation

**Exactly one separation technique: fill.** Paper renders elevation as opaque color on web,
so no shadow, no glow, no scrim except the one behind a dialog. The board's rule, in both
schemes: **column recessed, page in the middle, card raised** (`boardColumn` → `background` →
`boardCard`). `boardCardBorder` is the card's edge below `compactBreakpoint`, where the
column carries no fill. `border.hairline` is the only outline weight, used where a fill cannot
do the job. Elevation stops at `elevation.high`.

## Typography

Paper owns the typescale, so **a `fontSize` in a style prop is both a banned numeric literal
and a variant that should have existed.** Use the variant.

| Variant | Means |
| --- | --- |
| `displaySmall` | the app name on the login screen. One use, and it stays one |
| `titleMedium` | a card title, a section heading, a dialog title |
| `bodyLarge` | primary reading text: a card title below `compactBreakpoint`, a node's notes, an empty state's sentence |
| `bodyMedium` | secondary text, list rows, and a card title above `compactBreakpoint` |
| `bodySmall` | metadata: dates, counts, footnotes |
| `labelLarge` | button and chip labels |
| `labelMedium` | tab labels and the smallest chips |

Weight comes from the variant, never a style prop; louder than `onSurface` takes the heavier
weight the typescale already has. An eighth variant needs a Decisions entry.

## Space and shape

The scale in `space`, and nothing between its steps. **Compact by default, air only where
reading happens**, decided by the job of the surface: scanning surfaces (columns, card
faces, Overview and list rows) take `space.sm` within a group and `space.md` between;
reading and filling-in surfaces (details, forms, dialogs) take `space.md` within and
`space.lg` between. `gutter.compact` below `compactBreakpoint`, `gutter.wide` at and above.
Reading surfaces clamp (`contentWidth.form`, `.dialog`, `.snackbar`); boards and Overview have
no width ceiling.

**Radius** — `md` on board surfaces, `sm` on chips and small wells, `lg` on the brand mark,
`full` on avatars and round marks; anything else needs a reason. No texture.

## Components

The canonical implementation owns the styling. Extend it. **Restyling a copy is a defect, even
when it looks identical.**

| Component | Canonical file |
| --- | --- |
| Board card | `components/board/BoardCard.tsx` |
| Board column | `components/board/BoardColumn.tsx` |
| Breadcrumbs | `components/board/Breadcrumbs.tsx` |
| Due chip | `components/board/DueChip.tsx` |
| Meta chip | `components/board/MetaChip.tsx` |
| Label dot | `components/board/LabelDot.tsx` |
| Dialog | `components/ui/AppDialog.tsx` |
| List row | `components/ui/Row.tsx` |
| Avatar | `components/ui/PersonAvatar.tsx` |
| Back action | `components/ui/BackAction.tsx` |
| App bar | `components/ui/AppHeader.tsx` |
| Icon | `components/ui/PaperIcon.tsx` |
| Drop zone | `components/node/AttachmentDropZone.tsx` |
| Empty screen | `components/ui/PlaceholderScreen.tsx` — scaffolding only, never a real empty state |
| Details beside the board | `models/desktop-layout.ts` owns the width bands |

Reach for a `react-native-paper` component before building one; a hand-rolled control where
Paper has one is a finding, and so is a Paper component used against its own semantics (which
is why `Row` is not `List.Item` and `MetaChip` is not `Chip`).

- **Buttons.** `contained` is the one primary action on a surface, and the FAB *is* that
  action wherever there is one; two contained buttons on one surface is a finding. `text` is
  the default, including affirmations and dismissals. Do not add a border or fill to promote a
  button. Destructive actions in `theme.colors.error` stay `text`, even when disabled. Every
  `<Button>` states its `mode`.
- **The FAB keeps `primaryContainer` and its extended label.** It may not take room: at most
  `fab.widthShare` of its width, and below `denseBreakpoint` the glyph yields so the label
  wraps. A FAB quieted to `surface` is a finding: loud is the room it takes, not its fill.
  From `compactBreakpoint` up, Overview and Locations put the add button at the top of the
  navigation rail, same fill and label.
- **Control height** — `touchTarget` is a floor and Paper does not give it to you. Use
  `touchTargetStyle`, `outlinedTouchTarget` for a `Chip`, `segmentedLabelLineHeight` for
  `SegmentedButtons`.
- **A mark is exempt from the floor, and only a mark.** A label dot is identity, not a
  control, and its tap duplicates the hover tooltip. It takes `markTouch`: a lower floor,
  never no floor. A control a household member must hit to get anywhere takes `touchTarget`.
- **Icons** — MaterialCommunityIcons only, through `PaperIcon`, at `icon.sm` or `icon.md`.
- **Empty states** — name what is missing and offer the way in: the action that creates one,
  or what *earns* a place here. Text and an action, never an illustration.

## Motion

**Expressive on manipulation and on state change; still on arrival.** What you manipulate
gets real motion: `drag.lift`, a spring on release, `drag.landing` kept free in every column,
`drag.edgeZone` for the pane strip. What changes underneath you may animate only when already
on screen, never while dragging, and never by moving the scroll position. What merely arrives
does not animate: no entrance animation, staggered reveal, or skeleton shimmer. Transform and
opacity only.

A wait you caused shows at once. A wait you arrived into shows only once it has lasted (`motion.loadingDelay`). After a tap, nothing reads as a missed tap; on arrival, nothing reads as fast.

**`prefers-reduced-motion` is mandatory.** Every animation needs a path where it does not
run; `hooks/use-reduced-motion.ts` is the one way to read it.

## Voice

Write the way the household talks, not the way the data model is shaped: plain, specific,
active, sentence case. Say what happened and what to do next. Never blame the user or imply
anyone is behind; no exclamation marks. **Banned in user-facing strings:** *node, board,
backlog, kanban, item, entity, subtask, status* — jargon in English, a loanword in Swedish.
A label that fits only one locale is a finding.

## Robustness

Three breakpoints, each earned by a real failure and none a device size: `compactBreakpoint`
(below it a board shows one column per screen), `appBarStackBreakpoint` (below it the app
bar puts its title on its own line), `denseBreakpoint` (below it comfortable padding costs
more than it is worth). Long text wraps and a title is never ellipsized; rows of controls
wrap before they shrink below `touchTarget`. At `denseBreakpoint` everything must look right; at 200% text on a phone nothing may overlap,
become unreachable or be cut off.

## Decisions

Entries land here only after a rule has been **contested** and then survived or was
overturned. This is not a log of routine choices.

### The FAB is the loudest shape on the screen, and that is correct

**Contested:** the contract said orientation outranks the FAB, while the extended
`primaryContainer` FAB is plainly the most prominent thing on every screen. Both could not
be true. **Decision:** the rule was wrong, not the FAB. Two axes that do not compete: the
loudest **shape** is the FAB, the loudest **text** is a card title. Re-measure if a label hue
ever exceeds `primaryContainer` in saturation.
