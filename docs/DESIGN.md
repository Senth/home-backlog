# Design contract

## Overview

Home Backlog is a home improvement project manager built on nested kanban boards, with a
second, independent hierarchy of places that work is anchored to. Two or more people in one
household use it **irregularly** — one opens it mid-project, another after the chimney sweep
has been. Nobody lives in it all day.

The primary job on `/overview` is: what is going on, without opening a board.

That irregularity sets everything below. Someone who has not opened this for three weeks has
to be re-oriented by the screen itself, not by remembering where they left off. The cast a
change is judged against is `docs/PERSONAS.md`.

## Character

**Legible, calm, unhurried.** When two pull against each other, legible wins.

Quiet and slightly domestic: the app bar names a house, the trail names rooms, and the one
saturated thing on screen is the button that adds another job to the list. A well-kept
notebook someone else in the household can pick up — not a system with opinions about how
productive anyone is being.

**Density is not the enemy of calm.** A lot of information in a small space, scannable by
icon and color, is the goal. The frame stays quiet so that the color which does appear
means something.

**This must never look like:**

- **Trello or Jira's color habit.** Not the boards — the boards are the point. No card whose
  *status* is a hue, no swimlane tinted by urgency, no red card for late. Color that says
  which project or which label a card belongs to is wanted. Color that says how you should
  feel about a card is not.
- **A productivity dashboard.** No charts, no streaks, no completion percentage, no progress
  ring, no number that grades the household.
- **An app that nags.** No badge counts, no red dot on a tab, no urgency banner, no empty
  state that implies you are behind. `size.dot` is a mark that something is there, and it
  stays a mark.
- No card nested inside a card. No gradient. No emoji. No decorative illustration.

## Where the values live

`theme/tokens.ts` for layout, `theme/index.ts` for the palettes.

Those files are ground truth. When they and this document disagree, **the file is right and
this document is stale** — say so rather than editing code to match prose. Their docblocks
carry the reasoning behind the values and are not repeated here.

**Nobody edits this file mid-run.** A review finding cites a rule here or says in words that
it is a taste call; proposed rule changes go to the human as one diff. Widening a rule so
that the change in front of you passes is the failure this sentence exists to prevent.

## Token roles

Color does three separate jobs, and mixing them is the failure this section prevents:
**brand** says whose app this is, **status** says something is wrong or done, **identity**
says which group a thing belongs to. One color never does two of them.

- **`primary`** — brand, and the way forward. The FAB, the active tab, a link, the focus
  ring, the brand mark. Never a background for a block of content, never a status, never a
  card's identity.
- **`background` / `surface`** — the page.
- **`boardColumn` / `boardCard` / `boardCardBorder`** — the board's own surfaces. Read by the
  card face, the drag overlay and the drop landing zone alike, so a lifted card is never a
  different shade from the gap it left.
- **`outline`** — a boundary that has to be seen. **`outlineVariant`** — a divider between
  related content, deliberately faint, and never the only thing separating two things a user
  must tell apart. They are not interchangeable.
- **Presence**, three tiers, set by tone *and* weight rather than by size: **`onSurface`** for
  what you came to read, **`onSurfaceVariant`** for supporting text, and a muted tier for
  metadata that must not compete — **`onCardMuted`** is that tier on a card face. There is no
  fourth tier; if something needs to be louder than `onSurface`, it takes weight.
- **`warning` / `success`** — status only, and **always carried with words**. A color may sit
  beside the words; it may never replace them. `components/board/DueChip.tsx` is where this
  is implemented: *overdue is words, never color*.
- **`error`** — a failure the app is reporting. It does not mean *late*.
- **Priority ramp** — ordinal, not categorical. Four steps, glyph and hue together, cool at
  the bottom and deep red at the top: `thermometer-chevron-down` `#4F6BA8`, `thermometer`
  `#636C64`, `thermometer-chevron-up` `#CC6565`, `fire` `#A32E28` (`theme/tokens.ts`'s
  `priorityRamp`). It says *more*, never *different*; identity says *different*, never
  *more*. They sit in different bands of the card face and are never read against each other.
