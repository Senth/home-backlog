# Drag and drop on boards

Issue [#5](https://github.com/Senth/home-backlog/issues/5). Temporary — the cleanup phase
folds this into [`../boards-and-nodes.md`](../boards-and-nodes.md) and deletes the file.

## Handoff

**This file is the implementation plan. Work [Phases](#phases) in order.**

Read [`CLAUDE.md`](../../../CLAUDE.md), [`docs/PROJECT.md`](../../PROJECT.md) and
[`docs/specs/boards-and-nodes.md`](../boards-and-nodes.md) first — especially that spec's
*The board*, *The card*, *The card menu*, *Rank*, *Reducing overwhelm* and *Paper and React
Native Web traps this area hit*. Everything here lives inside decisions those files already
took, and this feature re-opens none of them.

Nothing durable may live only in **Handoff** or **Phases**; the cleanup phase deletes both.

The branch **`feat/5-drag-and-drop`** already exists, cut from `origin/main`. One commit per
phase, once that phase is green on `yarn lint --write`, `yarn invariants`, `yarn typecheck`
and `yarn test`.

After the cleanup phase — and only then:

```bash
GIT_VANILLA=1 gh pr create --fill --body "Closes #5"
GIT_VANILLA=1 gh pr checks --watch
GIT_VANILLA=1 gh pr merge --squash --delete-branch
```

Any check failing means stop, report, and **do not merge**.

Committing, opening the PR and merging are an explicit, user-authorized exception to the
global "never commit without being asked" rule. The exception is scoped to this flow and to
this branch. Nothing else is committed or pushed without asking, and nothing is ever pushed
straight to `main` — that deploys to production.

## 1. What

A card on a board can be picked up and dropped: within a column to reorder it, or onto
another column to change its status. It is an added gesture on top of the card menu, which
is unchanged and remains the complete, accessible, offline-proof path to everything a drag
can do.

## 2. Why

The board is where a household's work gets sorted, and sorting it through a menu costs two
dialogs per card. Marcus fills a board flat on a Saturday morning and then reorganises it;
eleven cards typed the night before is eleven trips through *Change position…*, and that
number only grows on a real renovation board. A drag turns that minute of work into a
minute of work instead of ten.

It is affordable now, and it was designed to be. `rank` has been a **fractional index**
since the node shipped, precisely so that drag and drop would be a pure UI change with no
data migration ([`../boards-and-nodes.md` § Rank](../boards-and-nodes.md#rank)). That bet
pays off here: this feature changes no document, no rule, no query and no listener.

### The gesture had to be built around the person it endangers

`PERSONAS.md` has Ingrid, 71, at 200% text with one thumb, doing the most scrolling in the
app. Her scroll is *press → hesitate → move*, and her deliberate tap is long. A 200ms
long-press-anywhere reads both of those as a drag, so ordinary scrolling would move cards
she never touched, and she would have no name for what happened. That is her stated quit
line. Everything in [§5](#5-ui-flow) that looks like over-caution — the 500ms still-finger
hold, the movement threshold that turns an arming hold back into a scroll, the Undo on
every drop that changes anything — is there because the gesture is otherwise a trap for the
person with the least ability to get out of it.

*Rejected:* a drag handle on the card. It removes the gesture collision completely and a
keyboard could reach it — but it puts a third target on a 48dp card row that already
carries a tap and an overflow button, and the card face spec refuses exactly that kind of
addition. Priya's twenty-minutes-before-the-kids-wake board does not need a control she
will never use taking width from the title.

*Rejected:* 200ms with only a movement threshold added. The pause is what misfires, not the
movement — a still finger resting before a deliberate scroll is precisely Ingrid's and
Tom's gesture, and a threshold does not see it.

*Rejected:* the same hold on pointer and touch. A mouse that waits half a second before a
card moves reads as lag, on the 720+ board where the heaviest reordering happens. Marcus
left heavyweight tools to get away from that feeling.

### Nesting stays out, and the drag must not pretend otherwise

Dropping a card onto a card to nest it is **not** part of this. `reparentNode` requires a
connection, reads a subtree from the server, and has no Undo
([#79](https://github.com/Senth/home-backlog/issues/79)) — so one gesture would be
sometimes-offline-capable and sometimes not, which is worse than a gesture that does one
thing. `Move under…` stays the only way to nest.

The consequence is designed for rather than ignored: there is **no drop-onto-card target at
all**. The gesture only ever resolves to a position between cards, and nothing in the drag
ever highlights, scales or outlines a card in a way that suggests it could receive another
one. An affordance that does nothing is worse than no affordance.

*Rejected:* a one-time hint pointing at `Move under…` when somebody releases a card squarely
over another. Nesting really is the app's differentiator and a drag-first reflex really can
hide it — but this app has no onboarding, no coach marks and no "you have seen this" flag,
and the first one should not be introduced by a message that fires on a gesture the person
may have meant exactly as it landed. Discoverability of nesting is the board's problem, not
the drag's.

### Two ways across columns on a phone, because one is not enough

Below `compactBreakpoint` only one column is on screen. Both paths exist and they are not
redundant:

- **Dropping on a chip in the column strip** is the primary one. The strip is already how
  you change column, so the gesture agrees with a mental model the board has taught since
  it shipped — and it never moves the pane, so a bulk sort of six cards out of To do costs
  no navigation at all.
- **Holding the card at the screen edge** switches the visible pane, for the case where the
  destination position matters and not just the destination column. A chip drop can only
  append.

*Rejected:* edge-hold as the only path. A thumb naturally rests near the right edge of a
390px screen — that *is* the edge zone — so Nadia aiming at a gap one-handed would walk her
card through three columns without meaning to.

*Rejected:* chips as the only path. It works, and it is the safest thing here, but it makes
the phone the one place a card cannot be put where you want it, which is most of the app's
use.

### The pane is wherever the drag left it

The board's existing rule is that **the pane on screen is state, set only by deliberate
input, and never read back from a scroll position** — the swipeable pager was removed
because the browser re-snapped it on content change and on focus, so twelve cards added
from a FAB reading *Add to To do* landed in In progress and Next up, alternately.

A drag does not weaken that rule: an edge-hold sets the same state the same way a chip tap
does. So after an edge-hold drop the board simply stays where the drag walked it, and after
a chip drop it never moved.

*Rejected:* returning to the origin column after every drop, to match the card menu's
*Move*, which deliberately does not follow the card. It sounded like the consistent answer
and it is the wrong one: the menu has no way to stay put *and* place a card precisely, so
its rule is a compromise, while the drag has two paths and the chip drop already is the
stay-put one. Yanking someone back after they deliberately walked three panes across reads
as the move being undone.

## 3. Data & queries

**Nothing changes.** No new field, no new index, no new query, no new listener, no change
to `data/nodes.ts`.

A drop is exactly the write `Move to → column` already makes:

```ts
moveNode(homeId, node, status, rank)
```

which sets `status` and `rank` together in one write, owns `completedAt` in both
directions, and keeps the parent's `doneCount` in step. It queues optimistically, which is
what a board in a shed needs. A within-column reorder is the same call with the status
unchanged, exactly as *Change position…* already does.

### Query safety

Unaffected, and worth stating so the next person does not go looking. A board is still the
same two listeners merged client-side — `visibility == 'shared'` and `participantIds
array-contains me` — and a drag reads nothing. The one-shot server reads in this area
belong to `Move under…` and `Delete`, and the drag calls neither.

### The one piece of new logic, and where it lives

`models/drag.ts` — pure, no Firestore, sibling-tested, the same shape as `flipPlan` and
`childArrives` already in `models/node.ts`:

```ts
dropPlan({ column, dragged, toStatus, toIndex }): DropPlan | null
```

`column` is the destination column's **visible** cards in `(rank, id)` order, including the
dragged card when the status is unchanged. It returns `{ status, rank, direction }` where
`direction` is `'up' | 'down' | 'across'`, or **`null` when the drop changes nothing** — a
card released where it started writes nothing and says nothing, mirroring *Change position…*
disabling the slot a card already occupies. A snackbar for a move that did not happen
teaches Ingrid that the screen lies.

The rank comes from `rankBetween(above, below)` in `models/node.ts` over the neighbours the
dragged card is landing between, with the card itself removed from the list first — a card
must never be ranked against where it currently is.

**A drop ranks against the cards you can see.** Where a column is hiding somebody's
personal projects, those cards keep their own ranks wherever they fall, and the hidden-card
text line at the bottom of a column is never a drop target. What you saw is what you get.

*Rejected:* ranking against the unfiltered list. It keeps the order stable whether or not
*Show everyone's projects* is on — at the price of a card landing visibly in one place and
actually being in another, which is the kind of lie the board spec refuses everywhere else.

*Rejected:* a special case making a drop into Done always append at the end. Nobody wants a
chosen position inside Done and the column grows without bound until
[#64](https://github.com/Senth/home-backlog/issues/64) archives it and
[#76](https://github.com/Senth/home-backlog/issues/76) sorts it newest-first — but
`PROJECT.md`'s *resist per-level special cases, they multiply* applies to columns as much
as to depths, and a chip drop already appends for anyone who does not care where it lands.
Done's length is #64's problem.

## 4. Rules & tests

**`firestore.rules` and `storage.rules` are untouched**, so `tests/rules/` is untouched.
This is deliberate and not an oversight: a drag makes the `status` + `rank` update the rules
already permit and already test, from a different gesture. There is no new write, no new
read and no new permission.

New unit tests:

- **`models/drag.test.ts`** — required by `yarn invariants` check 8, which demands a sibling
  test for every module in `models/` and `utils/`. Cases: insertion at the top, the bottom
  and the middle of a column; the dragged card excluded from its own neighbours; a
  cross-column drop taking the destination column's neighbours; the no-op drop returning
  `null` in both the same-index and the same-status-same-neighbours forms; a drop into an
  empty column; a column whose visible list is shorter than the stored one because the
  default-hide filter is on; and `direction` on each of the three outcomes.

No component render tests. `CLAUDE.md` forbids tests that only assert layout — the drag is
verified in a browser by `browser-review`, in a session that did not write it.

## 5. UI flow

### Arming the drag

- **Touch** — a press that stays still for **500ms** arms the drag; the card lifts. Any
  movement past a small slop threshold *before* the hold completes is a scroll, and can
  never become a drag afterwards. Releasing before 500ms is the tap the card already had.
- **Pointer** — no hold at all. The drag arms on a few pixels of movement with a button
  down, so the 720+ board never feels like it is waiting.

Both are one `Pan` gesture from `react-native-gesture-handler`, configured differently per
input rather than two implementations.

### While a card is held

- The card lifts to `elevation.high` and follows the finger at a slight scale.
- The other cards **part to leave a card-height gap** at the landing spot. The gap is the
  indicator: nothing extra is drawn under the hand, which matters when Ingrid's card is
  three lines tall at 200% text and her thumb covers most of the pane.
- **Every column keeps a minimum droppable height with a named landing area** — *Drop here
  in Next up*. Two of four columns are empty in a small household and an empty column is
  otherwise one line of grey text, which is nothing to aim at; below the breakpoint an
  empty pane gives no clue a drop is allowed at all.
- **The rendered order freezes** for the duration of the drag. A board is two live
  listeners, and Nadia adding a card from the garden or Kasper's agent bulk-creating twenty
  into To do would otherwise move the gap out from under the finger — a bug nobody can
  reproduce or describe. Arrivals apply the instant the card lands.

*Rejected:* an insertion line between cards. Cheaper, and nothing reflows during the drag —
but a hairline is exactly what disappears under a thumb and at 200% text, which is the
person this has to work for.

### Crossing columns

- **At 720 and above** the columns are side by side; a card is dragged straight into one.
- **Below 720**, dropping the card on a **chip in the column strip** moves it to that
  column, appended at the end. The chip under the finger is marked while the card is over
  it. The pane does not change.
- **Below 720**, holding the card in the narrow zone at the left or right screen edge
  switches the visible pane, one column per dwell, with a **visible fill** so the switch is
  never a surprise. The first switch takes **750ms**; each repeat while the finger stays in
  the zone takes **1250ms**, the fill restarting visibly. The first switch is deliberate —
  you moved there on purpose — and the repeats are the dangerous ones, so they get the
  longer window to escape.

### When the card lands

- A drop that changes nothing **writes nothing and says nothing**. The card settles back.
- Every drop that changes something raises **one snackbar with Undo**, restoring both
  `status` and `rank` — both are in hand, exactly as the card menu's *Move* already does.
  Across columns it reuses `board.moved` (*Moved to In progress*); within a column it says
  which way the card went.
- Twelve drags in a row raise **one snackbar, replaced and never stacked**, its Undo
  applying to the most recent drop.
- If the held card was **deleted under you**, the drop writes nothing and says so, reusing
  `board.gone`.

### Offline

A drag queues, like the *Move* and *Change position…* it shares a write with. Nothing here
needs a connection, and nothing is disabled offline.

### Accessibility

**A drag is never the only path to any board change**, and that is the rule to keep rather
than a limitation to apologise for. Keyboard and screen-reader users get no drag — they get
`Move to`, `Change position…` and `Move under…`, which between them do everything a drag
does and more. The result of a drop is announced through the same snackbar every other move
already uses, so VoiceOver hears it.

The card's own semantics do not change: it stays a `Card` with its tap and its
`accessibilityHint`, and the drag adds no `aria-*` state a reader would announce on every
card.

### Overwhelm, and the card face

The card face gains **nothing**. No handle, no grip dots, no drag affordance of any kind —
the gesture is invisible until it is used. This is the same rule the face already follows:
a card carries a title and at most what is genuinely set.

### Tokens

No numeric literal reaches a style prop. The lift scale, the drop-placeholder minimum
height and the edge-zone width are added to `theme/tokens.ts`; the gesture's timings and
slop live as named constants in `models/drag.ts`, which is not layout.

## 6. Strings

Every one through `t()`, added to `i18n/locales/en-US.json` **and** `sv-SE.json` in the same
change. Register check: no *drag*, *drop zone*, *rank* or *reorder* — that is the Jira
vocabulary both `PERSONAS.md` and the existing status labels deliberately avoid.

| Key | `en-US` | `sv-SE` |
| --- | ------- | ------- |
| `board.dropHere` | Drop here in {{column}} | Släpp här i {{column}} |
| `board.movedUp` | Moved up | Flyttad uppåt |
| `board.movedDown` | Moved down | Flyttad nedåt |

Reused unchanged: `board.moved` (*Moved to {{column}}* / *Flyttad till {{column}}*),
`board.gone` (*That card is gone.* / *Kortet finns inte längre.*), `common.undo`
(*Undo* / *Ångra*), and the `status.*` column labels the strip and the landing areas name.

## 7. What this does NOT change

- **The document.** No field, no type, no index. `rank` was built for this.
- **`firestore.rules`, `storage.rules`, `tests/rules/`.**
- **`data/nodes.ts`.** `moveNode` is called as it already is.
- **The queries and the listeners.** Still two per board, still merged client-side.
- **The card menu.** Every item stays, including *Move to → column* and *Change position…*,
  which are the accessible path and the one that works without the gesture.
- **The card face.** Nothing is added to it.
- **The pane rule.** The pane is still state set only by deliberate input, and still never
  read back from a scroll position.
- **The column set.** Frozen by depth, as before; a drag offers no column the board does not
  already show.

## 8. Out of scope

- **Nesting by dropping a card onto a card.** `Move under…` stays the only way to nest —
  see [§2](#2-why). Its missing Undo is
  [#79](https://github.com/Senth/home-backlog/issues/79).
- **Cancelling a lifted card by dropping it outside the board** —
  [#129](https://github.com/Senth/home-backlog/issues/129). The Undo on every drop covers
  the recoverable case; #129 is for the person who would rather not have committed at all.
- **Selecting several cards and moving them at once** —
  [#130](https://github.com/Senth/home-backlog/issues/130), by drag *and* from the card
  menu. Not before single-card drag has been lived with; a multi-select gesture layered on
  a drag nobody has used yet is a guess. That issue is where `rankSequence` finally gets a
  caller in the UI.
- **Swiping between columns** — [#78](https://github.com/Senth/home-backlog/issues/78), and
  still rejected here for the reason it was rejected before: a scroll-snapping container is
  moved by the browser, not only by the app.
- **Archiving Done, and sorting it newest-first** —
  [#64](https://github.com/Senth/home-backlog/issues/64) and
  [#76](https://github.com/Senth/home-backlog/issues/76). A long Done column makes a precise
  drop a hunt; that is those issues' problem, not a special case in this one.
- **Reordering steps by drag on the detail screen.** The board does that, as
  `../boards-and-nodes.md` already says.
- **A keyboard drag.** The menu is the keyboard path, by design.

## Phases

Each ends green on `yarn lint --write`, `yarn invariants`, `yarn typecheck` and
`yarn test`, and is one commit.

**Phase 1 — the drop model and the gesture root.**
`models/drag.ts` with `dropPlan` and `models/drag.test.ts` covering the cases in
[§4](#4-rules--tests). Wire `GestureHandlerRootView` at the root layout — it is in
`package.json` today but nothing in the tree renders it. Add the tokens from
[§5](#5-ui-flow). No UI behaviour yet.

**Phase 2 — reorder within a column.**
The Pan gesture with its two activation configs, the lift, the parting gap, the frozen
render order, the drop calling `moveNode`, the no-op drop staying silent, and the snackbar
with Undo. Strings in both locales. Works at every width, on the column you are looking at.

**Phase 3 — across columns on a wide board.**
Dragging into an adjacent column at 720 and above, the named landing area, and empty
columns opening up to receive a card.

**Phase 4 — across columns on a phone.**
Chips in `ColumnStrip` as drop targets, then the edge-hold with its dwell fill and its
750ms / 1250ms timings.

**Phase 5 — review.**
`/review` until PASS. `code-review` first — diff and the `CLAUDE.md` invariants — its fixes
applied and green, *then* `browser-review` against the clean change, then the fix loop,
capped at two rounds and re-run scoped. `blocking` findings are never deferrable; a
`should-fix` may be deferred only with a stated reason; `idea` findings go to the user, who
decides which become issues. The session that wrote the code does not sign it off.

**Phase 6 — cleanup, then ship.**
Fold this file into [`../boards-and-nodes.md`](../boards-and-nodes.md) by **rewriting** its
affected sections — *The board*, *The card menu*, *Rank*, *Reducing overwhelm*, *Out of
scope* — so it reads as one description of the app and not as a stack of feature chapters.
Keep the *why* and every rejected alternative above. Delete this file; git history keeps it.
Update the `boards-and-nodes` row in [`../INDEX.md`](../INDEX.md). Refresh
`.emulator-seed/` only if this feature adds data worth reviewing against — it adds none, so
say so rather than regenerating for nothing. Then commit, PR and merge per
[Handoff](#handoff).
