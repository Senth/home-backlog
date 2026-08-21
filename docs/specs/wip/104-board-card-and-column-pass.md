# Board list area: card, column, and the chrome over them (#104)

## Handoff

- This file is the implementation plan; `/implement` works the **Phases** in order.
- Read `CLAUDE.md` and [`boards-and-nodes.md`](../boards-and-nodes.md) first — this change
  contradicts several passages there, listed under *Spec passages this rewrites*.
- Nothing durable may live only in **Handoff**, **Acceptance** or **Phases**. `/ship`
  deletes all three.
- After the last phase: `/review` in a fresh session, then `/ship` on a PASS.

## 1. What

One pass over the board list area — the card face, the column, and the FAB floating over
them — that re-layers the board's surfaces so a card reads as raised out of a recessed
column, moves the step count out of the title's way and lets it recede, drops the chevron
in favour of a steps glyph, and takes the app's greys off Material's purple default.
The `e2e/` suite gains a desktop viewport alongside its phone one, so the desktop half of
this change — and of every change after it — is measured rather than eyeballed.

## 2. Why

**The surfaces are inverted.** In the dark theme the card is `surface` — `rgb(28,27,31)`,
*the same colour as the page* — sitting on a column of `elevation.level1`,
`rgb(37,35,42)`. So the board reads dark → grey → dark, with a card that is darker than
the thing it sits on. Material's own convention is that elevation lifts toward light, and
the app's **light** theme already obeys it. Only dark is wrong, and it is wrong against
its own light theme.

The fix is a rule rather than three colours: **column recessed, page in the middle, card
raised**, in both schemes. That is what Trello and Linear do in dark mode, and it is what
the issue was reaching for with `rgb(5,10,5)` for the column — the generated ramp lands on
`rgb(8,15,10)`, which is the same instinct arriving by arithmetic.

**The greys are purple.** Every neutral in the app is Material's stock `neutral` /
`neutralVariant` family, which leans violet: the card border everyone reads as white is
`rgb(147,143,153)`, a violet grey. `primary` was overridden to green when the app was
built; the neutrals never were, so every surface in the app quietly fights the brand. Some
of the issue's "maybe even add some color" is that fight being felt rather than named.

Re-neutralising is done by **preserving each Material tone's exact relative luminance and
changing only its hue** — chroma 0.016 at hue 150. Every existing contrast ratio in the
app is therefore unchanged by construction (largest luminance delta: 6.5e-03), so a
repaint of every surface in the app cannot regress an axe check anywhere. This is what
makes an app-wide palette change safe enough to ride along with a board cleanup.

**The count competes with the title.** It is `onSurfaceVariant` on `onSurface`, which is
`rgb(202,196,208)` against `rgb(230,225,229)` — a 1.38× contrast gap, near enough to
identical that the issue read them as "the same white". Lightening the card does not fix
this: the gap is between the two *text* colours and it survives any fill change. So the
count gets its own colour, about 2× dimmer than the title in dark and 3× in light, with
half a stop of headroom over the 4.5:1 floor that `craft.spec.ts` enforces.

**The chevron and the count say the same thing twice.** Both appear exactly when
`hasSteps(node)` is true. The issue asks for the chevron to go, and the persona pass
agreed it may — but only if something sighted still distinguishes a card that drills into
a board from one that opens details. The count is already that signal; it just needs to
carry the meaning explicitly, so it gains a steps glyph. One mark instead of two, and the
mark that survives is the one that also carries information.

*Rejected:* removing both signals, which the issue implies if read literally. A board card
and a plain card would then look identical, and Priya's "Paint the hallway" tap would open
a five-step mountain instead of the next job — the exact thing the card face was designed
to warn about.

*Rejected:* a progress bar in place of the count, as a stronger board signal. Already
settled against in [`boards-and-nodes.md`](../boards-and-nodes.md) — a bar over nested work
lies, reading *1 of 5* when 20 of 30 real jobs are done.