- **Label palette** — identity. Twelve named hues, plus user-chosen custom colors. See below.

**Themes.** Both, and they are palettes rather than inversions — a change that looks right in
one is not verified until it has been looked at in the other. Every role exists in both. A
style prop that reads a color from anywhere but `useAppTheme()` is a defect.

### Labels: the identity palette

**A label is an icon plus a color. The icon carries the identity; the color accelerates it.**
That is what makes a large palette safe: two labels whose hues collide under deuteranopia
still have different glyphs, so color is never the only signal.

- **Twelve hues in the token file**, both schemes given explicitly, each shipping its own
  on-color. A hue that exists only in light is not a token. The twelve as shipped: *red,
  orange, amber, lime, green, teal, cyan, blue, indigo, purple, pink, stone* — Tailwind's
  200 tone as the light fill and its 900 as the dark fill (stone takes 800 there, where 900
  is indistinguishable from the card), each with the opposite tone as its on-color. The
  values are `theme/index.ts`'s `labelHues`; this document does not repeat them.
- **Custom colors are data, not tokens.** A user may pick any color. The app owns its
  legibility: derive the on-color, and clamp the hue so it clears its contrast floor against
  `boardCard` in both schemes. Never render a pasted hex unmodified and hope.
- **A label dot is a mark, not a block.** What holds the way forward safe is
  `models/label-color.ts`'s clamp: every drawn fill clears `fillFloor` (3:1 against
  `boardCard`) by the smallest step and never further, and the glyph inside clears
  `onFloor` (4.5:1). HSL saturation was the wrong ruler for this — a Tailwind-200 pastel
  reads 100% of it and is still quiet — so the rule is the clamp, not a saturation number.
- **Identity means *different*, never *worse* or *sooner*.** A ramp spent on urgency is a ramp
  that can no longer tell two projects apart, which is the whole reason for having it.
- **Every label has a title**, shown as a tooltip on desktop and on tap on mobile. Any
  information a tooltip carries must be reachable by tap — mobile has no hover, and a
  desktop-only affordance is a feature half the household cannot use.
- **An icon-only label carries its title as the accessible name on its wrapper.**
  `components/ui/PaperIcon.tsx` hides every glyph from the accessibility tree on purpose, so a
  label whose name lives on the glyph has no name at all.
- **The card title stays the loudest text on the card.** If a reader sees the color before
  the title, the color is too strong.
- A setting renders labels as text instead of icons, for anyone who wants the words.

### The card face, settled (#100)

**Position is decided: the left gutter is identity, the footer is system context, and
nothing else has to separate them.** The priority glyph and the label dots sit in the
gutter; location, effort, due and waiting sit in the footer under the title. Neither family
is a chip on a card — the gutter is filled dots, the footer is bare text with a leading
glyph.

The content column reads in one fixed order, top to bottom: **project breadcrumbs → title →
footer**. Nothing above the crumbs, nothing between the crumbs and the title — the trail
reads as one unit with what it names.

- **Left gutter — 36px, filled, hairline right border, always drawn**, even on a card with
  neither a priority nor a label. It carries the priority glyph in a 20px dot, a hairline,
  then up to six label dots, each 20px in its hue.
- **Right gutter — 44px, no fill** (`size.cardRail`, widened from the 40 the
  settled face was first written with so the step count clears the rounded
  edge). The menu at the top; assignee avatars and the step count
  (`format-list-checks`, *2/5*) anchored to the foot.
- **Below `cardGutterBreakpoint`** (a 250px card): the left gutter narrows to 28px, the
  right gutter disappears, the menu floats in the card's top-right corner, and people plus
  the step count move to a trailing line that wraps.
- **Spacing 8 / 4 / 8** — `space.sm` edge→crumbs, `space.xs` crumbs→title, `space.sm`
  title→footer.
