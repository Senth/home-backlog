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
icon and colour, is the goal. The frame stays quiet so that the colour which does appear
means something.

**This must never look like:**

- **Trello or Jira's colour habit.** Not the boards — the boards are the point. No card whose
  *status* is a hue, no swimlane tinted by urgency, no red card for late. Colour that says
  which project or which label a card belongs to is wanted. Colour that says how you should
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

Colour does three separate jobs, and mixing them is the failure this section prevents:
**brand** says whose app this is, **status** says something is wrong or done, **identity**
says which group a thing belongs to. One colour never does two of them.

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
- **`warning` / `success`** — status only, and **always carried with words**. A colour may sit
  beside the words; it may never replace them. `components/board/DueChip.tsx` is where this
  is implemented: *overdue is words, never colour*.
- **`error`** — a failure the app is reporting. It does not mean *late*.
- **Priority ramp** — ordinal, not categorical. One hue family in three steps of rising
  saturation over a neutral bottom step. It says *more*, never *different*; identity says
  *different*, never *more*. They sit in different bands of the card face and are never read
  against each other.
- **Label palette** — identity. Twelve named hues, plus user-chosen custom colours. See below.

**Themes.** Both, and they are palettes rather than inversions — a change that looks right in
one is not verified until it has been looked at in the other. Every role exists in both. A
style prop that reads a colour from anywhere but `useAppTheme()` is a defect.

### Labels: the identity palette

**A label is an icon plus a colour. The icon carries the identity; the colour accelerates it.**
That is what makes a large palette safe: two labels whose hues collide under deuteranopia
still have different glyphs, so colour is never the only signal.

- **Twelve hues in the token file**, both schemes given explicitly, each shipping its own
  on-colour. A hue that exists only in light is not a token.
- **Custom colours are data, not tokens.** A user may pick any colour. The app owns its
  legibility: derive the on-colour, and clamp the hue so it clears its contrast floor against
  `boardCard` in both schemes. Never render a pasted hex unmodified and hope.
- **Identity means *different*, never *worse* or *sooner*.** A ramp spent on urgency is a ramp
  that can no longer tell two projects apart, which is the whole reason for having it.
- **Every label has a title**, shown as a tooltip on desktop and on tap on mobile. Any
  information a tooltip carries must be reachable by tap — mobile has no hover, and a
  desktop-only affordance is a feature half the household cannot use.
- **An icon-only label carries its title as the accessible name on its wrapper.**
  `components/ui/PaperIcon.tsx` hides every glyph from the accessibility tree on purpose, so a
  label whose name lives on the glyph has no name at all.
- **No label hue is more saturated than `primaryContainer`**, so the way forward stays the
  loudest shape even on a board full of labels.
- **The card title stays the loudest text on the card.** If a reader sees the colour before
  the title, the colour is too strong.
- A setting renders labels as text instead of icons, for anyone who wants the words.

**Position separates system context from custom labels, and nothing else has to.**
Both families are chips, both may carry a color and neither is constrained to any shape.
Position is still undecided.

## Surfaces and elevation

**Exactly one separation technique: fill.** Paper renders elevation as opaque colour on web,
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
| `bodyLarge` | primary reading text: a node's notes, an empty state's sentence |
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
  finding: it answers with colour a question colour never asked, and costs the app its one
  way forward. See Decisions.
- **Control height** — `touchTarget` is a floor and Paper does not give it to you. `Button` is
  40dp, `Dialog.Actions` 38dp, `IconButton` and `Appbar.Action` render 40dp containers, and
  `SegmentedButtons` needs `segmentedLabelLineHeight` because that is the only way to reach
  it. Use `touchTargetStyle`, `outlinedTouchTarget` for a `Chip`, and
  `contentStyle={{ minHeight: touchTarget }}` on a Paper button that matters.
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
- **One primary action per surface.** A second saturated block of brand colour is a finding.
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
- **Letting colour carry something words should.** A hue beside the words is fine; a hue
  instead of them is the Trello habit.
- **Solving a footprint problem with colour** — quieting a control's fill because it feels
  loud, when what is loud is the room it takes.
- **A chip in the wrong band.** Position is the only thing separating system context from a
  custom label, so a priority above the title or a label below it destroys both readings.
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

**The argument.** The contract had exonerated the FAB's colour by measuring lightness
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
re-measured the first time real coloured labels are on a real board, and if the FAB has stopped
reading as the way forward, it is this entry that gets rewritten.
