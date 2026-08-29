# Handoff

Issue [#161](https://github.com/Senth/home-backlog/issues/161), branch
`cleanup/161-design-contract-pass`. Kickoff ran `homeowner-review` and `grill-me`; the
measurements below were taken against the running app at 390×844 and 195×422, in both
locales, before the spec was written.

Baseline on `origin/main` when this spec was written: `yarn lint`, `yarn invariants` (12/12),
`yarn typecheck`, `yarn test` (188) and `yarn e2e` (206 passed, 5 skipped) all green
locally. The three failures this issue names are **CI-only**, and their cause is in § 4
below.

## 1. What

The app is read against `docs/DESIGN.md` for the first time: § 7's FAB contradiction is
closed by amending the rule, the strip's resting chip is re-weighted with it, and the three
craft checks that nobody measures — off-scale spacing, off-palette colour, near-miss
alignment — become code in `e2e/craft.spec.ts`, plus a fourth the persona pass found
missing.

## 2. Why

**The contract has never been read against the app.** `docs/DESIGN.md` landed in `0e5f15b`
as a transcription of `theme/tokens.ts` plus the rules that make those values mean
something. Until something measures it, it is a document that describes an app nobody
checked.

### Why the rule changes and not the FAB's fill

§ 7 says the FAB must not compete with the card titles for the eye, and names colour as the
culprit. Measured, that diagnosis is wrong. In light, `primaryContainer` `#C8E6C9` sits on a
`#F4FFF6` page — that is not a loud colour by any absolute measure. What makes the FAB
dominate is **width**:

| locale | viewport | FAB box | share of viewport width |
|---|---|---|---|
| en-US | 390px | 152×56 | 39.0% |
| sv-SE | 390px | 181×56 | 46.4% |
| en-US | 195px (200% zoom) | 152×56 | **77.9%** |
| sv-SE | 195px (200% zoom) | 179×56 | **91.8%** |

At 200% text in Swedish the FAB spans essentially the whole screen, and it does **not** wrap
to two lines the way `boards-and-nodes.md` assumes — it keeps its 56px height and takes the
width. That is Ingrid's phone, her locale, her text size.

Colour is the cheapest lever to pull and the one that costs the most findability per unit of
quiet. Nadia and Tom open this app to write one line and leave; the FAB is the entire
affordance for that. § 7's own test — *can someone who has not opened this for three weeks
find what they came for* — only defends reading, and the app is used for two acts by two
kinds of person. So the rule becomes a rule about **room**, not about colour, and
`primaryContainer` stays.

Rejected: quieting the fill to a `surface` variant. It breaks
[`overview.md`](../overview.md) line 352 — *"The first-run line points at the FAB rather
than carrying a second button for the same action"* — which is the screen Ingrid meets when
she switches to the cabin home in October. A pale button that a sentence points at is a
sentence pointing at nothing.

Rejected: an icon-only or collapse-on-scroll FAB. Already rejected in
[`boards-and-nodes.md`](../boards-and-nodes.md) § Creating a card — the button names its
destination in words on purpose.

### Why the checks are scoped the way they are

The app authors **no off-scale spacing at all**. Measured across `/homes`, `/projects`,
`/overview`, `/automations` and `/locations` at 390px, every off-scale computed value
belongs to `react-native-paper`:

| value | × | source | whose |
|---|---|---|---|
| 5px | 48 | `a[role="tab"]` — `BottomNavigation` tab items | Paper |
| 6px | 42 | `#icon-button-container` — `IconButton`, `Chip` margins | Paper |
| 13px | 6 | Overview's section headings — `List.Subheader` | Paper |
| 12px | 5 | `#appbar-content` — `Appbar.Content` left margin | Paper |
| 10px | 4 | `#button-text` — `Button` label margin | Paper |
| 88px | 2 | the pane's bottom inset, from the FAB's own `onLayout` | app, deliberate |
| −16px | 2 | `−space.md` | app, on-scale by magnitude |

So the issue's *"fix the check or fix the app"* fork resolves to **fix the check**: there is
no app-side spacing debt to pay, and a naive check would fail on Paper alone. The exception
table in § 6 is therefore a statement about a dependency, not a baseline — see the rule that
keeps it that way.

Colour and alignment came out equally small: 19 distinct rendered colours, of which 15 map
exactly to the palette; and **zero** near-miss edge pairs between painted boxes at
tolerances of 1px and 2px, one pair at 3px and 4px.

### Why a fourth check

An off-palette check asks whether a rendered colour is *in* a scheme. A `surface` FAB on a
`surface` page passes it — every colour is a token. Nothing in `craft.spec.ts` measures a
control's fill against the surface behind it, so this pass could close the three gaps it
names and still ship a button Tom cannot find in the garage at half brightness. § 3 already
applies a 3:1 floor to `boardCardBorder` for exactly this reason.

## 3. Data & queries

No change. No Firestore field, index, query or listener is added, removed or altered by this
spec.

## 4. Rules & tests

`firestore.rules` and `storage.rules` are untouched, so `tests/rules/` is untouched.

**The three CI-only e2e failures are one bug in one helper.** `e2e/rest-api.spec.ts:43`,
`withApiKey`:

- Every key is minted under the same literal name, `KEY_NAME = "E2E rest api key"`.
- The key is created **outside** the `try`. Four awaits sit between the `Create` click and
  the `try`, and any of them throwing leaks a key that is never revoked.
- The revoke locator matches **by name**, so one leaked key makes
  `getByRole("button", { name: "Revoke E2E rest api key" })` a strict-mode violation in
  every later test.

CI's first error is `expect(secret).toBeVisible() failed` — the secret dialog did not render
in time — and from there the count climbs one per attempt: 2, 2, 3, 4, 5, 6 across tests 13,
18 and 22 and their retries. It passes locally only because nothing trips the first domino.

The docblock's claim that *"a crashed run leaves nothing behind but a card"* is the false
assumption the cascade rests on, and it is corrected with the code.

## 5. Surface brief

```
Job:      Ingrid opens the cabin home at 200% text in Swedish to write down what
          the chimney sweep said, and the button she needs is 92% of her screen
Primary:  the FAB, still naming its destination in words. Exactly one per surface
Read:     1st where you are (app bar + trail) · 2nd the card titles · 3rd the meta
Not like: a screen where the control is the biggest thing on it
Remove / quiet / sharpen:  remove nothing · quiet the strip's resting selected
          chip · sharpen the FAB by making it take less room, not less colour
```

## 6. UI flow

### The FAB, and the rule that judges it

`primaryContainer` is kept, in both schemes. What changes is the footprint, and the
constraint is claim 31: at 195px, in both locales, the FAB spans no more than 60% of the
viewport width. Today that is 77.9% and 91.8%.

The mechanism is the implement phase's to choose with the `design-apply` skill — wrapping
the label below a breakpoint and letting the box grow taller is the obvious candidate. Two
things constrain it:

- **The words stay.** Locked by `boards-and-nodes.md`, and both Nadia and Ingrid depend on
  them.
- **The pane inset is measured, never a constant.** `Board.tsx` reads the FAB's own
  `onLayout` because every constant tried there was wrong. A footprint change reopens that
  arithmetic, which is why `fab.spec.ts` claim 8 stays green in `sv-SE` at 200% as a gate on
  this work rather than only at default text size.

If a full-width bottom action turns out to be the honest answer rather than a floating pill,
that is a spec change and comes back to the user — it is the one place this spec expects to
be revised.

### `ColumnStrip`

`§ 7`'s amended line judges the screen **at rest**, which splits the strip cleanly:

- **The resting selected chip is re-weighted.** It is always visible and it is what competes
  with the card titles when nobody is dragging.
- **The mid-drag `theme.colors.primary` drop marker is unchanged.** It is transient, it is
  the only drop affordance below `compactBreakpoint`, and Marcus depends on it every session.

### `docs/DESIGN.md`

Edited in this PR, which the contract normally forbids mid-run — permitted here because
closing § 7's open item *is* the issue, and the rule losing means the rule changes rather
than quietly staying false.

- § 7's closing line becomes a rule about room: the FAB earns its colour by being the one
  primary action; what it must not take is space.
- § 3's *"Primary is brand… It is the FAB"* is amended in the same diff so the two sections
  do not contradict each other.
- § 5 gains the per-route proximity call below.
- *Decisions* gains dated entries for the § 7 resolution, the per-route proximity split, and
  the exception table's existence.

### Proximity, per route

§ 5's rule spends vertical pixels, and a board column's whole job is cards per screen.

- **`/overview` and a node's `/details` get the air** — `space.lg` between groups,
  `space.md` within.
- **A board column keeps its density.** Recorded in *Decisions* so it is not re-argued as a
  finding on the next review.

### The three checks, and the fourth

All four are written natively against `theme/tokens.ts` and `theme/index.ts`.
`design-apply`'s `audit.js` is **not** used — it was written for a DOM app and this is React
Native Web.

**Off-scale spacing.** Every computed `padding*`, `margin*` and `*Gap` on a rendered element
must be a step in `space` — `0, 4, 8, 16, 24, 32, 48` — **by absolute value**. Not "a
multiple of 4": `20px` and `36px` fail. Two carve-outs:

1. A value read from any export of `theme/tokens.ts`, or derived at runtime from a measured
   element, is on-scale. This is what makes the 88px pane inset and `drag.landing` 72 /
   `drag.edgeZone` 36 / `drag.lift` 1.04 legal rather than defects.
2. A closed table of `react-native-paper` internals, each entry naming **three** things:

   | value | selector | the Paper component that owns it |
   |---|---|---|
   | 5px | `a[role="tab"]` | `BottomNavigation`'s tab item padding |
   | 6px | `#icon-button-container` | `IconButton`'s container margin |
   | 13px | `List.Subheader` | Paper's subheader padding |
   | 12px | `#appbar-content` | `Appbar.Content`'s left margin |
   | 10px | `#button-text` | `Button`'s label margin |
   | 6px | `[data-testid$="-content"]` parent | `List.Item`'s row margin |
   | 9px | `#button-text` | `Button`'s label margin in text+icon mode |
   | 14px | outlined input | `TextInput`'s outlined input padding |

   **An entry may only ever name a third-party component's internal.** An entry naming one
   of our own screens is the baseline this issue forbids, and review rejects it on sight.
   The third column is what lets a reviewer tell the two apart. Adding a further entry when
   Paper grows a control is one line; adding one to make our own change pass is not allowed.

**Off-palette colour.** The input is `lightTheme.colors` / `darkTheme.colors` from
`theme/index.ts`, **not** `theme/tokens.ts` — which contains no colours at all. The issue is
wrong on that point and the spec is right. On-palette means: every value spread into those
objects, which includes Paper's MD3 defaults (`error`, `errorContainer`, …) and
`elevation.level0`–`level5`, plus fully transparent. Scoped to elements that actually paint:
`color` only on elements with their own text, `backgroundColor` and border colours only
where they are not the UA default — otherwise the check reports `rgb(0,0,0)` 711 times for
divs with no text, which is a scoping artefact and not a finding.

**Near-miss alignment.** Two painted boxes whose edges on the same axis differ by more than
0 and less than `space.xs` (4) are a finding. Measured **between painted boxes only** — an
element with a background fill or a visible border — and never between a component box and
the text inside it: Paper's `Chip` carries its own inner padding, so the chip box can align
while the label sits 8–12px inboard, and snapping one breaks the other on every card face.
Measured at rest; no drag state.

**Fill against the page — withdrawn.** This check was specified as the FAB's fill clearing
**3:1** against the surface behind it, by analogy with the number § 3 applies to
`boardCardBorder`. Measured, the FAB is at 1.31:1 in light and 2.18:1 in dark, and the analogy
does not hold: § 3's number governs a *border*, which exists to draw an edge, while
`primaryContainer` on `surface` is MD3's own FAB pairing and carries no fill-vs-page floor in
the Material spec. A raised control is separated by elevation and shadow, not by fill contrast.

So the check is withdrawn rather than the fill changed, and § 9's `primaryContainer` stands
untouched. What the check was reaching for — a button Tom can still find in the garage at half
brightness — is already claim 33, judged by eye in both schemes. A fabricated threshold that
would have forced a colour change § 2 argued against is worse than the eye check that was
always there.

### Where the checks run

The three sweeps iterate `ROUTES` and so run in all four Playwright projects, joining the
existing width-independent checks. § 12 also names `/login` and a node's `/details`, which
`ROUTES` does not carry — `/login` is unauthenticated and the shared authed context would
redirect it; `/details` is parameterised and reached by clicking. Each gets its **own test**
rather than a `ROUTES` entry, so `console.spec.ts` and `i18n.spec.ts` are untouched:
`/login` with `storageState` unset, `/details` by clicking through from the board the way
claim 21 already does.

## 7. Strings

**No new `t()` keys, and none removed.** `en-US.json` and `sv-SE.json` stay key-for-key
identical, and invariant 6 proves it. The FAB keeps `board.addTo` and `overview.add`; the
strip keeps `board.columnChip` and `board.columnChipA11y`.

## 8. Acceptance

Numbered from 24 because 1–19 and 21–23 are already taken by tests in `e2e/`, and invariant
10 matches on the number alone.

24. `[test]` Every rendered element on the six `ROUTES` has computed `padding*`, `margin*`
    and `*Gap` values that are a step in `space` by absolute value, except the named
    Paper internals and values derived from a measured element.
25. `[test]` Every colour painted on the six `ROUTES` is in the active scheme's palette from
    `theme/index.ts`. Runs in light and dark.
26. `[test]` No two painted boxes on the six `ROUTES` have edges on the same axis differing
    by more than 0 and less than `space.xs`.
27. `[eye]` **Withdrawn as a `[test]`.** The 3:1 fill-vs-page floor was measured at 1.31:1
    light and 2.18:1 dark and found to be a threshold this contract invented rather than one
    MD3 imposes; the fill stays as § 9 requires, and claim 33 carries the findability intent.
28. `[test]` `/login`, in an unauthenticated context, is on-scale, on-palette and free of
    near-miss edges.
29. `[test]` A node's `/details`, reached by clicking through from the board, is on-scale,
    on-palette and free of near-miss edges.
30. `[test]` On a home with no nodes, Overview renders the first-run line **and** a FAB that
    is at least `touchTarget`, so the sentence still points at something.
31. `[test]` At 195×422 — a 390px phone at 200% — the FAB spans no more than 60% of the
    viewport width, in `en-US` and in `sv-SE`.
32. `[test]` `e2e/rest-api.spec.ts` tests 13, 18 and 22 pass when the secret dialog fails to
    render: a key minted and never surfaced is still revoked, and two keys can never share a
    name.
33. `[eye]` The FAB still reads as the one primary action on the screen — findable by
    someone who has not opened the app for three weeks, in both schemes.
34. `[eye]` The strip's resting selected chip no longer competes with the card titles, and
    the mid-drag drop marker still reads as a target.
35. `[eye]` Overview reads as three separated sections rather than one block, and a board
    column has not visibly lost cards per screen.

## 9. What this does NOT change

- Every route does what it did: add a card, drag one, drill in, sign in, switch home.
- The FAB names its destination in words, and `fab.spec.ts` claim 8 — the last card in a
  full column clears it — stays green in `sv-SE` at 200%.
- `primaryContainer` remains the FAB's fill in both schemes.
- Overview's first-run line keeps pointing at the FAB rather than growing a second button.
- No Firestore field, query, index, listener or security rule.
- No `t()` key added or removed; both locale files stay identical in key set.
- The mid-drag `primary` drop marker in `ColumnStrip`.
- The agent-written line on a card stays distinguishable by more than `outlineVariant` alone
  — § 3 already forbids that, and this pass may restyle it but not demote it.

## 10. Out of scope

- **The categorical card palette.** Open in DESIGN.md *Decisions*; the axis and the form
  belong to the issue that builds it. § 3 binds until then.
- **A fill-vs-page contrast floor on every raised surface** — board card, snackbar, dialog.
  Claim 27 covers the FAB only, which is the control the § 7 decision puts at risk. Widening
  it is a follow-up, not this pass.
- **`PlaceholderScreen`.** The issue lists it, but its only two call sites are `/locations`
  and `/maintenance` and neither screen has landed, so § 8 is already satisfied. Nothing to
  do — recorded here so nobody re-hunts it.
- **Rule changes decided mid-run beyond § 3, § 5 and § 7.** A finding cites a rule or says
  it is a taste call; any further proposed rule change is collected as one diff for the
  human rather than widened to let the change in front of it pass.

## 11. Phases

```
Phase 1  e2e/rest-api.spec.ts: withApiKey minted inside the try,        GLM
         unique key name per mint. Claim 32. Unrelated to the design
         contract — landed first so the suite is green underneath
         everything after it
Phase 2  the four checks in e2e/craft.spec.ts, against theme/           GLM
         index.ts and tokens.ts. Claims 24-29, plus the /login and
         /details tests. Written BEFORE the app changes, so what
         they find is what phase 3 fixes
Phase 3  the FAB footprint + ColumnStrip's resting chip + the           GLM
         per-route proximity pass. Claims 30, 31, 33-35
Phase 4  docs/DESIGN.md: § 3, § 5 and § 7 amended, Decisions            GLM
         appended with three dated entries
```

**Phase 2 before phase 3 on purpose.** The app authors no off-scale spacing today, so the
checks are what turn "read the app against the contract" from a judgement into a list. A
phase 3 that ran first would be guessing at what to fix.

**Every phase is dispatched to GLM.** Phase 3 is the one whose design is genuinely
unsettled — the FAB footprint mechanism is not decided here, it interacts with the measured
pane inset that has been got wrong before, and it is judged by eye in two locales and two
schemes. That makes it the phase most likely to need a second round, not the phase that needs
a different model: what is unsettled is settled by the `[eye]` claims 33-35 at review, not by
the writer. The kickoff spec routed it to Opus; that was wrong and is corrected here.
