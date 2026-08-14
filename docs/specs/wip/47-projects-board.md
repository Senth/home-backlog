# Projects board

> **Covers issues [#47](https://github.com/Senth/home-backlog/issues/47),
> [#48](https://github.com/Senth/home-backlog/issues/48) and
> [#77](https://github.com/Senth/home-backlog/issues/77).** #48 was pulled in during
> planning: a flat root board with no way to nest what is already on it is the thing
> `PROJECT.md` names as the differentiator, shipped without the differentiator. #77 was
> raised in the same session and settled here because it changes the status vocabulary,
> and the vocabulary is first rendered by this work.

## Handoff

*wip only — the cleanup phase deletes this section.*

This file is the implementation plan. Work **Phases** in order.

Read first: [`CLAUDE.md`](../../../CLAUDE.md), [`docs/PROJECT.md`](../PROJECT.md), and
[`docs/specs/boards-and-nodes.md`](../boards-and-nodes.md) — the node document, its
queries, its rules and its writes all landed in
[#74](https://github.com/Senth/home-backlog/pull/74) and this work is the screens on top
of them. `docs/PERSONAS.md` is worth a read: most of the decisions below came out of a
persona review, and the *Why* lines name the person each one is for.

Nothing durable may live only in **Handoff** or **Phases** — the cleanup phase deletes
both.

Branch `feat/47-projects-board`. One commit per phase, once that phase is green on
`yarn lint --write`, `yarn typecheck` and `yarn test`.

**After the cleanup phase** — and only then:

```bash
GIT_VANILLA=1 gh pr create --fill --body "Closes #47
Closes #48
Closes #77"
GIT_VANILLA=1 gh pr checks --watch
GIT_VANILLA=1 gh pr merge --squash --delete-branch
```

Any check failing means stop, report, and **do not merge**.

Committing, opening the PR and merging are an explicit, user-authorized exception to the
global "never commit without being asked" rule, scoped to this flow and this branch.
Nothing else is committed or pushed without asking, and nothing is ever pushed straight to
`main` — that deploys to production.

## 1. What

The board you land on: root-level cards in columns drawn from the global status enum, a
card that opens as its own board with breadcrumbs back, title-only card creation, and a
card menu that moves, reorders, renames, deletes and re-parents.

## 2. Why

`PROJECT.md` scopes MVP item 1 as "projects board with infinite drill-down and breadcrumb
navigation", and lists nested boards as the first of four differentiators against
HomeQueue. The node document already carries everything this needs; what is missing is
every screen.

**Why #48 is in here.** A household fills a board the day it gets one — the persona review
has Marcus typing forty cards on a Saturday morning. If drill-down lands separately, those
forty cards were typed at the root with no way to become projects, and the first thing the
app asks of its only user is to re-type them. Drill-down alone does not fix it either:
nesting new work does nothing for work already typed. That is why **`Move under…`** is in
scope (§5) even though a full destination picker is not.

**Why `blocked` stops being a status.** A card is in exactly one status, so parking a card
in Blocked destroys the stage it was in, and nothing says where it goes when the blocker
clears. Being blocked is not a stage of work — it is a condition a card at any stage can
be in. `blockedBy[]` already exists on the document and is already the actionability test
the suggestion engine ([#55](https://github.com/Senth/home-backlog/issues/55)) will use,
so the condition has a home that is not `status`. The card stays in its real column and
shows a mark. `status` is a string id precisely so a value change is cheap; there is no
production data, so it is free today and a migration in a year.

*Rejected:* keeping `blocked` in the enum and merely not displaying it. A value nothing
writes and nothing shows is a trap for the REST API
([#7](https://github.com/Senth/home-backlog/issues/7)) and for whoever reads the enum next.

*Rejected:* per-board column configuration now. That is
[#63](https://github.com/Senth/home-backlog/issues/63). What this ships is the field #63
edits, so #63 is a screen and not a schema change.

*Rejected:* drag and drop. Settled in `PROJECT.md` and tracked as
[#5](https://github.com/Senth/home-backlog/issues/5); `rank` already makes it a pure UI
change.

## 3. Data & queries

### The `columns` field

One new field on `homes/{homeId}/nodes/{nodeId}`:

| Field | Type | Default | Notes |
| ----- | ---- | ------- | ----- |
| `columns` | `Status[]` | by depth, see below | the column set of the board formed by this node's **children** |

`boards-and-nodes.md` deferred this deliberately — `columns` is only ever read with the
document it sits on and is never queried, so adding it later needs no backfill and no
index. That is still true, which is why it can arrive now without touching anything
written by #74.

**Chosen by depth at creation, then frozen.** A node's own depth is `ancestorIds.length`:

- depth 0 → `fullColumns` — its children are depth 1, and `PROJECT.md` gives the full
  stage set to the root board and to a board inside a project.
- depth ≥ 1 → `simpleColumns` — `backlog` / `execution` / `done`. A research column whose
  cards each contain their own research column is nonsense.

The **root board is not a document**. It cannot be moved, deleted or reparented, so there
is nothing for a freeze to protect: its set is the `rootColumns` constant in
`models/node.ts`. [#63](https://github.com/Senth/home-backlog/issues/63) is where a stored
root set earns its keep, and it can add one to the home document then.

*Frozen* means the app never recomputes `columns` when a node moves. It does **not** mean
immutable: the rules validate the shape and let the value change, because #63 is exactly
the feature that changes it and locking it now would make #63 a rules change before it
could be a screen.

*Rejected:* deriving columns from depth at render time. It costs no field, and moving a
subtree from depth 1 to depth 2 then silently swaps the full stage set for the simple one
— stranding every card that was in Research or Review in a column that no longer exists.
`PROJECT.md` names that failure as the reason the freeze exists.

### The status enum loses `blocked`

```
backlog  next_up  research  planning  execution  review  done
```

Seven values. `toNode` already coerces an unrecognised status to `backlog`, so a document
carrying the old value renders in To do rather than crashing a board.

### A column that is not in the set still renders

A board shows its frozen columns, in `columns` order. Any status **present in the data but
absent from `columns`** gets an extra column appended after them, in enum order. It
appears only while such a card exists and disappears when the card is moved out; the move
sheet offers only the frozen destinations, so it is a one-way exit.

Without it, `Move under…`, the REST API and a seeded fixture can all put a `research` card
on a simple-set board, and the board would render as though the card were not there. A
card that exists is visible somewhere — the same principle as the orphaned-node failure
the visibility invariant exists to prevent.

### Queries

**No new query shapes, and no new indexes.** Every board at every depth is the pair
already in `data/nodes.ts`, with `parentId` set to the node being drilled into instead of
`null`:

```ts
sharedBoardQuery(homeId, parentId)          // Q1, visibility == 'shared'
participatingBoardQuery(homeId, parentId, uid)  // Q2, participantIds array-contains uid
```

Safe for the reason `boards-and-nodes.md` gives: the read rule is `isMember(homeId) &&
visibleToMe(resource.data)`, `isMember` is resource-independent, and each query constrains
one of `visibleToMe`'s two disjuncts. Merged and deduped by `mergeNodeResults`, then
grouped by `status` client-side. Both listeners are torn down on navigation, so drilling
five levels down never leaves five pairs behind.

**The board's own node** — one single-document listener, `useNode(homeId, nodeId)`. Three
listeners per board rather than two, all constrained, all torn down together. It buys two
things a one-shot read cannot: a rename by another member updates the title on the screen
you are looking at, and a card deleted under you — `deleteNode` takes the whole subtree —
bounces you to the parent board with a message instead of leaving you on a board that no
longer exists. A node that cannot be read, or does not exist, is the same bounce.

**Breadcrumbs** — one `getDoc` per id in `ancestorIds`, issued in parallel, each handled
on its own, memoized by id for the session in `hooks/use-ancestors.ts`. An ancestor that
cannot be read costs one rejected promise and renders as a neutral crumb.

That case is real rather than theoretical: participant inheritance runs **downward** — a
private child holds all of its parent's participants, not the reverse — so being added to
a private subtask does not grant a read on the private project above it.

*Rejected:* `where(documentId(), 'in', ancestorIds)`. One read instead of *n*, and it is
**query-unsafe**: a single unreadable ancestor rejects the whole query and every crumb
disappears at once. Rule-safe but query-unsafe is the exact failure `CLAUDE.md` forbids.

*Rejected:* carrying the trail in router params. Free while navigating in-app, empty on
reload or on a shared link — and reload is on the review's hostile checklist.

**The destination board, when re-parenting.** `reparentNode` takes a rank computed against
the target board's neighbours, and that board is not on screen. `Move under…` therefore
reads it once with the same two queries (`getDocs`, not a listener) and computes
`rankAtEnd` of the column matching the moved card's status. `reparentNode` already
requires a connection and already reads the subtree from the server, so one more server
read changes nothing about when it works.

### Indexes

`columns` is a new array field, so Firestore would index it automatically at roughly
two entries per element. Nothing queries it. It gets a field override with an empty
`indexes` array in `firestore.indexes.json`, for the reason
[`boards-and-nodes.md`](../boards-and-nodes.md#storage-cost-lives-in-the-index-not-the-document)
sets out: storage cost lives in the index, not the document.

No composite index is added — no new query shape exists.

## 4. Rules & tests

`validNode()` in `firestore.rules`:

```
status   in ['backlog','next_up','research','planning','execution','review','done']
columns  is a list, size 1..7, and every entry is one of the same seven
```

`columns` is **required on create**, like every other field. An absent field cannot be
queried and cannot be read from a rule without denying the write — the trap
`boards-and-nodes.md` documents. It is not immutable; see §3.

Nothing else changes. No new rule function, no change to `structure()`, `inherits()`,
`immutable()` or `privacyUnchanged()`, and no change to the read grant.

New cases in `tests/rules/firestore.test.ts`:

| Case | Expect |
| ---- | ------ |
| create with `columns` absent | denied |
| create with `columns: []` | denied |
| create with `columns` holding an unknown value | denied |
| create with `columns: ['backlog']` | allowed |
| create with `status: 'blocked'` | denied |
| update replacing `columns` with another valid set | allowed — #63 must not need a rules change |

## 5. UI flow

One board component, used at every depth. `PROJECT.md`: resist per-level special cases.

### Layout

- **Below `compactBreakpoint` (720)** — a horizontal pager, one column per screen. Above
  it, a scrollable strip of column chips: each names its column and carries its card
  count, the current one is marked, and a tap jumps straight to it. Six of eight panes are
  empty in a small household, and without the strip the board is swiped blind — an empty
  pane is indistinguishable from a broken app. The strip is also the way back after a
  move, and the way to Done without seven swipes.
- **At 720 and above** — columns side by side, the board scrolling horizontally. The
  column headers say what the strip says, so the strip is not rendered.
- A board **always opens on its first column**, rather than restoring the last pane
  anyone swiped to.

### The card

Title, a chevron, and a mark when `blockedBy[]` is non-empty. The chevron is on every card
whether or not it has children: finding out costs a query per card, and listener breadth
is this app's stated cost risk. Due date, priority, effort and notes wait for
[#49](https://github.com/Senth/home-backlog/issues/49).

**Tap opens the card as a board.** That is what tap means at every depth and what it will
still mean when #49 arrives, so the gesture is not learned twice. Everything else is on an
overflow menu on the card.

### Creating a card

Title only. The add control belongs to a **column**, not to the screen: at 720 and above
each column has its own add row; below it, one FAB naming its destination in words — *Add
to To do*. Status comes from that column, and a card typed one-handed in a greenhouse
lands where the button said it would. `createNode` queues offline; the sheet closes
immediately and never waits on the acknowledgement.

### The card menu

| Action | What it does |
| ------ | ------------ |
| Move to → *column* | one tap, appends at the end of that column |
| Change position… | lists the current column's cards: *At the top*, *After ‹card›* |
| Move under… | the other cards on this board, plus *Up one level* / *Top level* |
| Rename | a dialog with the title field |
| Delete | confirm, then the card and everything under it |

**Move** stays on the pane you are on and raises a snackbar naming the destination, with
**Undo**. Undo restores the status *and* the rank the card had, both of which are in hand.
Following the card would drag someone moving six cards in a row seven panes sideways;
saying nothing makes a move read as a delete, because the destination is off-screen.

**Change position** is what makes ordering real. Up / down / top / bottom cannot place a
card at position three of thirty without twenty-seven taps, so the position list picks the
slot directly and `rankBetween` ranks it against its two new neighbours.

**Move under…** lists only siblings with the **same `visibility`** — a shared card under a
private parent breaks the uniform-visibility invariant and the rules refuse it — and never
the card itself. It reads the destination board once for a rank (§3), then calls
`reparentNode`.

**Delete** warns that everything under the card goes too, in as many words, and is styled
as the destructive action the way `ConfirmDialog` already does elsewhere.

### Breadcrumbs

Above the board: *Projects › Bathroom › Tiling*, the last crumb being the current board,
each earlier one tappable. An unreadable ancestor renders as a neutral crumb rather than a
gap. Navigation is a Stack inside the Projects tab — `/projects` and `/projects/[nodeId]`
— so the tab bar stays put at every depth, and browser back, the PWA back gesture, reload
and a shared link all work.

### Offline

The established pattern from [`home-and-members`](../home-and-members.md), unchanged:

- **Queue optimistically** — create, rename, move, change position. Firestore's default,
  and what a board in a shed needs.
- **Require a connection** — `Move under…` and `Delete`. Both read from the server on
  purpose: "no children in the cache" is not "no children". Both are disabled offline with
  a hint rather than failing after the tap.

### Overwhelm

The column strip with counts, a board that opens on its first column, a one-field add, and
a card face that carries a title rather than five metadata chips. Done grows without bound
until [#64](https://github.com/Senth/home-backlog/issues/64) archives it and
[#76](https://github.com/Senth/home-backlog/issues/76) sorts it newest-first — both
deliberately out.

## 6. Strings

Every one goes through `t()`, in `en-US.json` and `sv-SE.json` in the same change. The
status labels are plain-language on purpose: `PERSONAS.md` has Ingrid quitting over
transliterated stage names, and Priya reading "Execution / Review" as the work Jira she
opened this app to get away from. Swedish uses verbs where a verb is what a household
says.

| Key | `en-US` | `sv-SE` |
| --- | ------- | ------- |
| `status.backlog` | To do | Att göra |
| `status.next_up` | Next up | Härnäst |
| `status.research` | Find out | Undersök |
| `status.planning` | Plan | Planera |
| `status.execution` | In progress | Pågående |
| `status.review` | Check | Granska |
| `status.done` | Done | Klart |

The deep-board simple set therefore reads *To do · In progress · Done* / *Att göra ·
Pågående · Klart* with no per-board relabel — which is why those three statuses were
chosen for it.

| Key | `en-US` | `sv-SE` |
| --- | ------- | ------- |
| `board.root` | Projects | Projekt |
| `board.empty` | Nothing here yet. Add the first card. | Inget här ännu. Lägg till första kortet. |
| `board.columnEmpty` | Nothing here | Inget här |
| `board.addTo` | Add to {{column}} | Lägg till i {{column}} |
| `board.newCard` | New card | Nytt kort |
| `board.titleLabel` | Title | Titel |
| `board.add` | Add | Lägg till |
| `board.titleRequired` | A card needs a title | Kortet behöver en titel |
| `board.titleTooLong` | That title is too long | Titeln är för lång |
| `board.open` | Open as board | Öppna som tavla |
| `board.actions` | Card actions | Kortåtgärder |
| `board.blocked` | Waiting | Väntar |
| `board.moveTo` | Move to | Flytta till |
| `board.moved` | Moved to {{column}} | Flyttad till {{column}} |
| `board.changePosition` | Change position… | Ändra placering… |
| `board.positionTop` | At the top | Överst |
| `board.positionAfter` | After {{title}} | Efter {{title}} |
| `board.moveUnder` | Move under… | Flytta in under… |
| `board.moveUnderUp` | Up one level | En nivå upp |
| `board.moveUnderTop` | Top level | Toppnivån |
| `board.movedUnder` | Moved under {{title}} | Flyttad in under {{title}} |
| `board.rename` | Rename | Byt namn |
| `board.renameTitle` | Rename card | Byt namn på kortet |
| `board.delete` | Delete | Ta bort |
| `board.deleteTitle` | Delete this card? | Ta bort kortet? |
| `board.deleteBody` | The card and everything under it is deleted. This cannot be undone. | Kortet och allt som ligger under det tas bort. Det går inte att ångra. |
| `board.offlineHint` | Needs a connection | Kräver anslutning |
| `board.gone` | That card is gone. | Kortet finns inte längre. |
| `board.crumbHidden` | Hidden | Dolt |
| `board.trail` | Where you are | Var du är |
| `common.undo` | Undo | Ångra |

`screen.projects.empty` is deleted from both files — the placeholder screen it belonged to
is gone.

## 7. What this does NOT change

- **The node document**, apart from adding `columns`. No field is renamed, retyped or
  removed, and `status` keeps its type.
- **The board queries and their indexes.** Same two queries, one new `parentId` value.
- **The read rule**, the visibility invariant, participant inheritance, `structure()`,
  `inherits()` or the batched-write split. Reparent and delete are the functions #74
  shipped, called from a menu.
- **Locations, recurring maintenance, auth, homes, the service worker.** Untouched.
- **`rank` semantics** — still fractional, still ordered within `(parentId, status)`,
  still tie-broken on id.

## 8. Out of scope

- **Node detail** — [#49](https://github.com/Senth/home-backlog/issues/49). Notes, due
  date, priority and effort are on the document and on no screen. Rename is here only
  because a card with no way to fix a typo is a permanent mistake.
- **Editing `blockedBy[]`** — [#66](https://github.com/Senth/home-backlog/issues/66). The
  mark renders; nothing in the UI can set the field yet, so it arrives from the REST API
  or a fixture until #66.
- **Per-board column configuration and relabels** —
  [#63](https://github.com/Senth/home-backlog/issues/63). This ships the field it edits.
- **Archive** — [#64](https://github.com/Senth/home-backlog/issues/64). Done grows without
  bound. **Done newest-first** — [#76](https://github.com/Senth/home-backlog/issues/76).
- **One-tap done on the card row** —
  [#75](https://github.com/Senth/home-backlog/issues/75).
- **Participants and private cards on screen** —
  [#61](https://github.com/Senth/home-backlog/issues/61); **filters** —
  [#62](https://github.com/Senth/home-backlog/issues/62). Until then a board says nothing
  about whose card is whose, and a private card can only be created by the REST API.
- **Drag and drop** — [#5](https://github.com/Senth/home-backlog/issues/5).
- **A full destination picker** for `Move under…` — browsing the whole tree is a second
  navigation surface with its own query-safety story.
- **Custom statuses** — [#69](https://github.com/Senth/home-backlog/issues/69).
- **Desktop beyond side-by-side columns** —
  [#31](https://github.com/Senth/home-backlog/issues/31).

## 9. Phases

*wip only — the cleanup phase deletes this section.*

Each phase ends green on `yarn lint --write`, `yarn typecheck` and `yarn test`, and is one
commit. `yarn test:rules` for any phase touching `firestore.rules`.

**Phase 1 — model, rules, indexes**

`models/node.ts`: add `columns` to `Node` and `NodeData`; add `fullColumns`,
`simpleColumns`, `rootColumns`, `columnsForDepth(depth)` and `visibleColumns(columns,
nodes)` (the frozen set plus any extra status present in the data, in enum order);
`newNodeData` writes `columns` from the new node's own depth; `toNode` reads it with the
depth default as fallback. `firestore.indexes.json`: the `columns` exemption.
`tests/rules/firestore.test.ts`: the six cases in §4. `models/node.test.ts`: the column
helpers and `newNodeData`.

**`blocked` is removed in this same commit, in all four places at once.** They are the
enum in code, the enum in the rules, and the two documents that state it — and a commit
that moves some of them is a commit where `yarn test:rules` and the written spec disagree
about what a valid status is:

| File | What |
| ---- | ---- |
| `models/node.ts:52,62` | `Status` union and the `statuses` array |
| `firestore.rules:201` | the `validNode()` status enum |
| `docs/PROJECT.md:70` | §Statuses & columns lists all eight values |
| `docs/specs/boards-and-nodes.md:38` | the `status` row of the field table |

`PROJECT.md` is a settled-decisions document, so its edit is not a deletion: §Statuses &
columns keeps seven values and gains a line saying blocked is a *condition* carried by
`blockedBy[]`, not a stage — the reasoning in §2 above, in one sentence, with a link to
[#66](https://github.com/Senth/home-backlog/issues/66). `boards-and-nodes.md` is rewritten
wholesale by phase 8 anyway; the row is corrected here so the repo is never self-
contradictory in between.

Line numbers are from `main` at planning time — grep for `blocked`, excluding `blockedBy`,
rather than trusting them.

**Phase 2 — data and hooks**
`data/nodes.ts`: a single-node document reference for the listener, an ancestor `getDoc`
helper, and the one-shot destination-board read used to rank a re-parent.
`hooks/use-node.ts` (one document, with not-found and permission-denied as the same
"gone" answer) and `hooks/use-ancestors.ts` (parallel, per-id failure, session memo).

**Phase 3 — the board, and creating a card**
`components/board/`: the board, a column, a card, the column strip. Pager below 720,
side-by-side above. Per-column add control and the FAB that names its destination.
`app/(app)/(tabs)/projects.tsx` becomes `projects/index.tsx` rendering the root board and
the placeholder screen goes. Status strings in both locales.

**Phase 4 — drill-down and breadcrumbs**
`projects/_layout.tsx` (Stack) and `projects/[nodeId].tsx`, both rendering the same board.
Breadcrumbs, the app-bar title from the node listener, and the bounce to the parent when
the node is gone.

**Phase 5 — moving a card**
The overflow menu; *Move to → column* with the snackbar and Undo; *Change position…*.

**Phase 6 — rename, delete, move under**
The remaining menu items, the confirm dialog, and the two offline-disabled actions with
their hint.

**Phase 7 — review**
`/review` until PASS. `code-review` first, its fixes applied and green, then
`browser-review` against the clean change, then the fix loop, capped at two rounds.
`blocking` findings are never deferrable; a `should-fix` may be deferred only with a
stated reason. The session that wrote the code does not sign it off.

**Phase 8 — cleanup, then the PR**

- Fold this file into [`docs/specs/boards-and-nodes.md`](../boards-and-nodes.md) — the
  same area, the same document, and its *Out of scope* section currently promises "every
  screen" to #47/#48. **Rewrite, do not append**: the field table gains `columns`, the
  status list loses `blocked`, the query section gains the breadcrumb reads and the node
  listener, and a section on the board itself replaces the promise. Keep every *why* and
  every rejected alternative from this file that is still true.
- Delete `docs/specs/wip/47-projects-board.md`.
- Update the `boards-and-nodes` row in [`docs/specs/INDEX.md`](../INDEX.md).
- **Refresh `.emulator-seed/`** — this is the first feature that puts nodes in it, and
  every future review needs a board with cards at more than one depth to look at. Create
  them through the app, then `yarn emulators:export`. Never hand-written.
- `yarn todo`.
- Then the PR, per **Handoff**.