- **The footer is two lines** — `location · time`, then `due · waiting` — bare text with a
  leading glyph, no chip borders, `column-gap: space.sm` with **`rowGap: 1`** so a wrapped
  pair spaces exactly like two separate lines. The location is always the leaf: *Workshop*,
  never *Basement · workshop*. Effort leads `clock-outline`; due keeps `calendar` in
  `warning`; waiting is `timer-sand` in `onCardMuted` — **quieter than overdue,
  deliberately**: being blocked is a state the card is in, not an alarm about it.
- **Inherited labels render exactly like a card's own** — no dimming, no outline variant.
  A label passed down by the project is as much the card's identity as one put on it
  directly.

### The card face and its pictures (#298)

A card can choose what its attachments do to the face, and the choice is a preference
stored on the card. Rendering degrades when the data moves under it — a deleted hero
falls back to the first remaining image, a card left with no image draws the count
whatever its stored mode says — and nothing is ever rewritten on read.

- **Count** (the default) — a `paperclip N` fact in the footer's first pair, beside
  where and how long. It is also the fallback for a card holding only documents, so
  the counter and the thumbnails are the document case and the image case of one
  design rather than rival designs.
- **Thumbnails** — one row under the footer, inside the content column: three tiles,
  each a third of the column, a `+N` badge on the third when there are more. The
  gutters are untouched.
- **Hero** — the chosen image full-bleed across the whole card, above both gutters,
  its top corners rounded to the card's radius. **This breaks the left gutter's
  continuous rail deliberately.** It is per card and chosen, never automatic, so a
  board only ever looks like this where somebody decided it should. With exactly one
  image there is nothing to choose and it is the hero.

The choice lives in a chip in the gallery's header on the details screen, beside what
it governs, and appears only while the card holds at least one image.

## Surfaces and elevation

**Exactly one separation technique: fill.** Paper renders elevation as opaque color on web,
so a shadow is not available and is not wanted. No shadow, no glow, no scrim except the one
behind a dialog.

The board's rule, in both schemes, is **column recessed, page in the middle, card raised**:
`boardColumn` → `background` → `boardCard`. `boardCardBorder` is the card's edge below
`compactBreakpoint`, where the column carries no fill and that border is the only thing
separating a card from the page.

`border.hairline` is used where a fill cannot do the job, and is the only weight an outline
takes. **Nesting stops at one level** — no card inside a card. Elevation stops at
`elevation.high`; nothing in the app may reach Paper's levels 4 and 5.

## Typography

Paper owns the typescale and `theme/` overrides no font, so **a `fontSize` in a style prop is
both a banned numeric literal and a variant that should have existed.** Use the variant.

| Variant | Means |
| --- | --- |
| `displaySmall` | the app name on the login screen. One use, and it stays one |
| `titleMedium` | a card title, a section heading, a dialog title |
| `bodyLarge` | primary reading text: a card title below `compactBreakpoint`, a node's notes, an empty state's sentence |
| `bodyMedium` | secondary text, list rows, and a card title above `compactBreakpoint` |
| `bodySmall` | metadata: dates, counts, footnotes |
| `labelLarge` | button and chip labels |
| `labelMedium` | tab labels and the smallest chips |

Two weights, 400 and 500. An eighth variant needs a Decisions entry.

Long text wraps; a title is never ellipsized.

## Space and density

The 4pt scale in `space`, and nothing between its steps. `space.none` exists so that
*removing* a Paper component's own default margin is still a token.

**Compact by default, air only where reading happens**, and which one applies is decided by
the job of the surface rather than by taste:

- **Scanning surfaces** — board columns, card faces, Overview rows, list rows — take
  `space.sm` within a group and `space.md` between. One step of separation, not two.
- **Reading and filling-in surfaces** — a node's details, a form, a dialog — take `space.md`
  within and `space.lg` between.

A reviewer cites which job the surface is doing. **Content clamps rather than stretching:**
`contentWidth.form` for a form, `.dialog` and `.snackbar` for the two Paper components that
do not clamp themselves on web.

## Shape