*Rejected:* 375px desktop columns, the issue's literal "25% wider". Four columns then need
1580px, so Done falls off a 1366 or 1440 laptop and every cross-column drag becomes a
drag-with-auto-scroll — a tax on the gesture built in #5. The column flexes instead, so
four columns always fit and a wide monitor is not wasted.

*Rejected:* an icon-only or collapse-on-scroll FAB as the overlap fix. The FAB names its
destination in words on purpose — it is how a card typed one-handed lands where the button
said it would — and hiding the label exactly when the column is full inverts that.

**Desktop has never been measured.** Every craft assertion in `e2e/` is made at 390×844,
which is the right default — it is the width a Swedish label runs out of room in first, and
it is the device this app is used on. But it means the column border, the heading weight,
the flexed width and the smaller card title in this issue would all ship behind no gate at
all, judged once by a browser agent and then never again. The suite gains a viewport axis
for the same reason it already has a locale axis: what is not measured drifts.

*Rejected:* a fixed, larger bottom-padding token for the FAB. Any constant is wrong again
at 200% text or in a locale with a longer verb, which is how the current `space.xxl`
became wrong in Swedish. The FAB is measured instead.

## 3. Data & queries

None. Nothing here reads, writes or stores anything: no field changes, no query changes,
no index changes, no listener changes. `childCount` and `doneCount` are already on the
node and already drive `hasSteps`.

**No migration.** Nothing is being removed that holds data — the chevron and the card's
padding are presentation, and a card in any column is untouched.

## 4. Rules & tests

None. `firestore.rules` and `storage.rules` are not touched, so `tests/rules/` is not
touched either.

## 5. UI flow

### The palette (`theme/index.ts`)

Both palettes gain re-hued neutrals, generated by matching each Material tone's luminance
at chroma 0.016 / hue 150:

| role | today | new |
|---|---|---|
| `neutral10` — dark bg/surface | `rgb(28,27,31)` | `rgb(22,29,23)` |
| `neutral20` | `rgb(49,48,51)` | `rgb(43,51,44)` |
| `neutral90` — dark onSurface | `rgb(230,225,229)` | `rgb(219,230,221)` |
| `neutral95` | `rgb(244,239,244)` | `rgb(233,244,235)` |
| `neutral99` — light bg/surface | `rgb(255,251,254)` | `rgb(244,255,246)` |
| `neutralVariant30` | `rgb(73,69,79)` | `rgb(64,73,66)` |
| `neutralVariant50` — light outline | `rgb(121,116,126)` | `rgb(111,120,113)` |
| `neutralVariant60` — dark outline | `rgb(147,143,153)` | `rgb(138,148,139)` |
| `neutralVariant80` | `rgb(202,196,208)` | `rgb(191,201,192)` |
| `neutralVariant90` | `rgb(231,224,236)` | `rgb(219,230,221)` |
| `elevation.level1` light | `rgb(247,243,249)` | `rgb(237,247,239)` |
| `elevation.level2` light | `rgb(243,237,246)` | `rgb(231,242,233)` |
| `elevation.level3` light | `rgb(238,232,244)` | `rgb(226,237,228)` |
| `elevation.level1` dark | `rgb(37,35,42)` | `rgb(30,38,32)` |
| `elevation.level2` dark | `rgb(44,40,49)` | `rgb(36,43,37)` |
| `elevation.level3` dark | `rgb(49,44,55)` | `rgb(40,48,41)` |

These map onto the MD3 roles Paper already reads — `background`, `surface`,
`surfaceVariant`, `onSurface`, `onSurfaceVariant`, `outline`, `outlineVariant`,
`inverseSurface`, `inverseOnSurface`, `elevation.level1–3` — so every Paper component
follows without a call site changing. `surfaceDisabled`, `onSurfaceDisabled` and
`backdrop` are alpha compositions of the same tones and are re-derived the same way.

