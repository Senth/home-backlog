---
name: Home Backlog
source_of_truth: theme/tokens.ts, theme/index.ts
colors:
  light:
    primary: "#2E7D32"
    onPrimary: "#FFFFFF"
    primaryContainer: "#C8E6C9"
    onPrimaryContainer: "#0B2E12"
    secondary: "#4E6A52"
    onSecondary: "#FFFFFF"
    secondaryContainer: "#D1E8D5"
    onSecondaryContainer: "#0C1F10"
    tertiary: "#37656B"
    onTertiary: "#FFFFFF"
    tertiaryContainer: "#BCEBF1"
    onTertiaryContainer: "#002023"
    warning: "#B45309"
    onWarning: "#FFFFFF"
    warningContainer: "#FEF3C7"
    onWarningContainer: "#78350F"
    success: "#047857"
    onSuccess: "#FFFFFF"
    successContainer: "#D1FAE5"
    onSuccessContainer: "#064E3B"
    background: "#F4FFF6"
    onBackground: "#161D17"
    surface: "#F4FFF6"
    onSurface: "#161D17"
    surfaceVariant: "#DBE6DD"
    onSurfaceVariant: "#404942"
    outline: "#6F7871"
    outlineVariant: "#BFC9C0"
    inverseSurface: "#2B332C"
    inverseOnSurface: "#E9F4EB"
    surfaceDisabled: "rgba(22, 29, 23, 0.12)"
    onSurfaceDisabled: "rgba(22, 29, 23, 0.38)"
    backdrop: "rgba(42, 50, 44, 0.4)"
    elevation: { level1: "#EDF7EF", level2: "#E7F2E9", level3: "#E2EDE4" }
    boardColumn: "#E4EEE6"
    boardCard: "#F8FFFA"
    boardCardBorder: "#889289"
    onCardMuted: "#636C64"
  dark:
    primary: "#A5D6A7"
    onPrimary: "#0B2E12"
    primaryContainer: "#1B5E20"
    onPrimaryContainer: "#C8E6C9"
    secondary: "#B5CCB8"
    onSecondary: "#203524"
    secondaryContainer: "#364B39"
    onSecondaryContainer: "#D1E8D5"
    tertiary: "#A0CFD5"
    onTertiary: "#00363B"
    tertiaryContainer: "#1E4D53"
    onTertiaryContainer: "#BCEBF1"
    warning: "#FCD34D"
    onWarning: "#78350F"
    warningContainer: "#92400E"
    onWarningContainer: "#FEF3C7"
    success: "#34D399"
    onSuccess: "#064E3B"
    successContainer: "#065F46"
    onSuccessContainer: "#D1FAE5"
    background: "#161D17"
    onBackground: "#DBE6DD"
    surface: "#161D17"
    onSurface: "#DBE6DD"
    surfaceVariant: "#404942"
    onSurfaceVariant: "#BFC9C0"
    outline: "#8A948B"
    outlineVariant: "#404942"
    inverseSurface: "#DBE6DD"
    inverseOnSurface: "#2B332C"
    surfaceDisabled: "rgba(219, 230, 221, 0.12)"
    onSurfaceDisabled: "rgba(219, 230, 221, 0.38)"
    backdrop: "rgba(42, 50, 44, 0.4)"
    elevation: { level1: "#1E2620", level2: "#242B25", level3: "#283029" }
    boardColumn: "#080F0A"
    boardCard: "#28302A"
    boardCardBorder: "#636C64"
    onCardMuted: "#98A199"
typography:
  displaySmall: { fontFamily: &sans 'Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif', fontSize: 36, lineHeight: 44, fontWeight: 400 }
  titleMedium:  { fontFamily: *sans, fontSize: 16, lineHeight: 24, fontWeight: 500, letterSpacing: 0.15 }
  bodyLarge:    { fontFamily: *sans, fontSize: 16, lineHeight: 24, fontWeight: 400, letterSpacing: 0.15 }
  bodyMedium:   { fontFamily: *sans, fontSize: 14, lineHeight: 20, fontWeight: 400, letterSpacing: 0.25 }
  bodySmall:    { fontFamily: *sans, fontSize: 12, lineHeight: 16, fontWeight: 400, letterSpacing: 0.4 }
  labelLarge:   { fontFamily: *sans, fontSize: 14, lineHeight: 20, fontWeight: 500, letterSpacing: 0.1 }
  labelMedium:  { fontFamily: *sans, fontSize: 12, lineHeight: 16, fontWeight: 500, letterSpacing: 0.5 }