- **Radius** — `md` on board surfaces, `sm` on chips and small wells, `lg` on the brand mark,
  `full` on avatars and round marks. `none` exists so that removing a corner is still a token.
  A radius outside this mapping needs a reason.
- **Borders** — `border.hairline`, and only where a fill cannot separate.
  - The file drop zone (#321) is the app's only dashed edge, still `border.hairline`. A drop
    target has to read as "put it here" before the pointer arrives, and a fill alone can't
    say that.
- **Texture** — none. Stated so that nobody later calls a gradient a judgement call.

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
| Dialog | `components/ui/AppDialog.tsx` |
| List row | `components/ui/Row.tsx` |
| Avatar | `components/ui/PersonAvatar.tsx` |
| Back action | `components/ui/BackAction.tsx` |
| Icon | `components/ui/PaperIcon.tsx` |
| Drop zone | `components/node/AttachmentDropZone.tsx` |
| Empty screen | `components/ui/PlaceholderScreen.tsx` — scaffolding only, never a real empty state |

Reach for a `react-native-paper` component before building one. A hand-rolled control where
Paper has one is a finding, and so is a Paper component used against its own semantics —
which is why `Row` is not `List.Item` and `MetaChip` is not `Chip`: Paper's `TouchableRipple`
marks a handler-less pressable `aria-disabled`, so a screen reader announces every priority
and every row's controls as dimmed.

- **Buttons, four levels.** `contained` is the one primary action on a surface — and the FAB
  *is* that action wherever there is one, so a screen with a FAB has no contained button.
  `contained-tonal` is the affirmative in a dialog. `outlined` is every other real action.
  `text` is dismissal and navigation only. Two contained buttons on one surface is a finding.
- **The FAB keeps `primaryContainer` and its extended label**, and what it must not take is
  room: at most `fab.widthShare` of the width it is laid out in, and below `denseBreakpoint`
  the plus glyph yields so the label wraps and the words stay — the label names the
  destination, and that is the half that matters. A FAB quieted to `surface` is also a
  finding: it answers with color a question color never asked, and costs the app its one
  way forward. See Decisions.
- **Control height** — `touchTarget` is a floor and Paper does not give it to you. `Button` is
  40dp, `Dialog.Actions` 38dp, `IconButton` and `Appbar.Action` render 40dp containers, and
  `SegmentedButtons` needs `segmentedLabelLineHeight` because that is the only way to reach
  it. Use `touchTargetStyle`, `outlinedTouchTarget` for a `Chip`, and
  `contentStyle={{ minHeight: touchTarget }}` on a Paper button that matters.
- **A mark is exempt from the floor, and only a mark.** A label dot in the card gutter is
  identity, not a control: it says *which group*, and its tap is a convenience over the
  hover tooltip — nothing in the app is reachable only by tapping one. Six dots on a
  `space.xs` pitch put 24px between their centers, so a `touchTarget` box around each
  overlaps its neighbour by half and the later sibling wins the hit test: a tap on one dot
  opens the next one's name. That was measured in a browser, not argued. A mark therefore
  takes `markTouch` — one band of **the gutter it actually sits in**, which meets WCAG
  2.5.8's `markTargetMinimum` and overlaps neither its neighbours nor the card body. It is
  a lower floor, never no floor: the craft sweep still measures every mark against 24.
  **This exemption is for marks that duplicate a reachable affordance.**
  A control a household member must hit to get anywhere still takes `touchTarget`, and
  shrinking a real control to a mark to dodge the floor is the mistake this names.
- **Forms** — Paper's floating label, so there is no separate label row to misalign or
  translate twice. `HelperText` directly beneath the field, `type="error"` or `type="info"`,
  its slot reserved so the layout does not jump. Nothing is marked required: validation says
  what is missing in a sentence.
- **Focus ring** — one app-wide CSS rule in `theme/focus-visible.ts`, injected by
  `app/+html.tsx`. It cannot be a style prop: React Native Web compiles `outline*` to atomic
  classes with no selector, so the ring would be painted always.
- **Icons** — MaterialCommunityIcons only, through `PaperIcon`, at `icon.sm` or `icon.md`. A
  second icon set is as obvious as a second typeface and gets noticed less.
- **Empty states** — name what is missing and offer the way in: the action that creates one
  where there is an action, and otherwise what *earns* a place here. *"Set the time needed on
  a task and the quick ones land here."* tells a reader what to do; *"Nothing matches this
  card."* only tells them what they can already see, and a card whose empty state stops there
  is not finished. Text and an action, never an illustration.
- **Tables and charts** — there are none, and charts are on the never list above.

## Hierarchy

**The content is the signature, and the labels on it are what carry it.** This app nests
boards inside boards; the one thing it cannot afford is a screen that does not say which
project you are standing inside. Orientation outranks polish.

The reading order on a board is: **where you are** (the trail and the app bar), then **the
card titles**, then **the meta on each card**. On Overview it is the card's heading, the node
title, then its meta — the household composes those headings, so the node title underneath
has to carry itself.

- The app bar names the **home**, not the screen. The tab bar already names the screen, and
  work on the cabin recorded on the house board is the failure this prevents.
- A breadcrumb trail is never truncated to nothing. It scrolls.
- **One primary action per surface.** A second saturated block of brand color is a finding.
- The loudest **shape** is the FAB; the loudest **text** is a card title. Different axes,
  and they do not compete.
- **More than one route to the same action is wanted**, not redundancy — you should be able
  to act from wherever you are standing. Each route obeys these rules on its own.

## Motion

**Expressive on manipulation and on state change; still on arrival.**

- **What you manipulate** gets real motion: `drag.lift` so a card reads as off the board
  without the title reflowing under the finger, a spring on release, `drag.landing` kept free
  in every column including an empty one, `drag.edgeZone` for the pane strip. Dragging a card
  to Done should feel physical.
- **What changes underneath you** may animate — a card another member moved sliding into
  place — but only when the element is already on screen, never while you are dragging, and
  never by moving the scroll position under you. Motion you did not ask for is distraction.
- **What merely arrives does not animate.** No entrance animation on a board you navigated
  to, no staggered list reveal, no skeleton shimmer.
- **A control arrives whole, or not yet.** Anything sized by a measurement stays
  invisible until it has measured, then paints once, complete. Content may change
  later because someone edited it. It may not change because the UI has just
  worked out what fits.
- Transform and opacity only.

**`prefers-reduced-motion` is mandatory here, not aspirational** — an expressive appetite is
exactly what makes it load-bearing. Every animation above needs a path where it does not run.
*Currently unimplemented: nothing in the codebase reads the query. This is a known gap, not a
description of the app.*

## Voice

Write the way the household talks, not the way the data model is shaped.

- **Register** — plain, specific, active. Say what happened and what to do next. Never blame
  the user, never imply anyone is behind, no exclamation marks.
- **Capitalisation** — sentence case throughout: headings, buttons, labels, menu items.
- **Banned in user-facing strings** — *node, board, backlog, kanban, item, entity, subtask,
  status*. Every one is jargon in English and a loanword in Swedish, and being made to learn a
  vocabulary for something she already understands is Ingrid's stated quit line.
- Every string goes through `t()`, with `en-US` and `sv-SE` updated in the same change.
  Swedish is longer; a label that fits only one locale is a finding.

## Robustness

Three breakpoints, each earned by a real failure and none of them a device size:
`compactBreakpoint` (below it a board shows one column per screen; above it several flex
between `boardColumnMin` and `boardColumnMax`), `appBarStackBreakpoint` (below it the app bar
puts its title on its own line), `denseBreakpoint` (below it comfortable padding costs more
than it is worth and the controls take the room).

**Overflow** — long text wraps rather than ellipsizing a title. Rows of controls wrap before
they shrink below `touchTarget`. A fixed rail that cannot wrap is the first thing to break at
200% text in Swedish, so position may not be the only carrier of meaning.

## Verification

**Run it:** `scripts/dev-stack.sh up`, then the URL it prints. Sign in via redirect —
*Continue with Google* → `marcus@example.com` → home **Huset**. Without an active home the
tabs redirect to `/homes` and you are reviewing the wrong screen.

**Look at these:**

- **`/overview`** — density, the household's filter cards, and whether an empty card explains
  what earns a place in it.
- **A project board** at both viewports — the column/page/card fill rule, the card face's meta
  and labels, and the drag.
- **A node's `/details`** — the air-where-reading rule, and the form conventions.

In **both schemes** and **both locales**. The measurements — contrast, target size, clipping —
are `e2e/craft.spec.ts` and are not a thing to eyeball; what is left for a human is whether
the Swedish reads like a person wrote it, whether an empty state is honest, and whether the
density overwhelms.

## What people get wrong here

- **Restyling a copy instead of extending the canonical file.** The table above is the whole
  list.
- **`PlaceholderScreen` as a real empty state.** It stands in for a screen that has not landed.
- **Trusting Paper's touch targets.** They are all under `touchTarget`.
- **`Appbar.BackAction`.** Its arrow never reaches `settings.icon` and lands as an unnamed
  `role="img"`. Use `BackAction`; invariant 12 catches it.
- **Letting color carry something words should.** A hue beside the words is fine; a hue
  instead of them is the Trello habit.
- **Solving a footprint problem with color** — quieting a control's fill because it feels
  loud, when what is loud is the room it takes.
- **A meta in the wrong band.** Position is the only thing separating system context from a
  custom label, so a priority in the footer or a label above the title destroys both readings.
- **A desktop-only tooltip.** If it is worth saying on hover it is worth reaching by tap.

## Decisions

Entries land here only after a rule has been **contested** — an agent reverted it, or argued
it was wrong — and then either survived or was overturned. This is not a log of routine
choices.

### 2026-09-03 — The FAB is the loudest shape on the screen, and that is correct

**Contested.** The contract said the content and its labels are the signature and that
orientation "outranks the FAB", while the extended `primaryContainer` FAB is plainly the most
prominent thing on every screen. Both could not be true, and changes were being argued from
whichever half suited them.

**The argument.** The contract had exonerated the FAB's color by measuring lightness
contrast, which is not the axis the FAB dominates on. Re-measured against the running app, the
FAB's fill is quiet against the page and a card title is far louder; the FAB stands out
because it is the only saturated hue in a frame whose neutrals are quiet by design.

**The decision.** The rule was wrong, not the FAB. It keeps `primaryContainer` and its
extended label. Two axes that do not compete: the loudest **shape** is the FAB, the loudest
**text** is a card title. The `fab.widthShare` cap stands on its own merits and was never the
answer to this question.

**What would overturn it — re-armed.** The original condition was the arrival of a categorical
identity palette. That palette is now specified above, and the burden was moved onto it rather
than onto the FAB: no label hue may exceed `primaryContainer` in saturation. This gets
re-measured the first time real colored labels are on a real board, and if the FAB has stopped
reading as the way forward, it is this entry that gets rewritten.

**Re-measured 2026-09-06 — real colored labels are on a real board (#100).** Measured from
the tokens, not the eye. The FAB's fill is 1.31:1 against the light page (2.18:1 in dark) and
its label 11.05:1 (5.85:1) against that fill; a card title is 16.92:1 (10.59:1) against its
card. A drawn label dot clears exactly `fillFloor` — 3:1 against `boardCard`, the smallest
step the clamp allows — and lives in a 20px dot inside a 36px gutter, capped at six per card.
The saturation phrasing above turned out to be the wrong ruler for it: a Tailwind-200 pastel
reads 100% HSL and is still quiet, so the guard that actually holds the line is the clamp in
`models/label-color.ts`, and the label rule above now says so. On the axis this entry was
argued on — what the eye reads as the way forward — the FAB keeps the only large saturated
block and the loudest label on the screen; the dots are marks at the floor, not blocks.
**The decision stands.**