Four board colours are added, named once and read everywhere they matter:

| token | dark | light |
|---|---|---|
| `boardColumn` | `rgb(8,15,10)` | `rgb(228,238,230)` |
| `boardCard` | `rgb(40,48,42)` | `rgb(248,255,250)` |
| `boardCardBorder` | `rgb(99,108,100)` | `rgb(158,168,159)` |
| `onCardMuted` | `rgb(152,161,153)` | `rgb(99,108,100)` |

`boardCard` is read by the card face, by the drag overlay in `Board.tsx` and by the drop
landing zone in `BoardColumn.tsx`, so a lifted card cannot be a different shade from the
gap it left.

Measured against these: title on card 10.12:1 dark / 16.19:1 light; count on card 5.10:1
dark / 5.36:1 light; border against card 2.50:1 dark / 2.42:1 light — down from today's
5.41:1 and 4.44:1, which is the glare the issue calls white.

### The card (`components/board/BoardCard.tsx`)

The face becomes two columns: content on the left, a narrow right rail holding the menu
button with the steps glyph and count beneath it. The rail never wraps, so the count is
position-stable at any text size — where a right-float on the chip row strands it below
everything at 200% in Swedish.

- **The chevron is gone.** A card with steps shows `format-list-checks` at `icon.sm` beside
  the count, in `onCardMuted`; a card without steps shows nothing in that corner.
- **The count** is `onCardMuted`, keeping its existing `detail.stepsDone`
  accessibility label so a screen reader still hears "3 of 5 steps done".
- **The title** is `bodyLarge` below `compactBreakpoint` and `bodyMedium` above it, which
  needs a `wide` prop passed down from `BoardColumn` — the card does not measure itself.
- **The border** is `boardCardBorder` at `border.hairline`; the fill is `boardCard`.
- **The tap hint** on a stepless card becomes `board.openDetails` — an action, matching
  `board.open` on the other arm of the same expression.

### The chips (`components/board/MetaChip.tsx`)

`paddingVertical` drops to `space.none`, letting the label's line height set the height;
`paddingHorizontal` stays `space.sm`. `MetaChip` is not a control, so no touch target
applies. **This change does not travel to `ColumnStrip`**, whose Paper `Chip` is the
primary way across a board on a phone and must keep `outlinedTouchTarget`.

### The menu (`components/board/CardMenu.tsx`)

The glyph shrinks to `icon.sm`; the container stays at `touchTarget`. Shrinking the
pressable with the glyph would put a gloved or one-thumbed tap on the card underneath and
navigate away from the board — and `craft.spec.ts` fails the build for it.

### The column (`components/board/BoardColumn.tsx`)

Above `compactBreakpoint`:

- fill `boardColumn`, with a `border.hairline` outline in `boardCardBorder` and
  `radius.md` — the column has no border at all today;
- the header is `titleMedium` at `fontWeight: "bold"`, padded `space.md` rather than
  `space.sm`;
- the empty-column text and the drop landing zone are re-checked against the much darker
  fill.

Below it, the pane's bottom padding becomes the measured FAB inset rather than
`space.xxl`.

### The board (`components/board/Board.tsx`)

- **Column width flexes**: `clamp(size.boardColumnMin, (boardWidth - space.md - space.md *
  n) / n, size.boardColumnMax)` for `n = shown.length`, with `boardColumnMin: 300` and
  `boardColumnMax: 400`. `boardWidth` is already measured for the breakpoint. A board with
  more columns than fit falls back to the minimum and scrolls, exactly as today.
- **The FAB measures itself** with `onLayout`; its height plus `space.md` is passed to
  `BoardColumn` as a bottom inset. Correct in both locales and at every text size.

### The strip (`components/board/ColumnStrip.tsx`)

The label comes from `board.columnChip` instead of being composed in code, and the chip
carries an `accessibilityLabel` from `board.columnChipA11y` so a screen reader hears
"To do, 3 cards" rather than the middle dot read aloud.