spacing: { none: 0, xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 }
radius: { none: 0, sm: 8, md: 12, lg: 16, xl: 28, full: 999 }
elevation: { none: 0, low: 1, medium: 2, high: 3 }
contentWidth: { form: 400, dialog: 560, snackbar: 600 }
size:
  avatarXs: 24
  avatarSm: 32
  avatarMd: 48
  brandMark: 96
  boardColumnMin: 300
  boardColumnMax: 400
  dot: 8
icon: { sm: 16, md: 24 }
border: { hairline: 1 }
drag: { lift: 1.04, landing: 72, edgeZone: 36 }
fab: { widthShare: 0.6 }
touchTarget: 48
outlinedTouchTarget: 50
segmentedLabelLineHeight: 30
focusRing: { width: 2, offset: 2 }
breakpoints: { dense: 320, appBarStack: 360, compact: 720 }
density: comfortable
---

# Design contract

**`theme/tokens.ts` and `theme/index.ts` are the source of truth. This file is the rules.**
The front matter above is a transcription of those two files; when it disagrees with them,
they are right and this file is stale — say so rather than editing the code to match. It
mirrors their key names on purpose, so the two can be diffed by eye: `colors` is split into
`light` and `dark` because the app has two palettes and neither is derived from the other,
and the scale is `radius` rather than `rounded` because that is what the code calls it.
`npx @google/design.md lint` warns about both. Ignore it on those two, and read the code.

Two documents carry the reasoning behind the values and are not repeated here. Read them
before proposing a change to either:

- the `theme/index.ts` docblocks, for why each palette is what it is;
- [`platform-offline.md` § The palette](specs/platform-offline.md#the-palette), for the
  re-hued neutral ramp, the tone-by-tone table, and the keyboard focus ring.

**Nobody edits this file mid-run.** A review finding cites a rule here or says in words that
it is a taste call. Proposed rule changes are collected as one diff for the human. Widening
a rule so that the change in front of you passes is the failure this sentence exists to
prevent.

## 1. Identity

Home Backlog is one household's list of everything the house and garden need, on nested
kanban boards anchored to a second hierarchy of places. Two or more people use it, and they
use it *irregularly* — Marcus opens it mid-project, Ingrid opens it when the chimney sweep
has been. It is not a tool anyone lives in all day.

That irregularity sets the density. Someone who has not opened the app for three weeks has
to be re-oriented by the screen itself, not by remembering where they left off.

## 2. Direction

Material 3 as the grammar, not as the look. **This is not an ordinary MD3 app and it is not
heading towards one.** It is going to carry a lot of colour, and the reason is scanning: a
household opening a board wants to find the thing they came for and know where they are
standing, and on a screen of similar-looking cards colour is the fastest way to tell one
group from another.

That is a different job from the one MD3's palette is built for. `primary` / `secondary` /
`tertiary` are three accents for one product's voice; what this app needs on top is a
**categorical ramp** — many hues that mean *different*, not *more important*. Custom labels
will carry colours, and cards may well be coloured by the project they belong to. Neither
the axis nor the form is decided; both are a later issue, and section 3 says what is already
binding on whatever they turn out to be.

What is settled: green as the brand, chosen so it is not the sibling repertoire app's purple
in a tab strip and so red and amber stay free to mean something; and a neutral ramp re-hued
off Material's violet default at **exactly preserved luminance**, so a repaint of every
surface moved no contrast ratio at all. The neutrals are quiet on purpose, and now there is
a second reason for it: they are the ground a categorical ramp has to read against.

Where it departs from stock MD3: `warning` and `success` are additions, which is why
`useAppTheme()` exists rather than Paper's `useTheme()`. The board carries four surfaces of
its own. Elevation stops at level 3.

## 3. Colour

Colour in this app does three separate jobs, and mixing them is the failure this section
exists to prevent: **brand** says whose app this is, **status** says something is wrong or
done, and **identity** says which group a thing belongs to. One colour never does two of
them.

**Primary is brand and it marks the way forward, never a mood.** It is the FAB, the active
tab, a link, the focus ring and the brand mark. It is never a background for a block of
content, never a status, and never a card's identity. The FAB keeps `primaryContainer` in
both schemes: what governs how loud it reads is the room it takes (§ 7), not its fill — a
raised control is separated by elevation and shadow, not by fill contrast against the page.

**Status is `warning` and `success`, and it is always carried with words.** This is the
rule the app is most opinionated about, and `components/board/DueChip.tsx` is where it is
implemented: *overdue is words, never colour*. Nothing in the app acts on a due date yet, so
a red card is guilt for a deadline nothing will remind anyone about — and words survive
200% text and colour blindness, which a colour alone does not. A colour may sit beside the
words. It may never replace them.

`error` and its `on`/container roles are Paper's MD3 defaults, deliberately not overridden.
Red means a failure the app is reporting. It does not mean *late*.

**Surfaces separate by fill, not by shadow.** Paper renders elevation as opaque colour on
web, so a shadow is not available and is not wanted. The board's rule, in both schemes, is
**column recessed, page in the middle, card raised**: `boardColumn` → `background` →
`boardCard`. `boardCardBorder` is the card's edge below `compactBreakpoint`, where the
column carries no fill and the border is the only thing separating a card from the page.

**Two outline roles, and they are not interchangeable.** `outline` is a boundary that has
to be seen — 4.45:1 against the light surface, 5.47:1 against the dark one. `outlineVariant`
is a divider between related content and is deliberately faint, 1.66:1 and 1.84:1; it may
never be the only thing separating two things a user has to tell apart. `boardCardBorder`
clears 3:1 against the page in both schemes (3.14 and 3.16), which is the number that
matters: below `compactBreakpoint` the column has no fill and that border is the card's only
edge.

`onCardMuted` is the muted step count on a card face and nothing else. It is roughly 2×
dimmer than the title in dark and 3× in light, and still clears 5.1:1 against the card.

### Identity colour, and what is already binding on it

The categorical ramp does not exist yet. When it lands, these hold, and a spec that proposes
otherwise is proposing a change to this file:

- **It is a named scale in `theme/tokens.ts` like every other**, with both schemes given
  explicitly. A hue that only exists in light is not a token.
- **It means *different*, never *worse* or *sooner*.** Status stays `warning` / `success` /
  `error` and stays carried with words. A ramp spent on urgency is a ramp that can no longer
  tell two projects apart, which is the whole reason for having it.
- **Every hue clears 4.5:1 against whatever text sits on it**, in both schemes, and
  `e2e/craft.spec.ts` measures it. A colour that needs its own on-colour ships with one.
- **The card title stays the loudest thing on the card.** Colour groups cards; it does not
  outrank what they say. If a reader sees the colour before the title, the colour is too
  strong.
- **It survives colour blindness and greyscale.** Colour is never the only way to tell two
  cards apart — a label, a glyph or the trail always says the same thing.

### Both schemes are palettes, not inversions

Dark is not light with the values flipped, and a change that looks right in one is not
verified until it has been looked at in the other. Every colour in the front matter above
exists in both. A style prop that reads a colour from anywhere but `useAppTheme()` is a
defect, whichever scheme it was written in.

## 4. Typography

Seven Paper variants are in use and no more should be introduced without a reason written
into the Decisions section below:

| Variant | Means |
|---|---|
| `displaySmall` | the app name on the login screen. One use, and it stays one |
| `titleMedium` | a card title, a section heading, a dialog title |
| `bodyLarge` | primary reading text: a node's notes, an empty state's sentence |
| `bodyMedium` | secondary text and list rows |
| `bodySmall` | metadata: dates, counts, footnotes |
| `labelLarge` | button and chip labels |
| `labelMedium` | tab labels and the smallest chips |

Two weights: 400 and 500. Paper owns the typescale — `theme/` overrides no font — so a
custom `fontSize` in a style prop is both a numeric literal and a variant that should have
existed. Use the variant.

## 5. Layout and spacing

The 4pt scale in `space`, and nothing between its steps. `space.none` exists so that
*removing* a Paper component's own default margin is still a token.

**Content clamps rather than stretching.** `contentWidth.form` (400) for a form,
`.dialog` (560) and `.snackbar` (600) for the two Paper components that do not clamp
themselves on web. A form across a desktop monitor is a form nobody can read.

Three breakpoints, each earned by a real failure and none of them a device size:

- **`compactBreakpoint` 720** — below it a board shows one column per screen; above it,
  several side by side, flexing between `boardColumnMin` 300 and `boardColumnMax` 400.
- **`appBarStackBreakpoint` 360** — below it the app bar puts its title on its own line. A
  390px phone at 200% text is a 195px viewport, and three 48dp targets plus padding leave
  three pixels for the title.
- **`denseBreakpoint` 320** — below it comfortable padding costs more than it is worth and
  the controls take the room.

Proximity: the gap between groups is visibly larger than the gap within one. In practice
that is `space.md` inside a group and `space.lg` between — **per route**. `/overview` and a
node's `/details` take the air: `space.lg` between their groups. A board column keeps
`space.md` throughout, because its whole job is cards per screen and `space.lg` between
every group of meta on a card is vertical pixels the column cannot spare. Neither half is
a taste call.

## 6. Components

Extend the canonical implementation. Restyling a copy is a defect.

| Component | Canonical file | Notes |
|---|---|---|
| Board card | `components/board/BoardCard.tsx` | the raised surface; reads `boardCard` |
| Board column | `components/board/BoardColumn.tsx` | the recessed surface |
| Breadcrumbs | `components/board/Breadcrumbs.tsx` | *Projects › Bathroom › Tiling*; an unreadable ancestor renders as a neutral unlinked crumb, never a gap |
| Due chip | `components/board/DueChip.tsx` | the words-not-colour rule, in one place |
| Meta chip | `components/board/MetaChip.tsx` | every count and glyph on a card face |
| Dialog | `components/ui/AppDialog.tsx` | clamps to `contentWidth.dialog` |
| Row | `components/ui/Row.tsx` | the list row used across Overview and detail |
| Avatar | `components/ui/PersonAvatar.tsx` | `avatarXs` on a card, `avatarSm` in the app bar |
| Empty screen | `components/ui/PlaceholderScreen.tsx` | **scaffolding for screens that have not landed.** Not the pattern for a real empty state |
| Back action | `components/ui/BackAction.tsx` | carries `touchTargetStyle`; Paper's is 40dp |

Reach for a `react-native-paper` component before building one. A hand-rolled control where
Paper has one is a finding, and so is a Paper component used against its own semantics.

## 7. Hierarchy: you always know where you are

**The content is the signature, and the labels on it are what carry it.** This app nests
boards inside boards; the one thing it cannot afford is a screen that does not say which
project you are standing inside. Orientation outranks polish, and it outranks the FAB.

Every judgement call on a board comes back to one question: **can someone who has not opened
this for three weeks find what they came for, and tell where they are?** That is what the
coming identity palette is for, and it is also why the neutrals are quiet, why the trail
scrolls instead of truncating, and why the app bar names the home rather than the screen. A
change that makes a screen prettier and harder to scan is a change that lost.

The reading order on a board is:

1. **Where you are** — the breadcrumb trail and the app bar title.
2. **The card titles**, in the column you are looking at.
3. **The meta on each card** — status, due, counts, people.

On Overview it is: the section heading (*Ongoing projects*), the node title, then its meta.
Overview is named Overview and never "home", because *home* is the household you are in and
the screen that shows which home you are in is the one place the app cannot spend that word
twice.

Consequences a reviewer can cite:

- The app bar names the **home**, not the screen. The tab bar already names the screen, and
  which home you are in has to be visible without a tap — work on the cabin recorded on the
  house board is the failure this prevents.
- A breadcrumb trail is never truncated to nothing. It scrolls.
- **One primary action per surface**, and it is the FAB. A second saturated block of brand
  colour on the same screen is a finding.
- The FAB is a control, not the signature. Measured, it was never the colour that made it
  dominate — `primaryContainer` on `surface` is a quiet fill — it was the width: at 200%
  text it once spanned 91.8% of the screen. So the rule it earns is about room: **the FAB
  keeps its colour by being the one primary action; what it must not take is space.** It
  spans at most `fab.widthShare` (0.6) of the width it is laid out in, and below
  `denseBreakpoint` the plus glyph yields so the label wraps and the words stay. A FAB that
  breaks the cap, or one quieted to `surface` to solve with colour what is a footprint
  problem, is a finding either way.

## 8. States

**Empty.** A real empty state names what is missing and offers the action that creates it.
"No locations yet." is `PlaceholderScreen`, which stands in for a screen that has not been
built — it is not the pattern to copy, and a landed screen that ships that shape is a
finding.

**Loading.** Paper's `ActivityIndicator`. The splash holds the router until auth resolves,
so the app never renders the wrong screen and then corrects itself.

**Error.** Say what happened and what to do. A `Snackbar`, clamped to
`contentWidth.snackbar`, for something the user can retry; `HelperText` for a field.

**Overflow.** Long text wraps; it does not ellipsize a title. Rows of controls wrap before
they shrink below `touchTarget`.

## 9. Motion

Almost nothing animates, and that is deliberate for an app opened once a fortnight.

The exception is the drag: `drag.lift` 1.04 is enough for a card to read as *off the board*
without the title reflowing under the finger; `drag.landing` 72 is the room every column
keeps free for a drop, including an empty one; `drag.edgeZone` 36 is how far the
pane-switching strip reaches, kept narrow because a thumb rests near the right edge of a
390px screen.

`prefers-reduced-motion` is honoured.

## 10. Accessibility

- **WCAG AA, 4.5:1, in both schemes**, and `e2e/craft.spec.ts` enforces it. The neutral
  ramp was re-hued at unchanged luminance precisely so this could never regress.
- **`touchTarget` 48dp is a floor, not a target.** Paper does not give it to you: `Button`
  is 40dp, `Dialog.Actions` buttons are 38dp, `IconButton` and `Appbar.Action` render 40dp
  containers, and `SegmentedButtons` needs `segmentedLabelLineHeight` because 9 + 30 + 9 is
  the only way to reach 48. Use `touchTargetStyle`, `outlinedTouchTarget` for a `Chip`, and
  `contentStyle={{ minHeight: touchTarget }}` on a Paper button that matters.
- **The focus ring is one app-wide CSS rule** in `theme/focus-visible.ts`, injected by
  `app/+html.tsx`. It cannot be a style prop: React Native Web compiles `outline*` to atomic
  classes with no selector, so the ring would be painted always.
- Every user-facing string goes through `t()`, in `en-US` **and** `sv-SE`. Swedish is longer
  than English; a label that only fits in one locale is a finding.

## 11. Anti-patterns

Forbidden vocabulary, specific to this app:

- **Never Trello or Jira**, and the line is precise: no card whose **status** is a colour,
  no swimlane tinted by urgency, no red card for late. Colour that says which project or
  which label a card belongs to is wanted and is coming. Colour that says *how you should
  feel about this card* is not. A card's meaning is its words.
- **Never a productivity dashboard.** No charts, no streaks, no completion percentage, no
  progress ring, no number that grades the household. Overview answers *is anything on fire,
  did we get anywhere* with three lists and no metrics.
- **Never an app that nags.** No badge counts, no red dot on a tab, no urgency banner, no
  empty state that implies you are behind. `size.dot` is a mark that something is there, and
  it stays a mark.
- **No numeric literal in a style prop, and no colour literal outside `theme/`.** Extend the
  scale instead of inlining. `margin: dense ? space.sm : 16` breaks this rule; so does
  `const CARD_WIDTH = 300` one line above the style prop. Invariants 1–3 catch the common
  shapes, and the rule is always wider than the regex.
- **No `StyleSheet.create`, no Tailwind, no NativeWind.** Rejected on the record in
  `PROJECT.md`; not a preference to revisit inside a feature.
- No nested card on card. No gradient. No emoji in the UI.

## 12. Verification

- **Run the app:** `scripts/dev-stack.sh up` → the URL it prints.
  `scripts/dev-stack.sh status` lists the ports.
- **Representative routes:** `/overview`, `/projects`, a drilled-in board, a node's
  `/details`, `/homes`, `/login`.
- **Viewports:** 390×844 always; desktop only where a layout genuinely differs above
  `compactBreakpoint`.
- **Schemes:** light and dark, both, every time.
- **Measured, not judged:** `e2e/craft.spec.ts` owns contrast, touch targets, horizontal
  scroll, clipped labels, axe violations and raw `t()` keys. If a check can be measured it
  belongs there and never in an agent's turn.

## Decisions

Append-only. Date, decision, rationale, and which surface prompted it.

- **2026-08-28** — Contract written, largely as transcription. The token values and the
  palette reasoning already existed in `theme/` and `platform-offline.md`; what did not
  exist was a citable rule for a reviewer to quote. (from: the whole app)
- **2026-08-28** — The signature is the content and its labels, not the FAB. An app of
  boards inside boards has to answer *where am I* before it does anything else, and the
  extended `primaryContainer` FAB currently competes with the card titles for the eye.
  Recorded as intent; the gap is the design-debt issue's to close. (from: /projects)
- **2026-08-28** — Anti-references fixed as Trello/Jira, the productivity dashboard, and
  the app that nags. The dense enterprise tool was considered and rejected as an
  anti-reference: `contentWidth` and the one-primary-action rule already defend against it.
  (from: interview)
- **2026-08-28** — **Open: the categorical card palette.** The app will carry a lot of
  colour, for scanning. Custom labels will have colours, and cards may be coloured by the
  project they belong to. Neither the axis (project, location, or household choice) nor the
  form (edge, full tint, or chip) is decided; both belong to the issue that builds it. What
  is binding in the meantime is in § 3 — a named scale in both schemes, identity never
  status, AA against its own text, and the title still louder than the colour. Recorded
  rather than guessed, so the spec that lands it is not arguing with a rule invented here.
  (from: interview)
- **2026-08-29** — § 7's FAB rule is about room, not colour. The 3:1 fill-vs-page floor
  proposed for the FAB was measured at 1.31:1 in light and 2.18:1 in dark and then
  withdrawn: it was a threshold this contract invented, not one MD3 imposes —
  `primaryContainer` on `surface` is MD3's own FAB pairing, and a raised control is
  separated by elevation and shadow, not fill contrast. What made the FAB dominate was
  width (91.8% of a 195px screen in Swedish at 200% text), so the rule caps the footprint
  at `fab.widthShare` 0.6 and below `denseBreakpoint` the plus glyph yields so the label
  wraps. The fill stays `primaryContainer` in both schemes. (from: /projects)
- **2026-08-29** — Proximity is per route. `/overview` and a node's `/details` use
  `space.lg` between groups and `space.md` within; a board column keeps `space.md`
  throughout. A column's whole job is cards per screen, and its density is deliberate —
  recorded so it is not re-argued as a finding on the next review. (from: /projects)
- **2026-08-29** — `PAPER_INTERNALS` in `e2e/craft.spec.ts` is a closed, named list of
  third-party internals that the on-scale spacing sweep exempts, carrying an `owner` column
  that names the Paper component owning each value. The rule: an entry may name a Paper
  internal and never one of our screens. Adding an entry when Paper grows a control is one
  line; adding one to make our own change pass is the failure the table exists to prevent.
  (from: e2e/craft.spec.ts)