### Desktop coverage in `e2e/`

The suite runs at 390×844 only, so every desktop item in this issue — the column border,
the heading weight and padding, the flexed width, the smaller card title — would ship with
no automated gate at all. The suite gains a **viewport axis** alongside its locale axis.

`playwright.config.ts` grows two projects mirroring the phone pair exactly, so the rule
stays "viewport × locale" with nothing new to learn:

| project | viewport | specs |
|---|---|---|
| `en-US` | 390×844 | all |
| `sv-SE` | 390×844 | `craft`, `i18n` |
| `en-US-desktop` | 1920×1080 | all |
| `sv-SE-desktop` | 1920×1080 | `craft`, `i18n` |

`e2e/support/app.ts` exports the viewports by name so a spec can say which width it needs
rather than repeating a literal, and so the next desktop change has somewhere to hang its
checks.

Two consequences worth knowing before the phase starts:

- **`craft.spec.ts` becomes desktop-aware.** Its axe, touch-target and clipped-label
  checks are width-independent and simply run again. Its comment says every assertion is
  made at phone width "because that is where a Swedish label runs out of room first" —
  that reasoning holds for *clipping* but not for the desktop-only styles this issue adds,
  and the comment is updated to say so.
- **The board scrolls horizontally on purpose** above the breakpoint, inside a
  `ScrollView`. The no-horizontal-scroll check measures `document.documentElement`, which
  a `ScrollView` does not move, so it still holds — but it is now asserting something
  meaningful on a route that deliberately scrolls sideways, and the spec says why.

`board-desktop.spec.ts` sets its own viewport per test for the width claims, because the
flex is tightest at 1366 and the point of claim 11 is that 1920 differs from it.

### Offline

Unchanged. Nothing here writes.

## 6. Strings

New keys, both locales:

| key | en-US | sv-SE |
|---|---|---|
| `board.openDetails` | `Open details` | `Öppna detaljer` |
| `board.columnChip` | `{{column}} · {{count}}` | `{{column}} · {{count}}` |
| `board.columnChipA11y_one` | `{{column}}, {{count}} card` | `{{column}}, {{count}} kort` |
| `board.columnChipA11y_other` | `{{column}}, {{count}} cards` | `{{column}}, {{count}} kort` |

**No key is removed.** `detail.title` stops being used as the card's tap hint but remains
the detail screen's own label, so neither locale loses a string.

## 7. Acceptance

1. [test] A card with steps shows a steps glyph and its count; a card without steps shows
   neither, and both still open what they opened before — details without steps, its own
   board with them.
2. [test] No card renders a chevron.
3. [test] A stepless card's accessibility hint is `board.openDetails`, and a card with
   steps still hints `board.open`, in both locales.
4. [test] The step count is still announced as "3 of 5 steps done".
5. [test] Every route still passes axe `wcag2aa` at 390px in both locales and both
   schemes — the repaint regresses no contrast anywhere in the app.
6. [test] The count clears 4.5:1 against the card fill in both schemes.
7. [test] The card's overflow menu button is still at least 48dp, and so is every chip in
   the column strip.
8. [test] At 390×844 with a column full enough to scroll, the last card is fully clear of
   the FAB in both locales, and again at 200% text.
9. [test] The column chip renders from `board.columnChip`, and no raw key is rendered in
   either locale.
10. [test] At 1366px four columns are visible without horizontal scrolling; at 1920px the
    columns are wider than at 1366px and still four.
11. [test] A lifted card's fill matches the card it left.
12. [test] Every route passes axe `wcag2aa` at 1920px in both locales, and no interactive
    element there is under 48dp or has a clipped label.
13. [test] No route scrolls the document horizontally at 1920px, including the board,
    whose own sideways scroll is inside its `ScrollView`.
14. [test] The desktop column header, the card title and the add button render their
    Swedish strings unclipped at 1920px.
15. [eye]  A card reads as raised out of its column, and a column as recessed below the
    page, in both schemes — the dark→grey→dark sandwich is gone.
16. [eye]  The count recedes against the title without looking disabled or unreadable.
17. [eye]  The card border reads as an edge rather than as a bright line.
18. [eye]  The app's greys no longer read as violet, on the board and on every other
    screen.
19. [eye]  A column of bare cards — title only, no chips, no avatars, no steps — reads as
    deliberate rather than unfinished, at 390px and on desktop.
20. [eye]  The desktop column headings read as headings, and the Swedish ones are not
    clipped by their new padding.

## 8. What this does NOT change

- What a tap does, anywhere on the board.
- Drag: the gesture, the gap, the chip and column drop targets, the edge-hold pane switch.
- Which columns exist, their order, or the counts on them.
- Any stored field, query, listener, index or rule.
- The FAB's wording, or that it names its destination.
- `MetaChip` staying a non-control, which is what keeps a screen reader from announcing
  every private card as "dimmed".
- The four detail fields living one tap away rather than on the card face.

## 9. Out of scope

- **Pinning the desktop column's add row** so it does not sit a scroll away in a column of
  40 cards. Found during this pass; it is a behaviour change to a control, so it is
  [#138](https://github.com/Senth/home-backlog/issues/138) rather than part of this.
- Archiving or sorting Done ([#64](https://github.com/Senth/home-backlog/issues/64),
  [#76](https://github.com/Senth/home-backlog/issues/76)).
- Swiping between columns ([#78](https://github.com/Senth/home-backlog/issues/78)), which
  touches the same surface.
- Colour-coding cards by priority or lateness — settled against in
  [`boards-and-nodes.md`](../boards-and-nodes.md).
- Giving bare cards a visual floor. Verified against instead, per claim 19.

## Spec passages this rewrites

`/ship` must fold these, not just append. [`boards-and-nodes.md`](../boards-and-nodes.md)
names the chevron in ten places; these assert it exists:

- ~235–242 — "every card carried a chevron … No children means no chevron, and a tap opens
  the details. One step means a chevron, and a tap drills in."
- ~287–288 — the `childCount` correctness table: *too high* → "a chevron on a childless
  card"; *too low* → "a card with children shows no chevron".
- ~293 — "a card that has lost its chevron still opens its details".
- ~618 — "the worst a wrong value can do is draw a chevron".
- ~1012 — "chevron when `hasSteps(node)`".
- ~1029–1032 — "The chevron is what says which, so the gesture is never ambiguous."
- ~1062 — *Rejected, and reversed:* the chevron on every card. **Keep this note and extend
  it** — the chevron's whole history is a decision reversed once already, and the next
  person needs to know it was then removed deliberately rather than lost.
- ~1432 — "the chevron and `2/5` say whether that tap opens a board or the details".
- ~1518, ~1524 — the tap-behaviour walkthrough.

Each becomes the steps glyph carrying the same meaning. The `childCount` table keeps its
shape: *too high* now draws a glyph and a count on a childless card.

## 10. Phases

```
Phase 1  theme/index.ts re-hued neutrals + 4 board colours;
         tokens.ts boardColumnMin / boardColumnMax           feature-small
Phase 2  BoardCard face: chevron out, glyph + count rail,
         onCardMuted, border, wide title, openDetails string;
         MetaChip padding; CardMenu glyph size                feature-small
Phase 3  BoardColumn + Board: column fill/border/header,
         flex width, measured FAB inset; ColumnStrip keys     feature-small
Phase 4  playwright.config.ts desktop projects + VIEWPORTS
         in e2e/support/app.ts; craft.spec.ts comment          feature-small
Phase 5  e2e specs for claims 1–14, incl. board-desktop.spec  feature-small
```

Phase 1 lands green on its own: the palette swap is luminance-preserving, so `yarn test`
and `yarn e2e` stay green before any component changes.
