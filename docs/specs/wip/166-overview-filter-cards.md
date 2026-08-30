# Handoff

- This file is the implementation plan; `/continue-work` works the **Phases** in order,
  reviews, and ships.
- Read `CLAUDE.md`, `docs/DESIGN.md`, and [`docs/specs/overview.md`](../overview.md)
  (the area this rewrites) plus [`boards-and-nodes.md`](../boards-and-nodes.md) for the
  node model, first. At `/ship`, `overview.md` is **rewritten, not appended to**: the
  three-fixed-sections framing, the repetition rule, the query section and Strings all
  change, and `PROJECT.md` roadmap item 1 and the Effort section lose their fixed-section
  wording. This feature supersedes #56 (both its behaviours are seeded cards here) and
  takes the presentation question off #55, which stays open rescoped to a sort option.
- Nothing durable may live only in **Handoff**, **Surface brief**, **Acceptance** or
  **Phases**. `/ship` deletes all four.
- The run stops at a draft PR. The merge is the user's.

## 1. What

Overview's three fixed sections become an ordered list of user-owned **filter cards**
over one shared client-side pool of the home's open nodes, in three scopes (global,
one home, shared with the home), with an editor, seeds, and export/import.

## 2. Why

The end goal is a dashboard someone composes the way Home Assistant lets you compose
one. Fixed sections answer three questions forever; a household's questions change with
the season, the project and the person. Cards make the answers editable data.

- **Conditions AND together, no OR, no nesting.** All seeds are expressible that way,
  and the day a real filter needs OR is the day to design one. The vocabulary is driven
  by the model, not the roadmap: every comparable field on `Node` is offerable,
  including ones whose editing UI has not shipped (`blockedBy`, `locationId`).
- **Server-side narrowing is not on the table.** *Needs splitting* is
  `effort >= weekend` and not a root and no children, sorted by priority, and Firestore
  requires inequality fields to lead the sort; every distinct filter shape would want
  its own entry in `firestore.indexes.json`, which a person editing a filter in the UI
  cannot deploy; and `effort` / `priority` / `childCount` are excluded from indexing by
  field overrides today. So Overview opens one query pair for the whole open set and
  each card is a pure `.filter().sort().slice()` over it, testable exactly the way
  `ongoingProjects()` is. **This bends CLAUDE.md's "never subscribe to a whole
  collection" knowingly**: the pool has no `limit`. PROJECT.md's scale check puts a
  household's open work in the hundreds against a 1 GiB / 50k-reads-a-day free tier,
  and if a home's open set ever grows past that, the answer is SQL, not rewriting the
  queries.
- **Three scopes, not the issue's two.** Cards live in per-user docs (global, and one
  per home), and a third kind is **shared with the home**. Per-user remains the default
  and the protection — nobody can arrange your screen, so the chore-list pushed at
  Nadia cannot exist — but a two-person household where only one curates would leave
  the other on the seven seeds forever. Shared cards make co-curation possible, and
  the per-member **hide** is what keeps them from becoming the chore-wall: anyone can
  hide any shared card from their own screen without touching it for the others.
  Rejected: share-by-copying only (no live card), because the household's shared
  questions ("what's unassigned", "what's blocked") are the same for everyone and
  re-creating them per member is make-work.
- **Export/import.** A card exports to a text string; importing creates the card as
  the importer's own, in the importer's chosen scope. This is how Marcus's
  "assigned to Marcus" card becomes Nadia's "assigned to Nadia" card: she imports, then
  swaps the assignee in the editor. Member references travel inside the string; one
  imported into a home where that member does not exist simply matches nothing until
  edited. Rejected: a member-swap wizard at import time — the editor is where member
  conditions are edited anyway.
- **No screen-wide row cap.** `overviewLimit` stops being a screen constant and becomes
  the per-card `max`; the screen's row ceiling is whatever the cards add up to (the
  seeds alone are 31 collapsed rows against the 15 the old spec reasoned from). A
  global cap makes a card's contents depend on what sits above it, so reordering
  silently changes cards and one can empty out for a reason nothing on screen explains.
  Overwhelm is managed by card defaults and by hiding, not by a screen rule.
- **Empty cards keep their heading** and show one sentence, decided **per card**: the
  shipped rule that *Recently done* is absent when empty stays (it is a seed setting),
  *Needs splitting* says the good-news sentence, *Quick wins* nudges estimating without
  guilt, and every user or imported card gets one generic sentence. A card you
  configured that vanishes reads as broken config, and an empty card is for several
  seeds the good outcome.
- **The Coming up / Ongoing projects overlap is accepted.** The issue promised seeds
  "non-overlapping by construction", but the AND-only language cannot say
  "not (a root and in execution)" — that needs an OR — and excluding all roots from
  Coming up would hide the dated backlog project whose only date sits on the root,
  which is how "before winter" gets recorded. Decision from the grill: no exclusion.
  Ongoing projects stays roots-only; a duplicate appears only when a due date sits on
  a root, and the discipline the app already teaches is that dates belong on the thing
  you do. The same seam exists between Coming up and the effort cards for tasks due
  within the window: the new **not late** state removes the late repeats, which are the
  ones that read as guilt.
- **Seeding writes once, on first read of a missing global config**, into the
  cross-home doc, with a marker saying it ran — never a diff against a hardcoded list,
  so a deleted seed does not come back.
- **Sort**: any orderable field, ascending or descending; `null` means board order
  (`(rank, id)`, which for roots is the order the household chose on the root board).
  A `null` priority or effort sorts last regardless of direction — "unknown" is not
  "lowest". Ties break on `(rank, id)`.
- **The four effort cards partition the effort scale** — `quick` / `hours`–`evening` /
  `weekend`+ / unset — so every task lands in exactly one card. The cost is an upper
  bound on *A few hours* nobody asked for; the defence is that a weekend job is not a
  win you knock out, it is one you split, which is what the next card says.

## 3. Data & queries

### The card

```ts
interface Card {
  id: string;
  kind: "filter" | "completed";   // "completed" only for the Recently done seed
  seedId: string | null;          // set on seeds; restore re-creates from it
  title: string | null;           // null on an untouched seed -> i18n by seedId
  conditions: Condition[];        // AND together; "completed" cards have none
  sort: { field: SortField; direction: "asc" | "desc" } | null;  // null = board order
  shown: number;                  // rows collapsed
  max: number;                    // rows held behind "+N more"
  empty: { mode: "hide" } | { mode: "say"; key: string };
  rank: string;                   // fractional, same helpers as models/node.ts
}
```

`scope` is **where the card is stored**, not a field. The stored shape is final from
phase 2, before anything can edit it.

### Condition vocabulary (model-driven; the engine reads `models/node.ts`)

| Condition | Values |
| --- | --- |
| `status` | any-of `backlog` / `next_up` / `execution` (multi-select chips) |
| `priority` | any-of the enum, plus *not set* |
| `effort` | any-of the enum, plus *not set* |
| `dueDate` | one of: **coming up** (late or within N days, N editable, default `soonInDays`), **late**, **not late** (has a date, today or later), **none** |
| is a root | `parentId == null` |
| has children | `childCount > 0` |
| `assigneeIds` | me / unassigned / any-of members |
| `participantIds` | me / any-of members |
| `blockedBy` | any / none |
| `visibility` | shared / private |
| `createdVia` | app / api |
| has notes / photos / checklist | booleans |

`labels` is not in the vocabulary until #100 adds the field, and the editor does not
offer it. The editor **does** offer `blockedBy` and `locationId`: both fields exist on
`Node` today and their editing UIs (#66, #51) ship around the same time, so a card
built on them is dead only briefly. Sortable fields: `dueDate`, `priority`, `effort`,
`status`, plus `completedAt` on the *completed* card.

### Where cards live

| Path | Contents | Rules |
| --- | --- | --- |
| `users/{uid}/dashboard/config` | one doc: global cards map + `seededAt` marker | owner only |
| `homes/{homeId}/dashboards/{uid}` | one doc per member: this home's cards map + `hiddenSharedIds: string[]` | own uid, member |
| `homes/{homeId}/dashboardCards/{cardId}` | one doc per **shared** card | any member |

Per-card docs for shared cards, not a map in one doc, so two members editing different
shared cards never clobber each other. The screen merges global + home + shared, minus
`hiddenSharedIds`, and sorts by `(rank, id)` — a home-only card can sit above a global
one. **Reordering a global card reorders it in every home**: one rank, on the global
doc. Accepted: the alternative is a per-home order list that a newly added global card
must be appended to in every home, including the ones not yet opened.

### The pool

Phase 1 replaces the due pair (Q3/Q4) with the pool pair in `data/nodes.ts`:

- **Shared arm**: `archived == false`, `completedAt == null`, `visibility == 'shared'`.
- **Participant arm**: `archived == false`, `completedAt == null`,
  `participantIds array-contains uid`.

Both arms **without `limit` and without `orderBy`** — the bend named in Why. Query
safety is the same argument as today's due pair: the shared arm can only match
documents the read rule's first disjunct allows, the participant arm only documents the
second disjunct allows, so no matching document can be rule-denied. `hiddenByRoot`
applies client-side, unchanged — it is the privacy predicate, not an optimization, and
it is why the roots pair stays open.

**Indexes.** `archived` is excluded from single-field indexing, so equality-only on
`(archived, completedAt, visibility)` cannot zigzag: add two composites —
`(archived, completedAt, visibility)` and `(archived, completedAt, participantIds
CONTAINS)` — and **remove** the two dueDate composites whose only consumers die in the
same phase (`(archived, completedAt, visibility, dueDate)` and
`(archived, completedAt, participantIds, dueDate)`).

### Recently done

The one card that is not a filter over the pool — it reads completed nodes, which the
pool excludes by definition. It stays a **built-in card type** (`kind: "completed"`)
fed by the existing done pair (Q5/Q6, unchanged), not something a user can rebuild.
The pool's shared arm keeps its `array-contains` slot free for `locationAncestorIds`
when #51 lands.

### Listener budget

| | Today | After |
| --- | --- | --- |
| Roots pair | hiddenByRoot + Ongoing | unchanged |
| Due pair (Q3/Q4) | Coming up | **replaced by the pool pair** |
| Done pair (Q5/Q6) | Recently done | unchanged |
| Global config doc | — | +1, single document |
| Home dashboard doc | — | +1, single document |
| Shared cards | — | +1, the home's `dashboardCards` collection |

Six listeners become **nine, regardless of how many cards exist** — the issue's "six,
no matter how many cards" holds for card count. The collection listener is bounded by
what members create, a smaller set than the roots pair already listens to. The three
config surfaces are read by id (the two docs) or by one bounded collection, so every
read stays provably safe: you can only ever name your own config docs, and only
members can name the shared collection.

## 4. Rules & tests

`firestore.rules`, three additions:

```js
// A person's card config. Owner only, like the apiKeys beside it.
match /users/{uid}/dashboard/{docId} {
  allow read, write: if signedIn() && uid == request.auth.uid;
}

// A member's cards for one home. Own document only — nobody arranges your screen.
match /homes/{homeId}/dashboards/{uid} {
  allow read, write: if signedIn() && uid == request.auth.uid && isMember(homeId);
}

// Shared cards. Any member reads and writes; hiding is per-member, on their own doc.
match /homes/{homeId}/dashboardCards/{cardId} {
  allow read, write: if isMember(homeId);
}
```

`tests/rules/` cases, same change:

- `users/{uid}/dashboard/config`: the owner reads and writes; another signed-in user is
  denied on the same path.
- `homes/{homeId}/dashboards/{uid}`: a member writes their own doc; the same member is
  denied on another member's doc; a signed-in non-member is denied.
- `homes/{homeId}/dashboardCards/{cardId}`: any member reads and writes; a non-member
  is denied.
- The pool pair stays query-safe: with a private node of another member present that
  matches the filters, both arms succeed, and the shared arm does not return the
  private node.

## Surface brief

- Job:      Marcus composes the screen he opens first; Nadia gets a screen nobody
            arranged for her and can hide what is shared at her; Ingrid reads hers
            without learning filter words
- Primary:  on Overview, nothing moves — read the cards, the FAB stays the one primary
            action. In the editor, add a card. One primary action per screen
- Read:     1st the card title · 2nd its rows · 3rd the "+N more" that holds the rest
- Not like: a query builder, a settings form, anything that shows JSON or names fields
- Remove / quiet / sharpen:  quiet the per-card chrome on the read screen (the menu
            appears on press, not always visible) · sharpen the scope choice to three
            plain words · remove all filter vocabulary from the read screen

## 5. UI flow

- **Overview** (`app/(app)/(tabs)/overview.tsx`) keeps its layout, FAB and landing
  role. The three fixed sections and the four effort cards render through **one card
  component**: title, rows, `+N more` / *Show less* (the existing `overview.more`
  mechanic), and the per-card empty behaviour. The Appbar gains one **tune action**
  opening the editor. Each card header carries a press menu: Edit, Hide for me (shared
  cards only), Copy as text, Remove. Both entries reach the same editor; neither is
  load-bearing for the other.
- **Editor** (a dedicated screen pushed over Overview): the merged card list with a
  scope badge per card, drag to reorder — the same drag boards use, with move up/down
  in the card menu as the accessible alternative, which is this repo's established
  drag-plus-controls pattern — Add card in the Appbar, Import card, and a *Removed
  originals* section listing deleted seeds with Restore.
- **Card edit** (screen or sheet): title `TextInput`; scope as `SegmentedButtons` —
  *All my homes* / *Only this home* / *Everyone here*; conditions as `Chip` groups per
  field, one field at a time, plain words (*Due: Late · Coming up · Not late · No
  date*); sort as a dropdown plus direction; rows shown / held as steppers. Off the
  read screen, filter vocabulary is allowed to be precise.
- **Import**: a `Portal` dialog with a paste field, a decoded preview (title +
  condition summary), and Add. Invalid strings get one sentence, not a stack trace.
- Paper components: `Appbar.Action`, `Card`, `List.Item`, `Chip`, `SegmentedButtons`,
  `TextInput`, `Menu`, `IconButton`, `Portal`/`Dialog`, `Snackbar`, `FAB`. Spacing,
  radius and elevation come from `theme/tokens.ts`; colours from `useAppTheme()`.
- **Offline**: every card write is a Firestore document, so the offline queue handles
  it; shared-card edits made offline reconcile like any node edit. Export and import
  are clipboard-local and work with no connection.

## 6. Strings

New `overview.cards.*` namespace; `sv-SE` lands in the same change. Existing
`overview.ongoing.*`, `overview.due.*`, `overview.done`, `overview.more`,
`overview.less` stay and are re-pointed at the seed cards.

| Key | en-US | sv-SE |
| --- | --- | --- |
| `cards.editor.title` | Edit cards | Redigera kort |
| `cards.editor.add` | Add card | Lägg till kort |
| `cards.editor.import` | Import card | Importera kort |
| `cards.editor.importPaste` | Paste a shared card | Klistra in ett delat kort |
| `cards.editor.importInvalid` | That doesn't look like a shared card. | Det där ser inte ut som ett delat kort. |
| `cards.editor.importAdded` | Card added. Open it to make it yours. | Kortet är tillagt. Öppna det och gör det till ditt. |
| `cards.editor.removed` | Removed originals | Borttagna original |
| `cards.editor.restore` | Restore | Återställ |
| `cards.editor.scope.global` | All my homes | Alla mina hem |
| `cards.editor.scope.home` | Only this home | Bara det här hemmet |
| `cards.editor.scope.shared` | Everyone here | Alla här |
| `cards.editor.hiddenBadge` | Hidden | Dold |
| `cards.menu.edit` | Edit | Redigera |
| `cards.menu.hide` | Hide for me | Dölj för mig |
| `cards.menu.copy` | Copy as text | Kopiera som text |
| `cards.menu.copied` | Copied. Paste it to share the card. | Kopierat. Klistra in det för att dela kortet. |
| `cards.menu.remove` | Remove | Ta bort |
| `cards.title.quickWins` | Quick wins | Snabba vinster |
| `cards.title.aFewHours` | A few hours | Några timmar |
| `cards.title.needsSplitting` | Needs splitting | Behöver delas upp |
| `cards.title.needsEstimate` | Needs an estimate | Behöver en uppskattning |
| `cards.empty.generic` | Nothing matches this card. | Inget matchar det här kortet. |
| `cards.empty.quickWins` | Set the time needed on a task and the quick ones land here. | Sätt tidsåtgång på ett jobb så landar de snabba här. |
| `cards.empty.needsSplitting` | Nothing needs splitting up. | Inget behöver delas upp. |
| `cards.due.comingUp` | Due soon | Blir aktuellt |
| `cards.due.late` | Late | Försenat |
| `cards.due.notLate` | Not late | Inte försenat |
| `cards.due.none` | No date | Utan datum |

Condition and sort labels reuse the existing detail-screen strings (`detail.priority`,
`detail.effort`, status names, assignee/participant wording) wherever one exists.
Seed titles live in i18n and are applied at seed time; an edited seed stores its own
title and stops following the key.

## 7. Acceptance

1. [test] Opening Overview with no card config seeds the seven cards once, writes the
   marker, and a seed the user removed never comes back on later reads.
2. [test] Ongoing projects shows roots in execution in board order — the same rows the
   fixed section shows today, now through the card renderer.
3. [test] Coming up shows every open node that is late or due within 7 days, earliest
   first, including a root and including a row Ongoing projects also shows.
4. [test] Quick wins shows at most 3 non-root childless quick tasks, highest priority
   first, and offers no expander.
5. [test] A few hours shows tasks with effort `<2 h` or `an evening`, at most 3,
   priority first.
6. [test] Needs splitting shows tasks with effort `a weekend` or `multi-week`, 5 shown
   and up to 10 held.
7. [test] Needs an estimate shows tasks with no effort set, 5 shown and up to 10 held.
8. [test] A task with an effort appears in exactly one of the four effort cards.
9. [test] Recently done shows what completed in the last 30 days, newest first, and
   disappears entirely when nothing matches.
10. [test] `+N more` expands a card in place and *Show less* collapses it.
11. [test] A card marked *All my homes* renders in every home the account belongs to,
    and reordering it in one home reorders it in the other.
12. [test] A card marked *Only this home* renders in that home only.
13. [test] A card marked *Everyone here* renders for every member; hiding it removes it
    from that member's screen alone, and the others still see it.
14. [test] The editor creates a card from conditions (assignee = me, not a root) and
    the card renders with matching rows on Overview.
15. [test] Editing a card's conditions changes its rows; removing a card takes it off
    the screen and it stays removed after a reload.
16. [test] A removed seed restored from the editor returns with its original settings.
17. [test] Copy as text produces a string; importing it creates a card the importer
    owns with the same conditions, editable afterwards.
18. [test] With another member's private project present that matches a card's
    conditions, Overview still loads, and that project appears only for its
    participant.
19. [test] A card whose rows have no priority set still renders, and unset priority or
    effort sorts last whatever the direction.
20. [eye] The four effort titles read as household language in both en-US and sv-SE.
21. [eye] Empty-card sentences carry the right tone: good news for Needs splitting, an
    invitation without guilt for Quick wins.
22. [eye] The tune action and the per-card menu read as "arrange this screen", and
    Overview still reads as a read-first screen.
23. [eye] `+N more` reads as something that expands.

## 8. What this does NOT change

- `models/node.ts` and the node field set — conditions read existing fields; nothing
  new is written onto nodes.
- The roots pair, the hide scope and `hiddenByRoot` — the privacy predicate and the
  board-order source are exactly what they are today.
- The done pair feeding Recently done, and its "counts nothing, names nobody" rule.
- The FAB, the add flow, the landing route, the install offer, the tab order.
- Boards, the node detail screen, drag on boards.
- The REST API — cards are client-owned surfaces and are not API-writable in this
  change (see Out of scope).
- The six existing listeners' shapes; three listeners join them, none changes.

## 9. Out of scope

- **OR conditions, nesting** — the issue's own line; the day a real filter needs OR is
  the day to design one.
- **A screen-wide "each card at most once"** — rejected in the issue: it makes a
  card's contents depend on what sits above it. The Coming up / Ongoing seam is
  accepted instead (Why).
- **A subtree condition** (`ancestorIds` contains X) — the per-project card Marcus
  would actually compose. Filed as [#180](https://github.com/Senth/home-backlog/issues/180).
- **A `labels` condition** — waits for #100 to add the field.
- **API access to cards** — Kasper's agent cannot read or write card config in this
  change; the config surfaces are new and the REST story catches up later, deliberately.
- **Server-side filtering / per-shape indexes** — never available; the upgrade path is
  SQL (Why).
- **#55** stays open, rescoped to a sort option this feature does not own.

## 10. Phases

- **Phase 1 — The pool.** Replace the due pair with the pool pair in `data/nodes.ts`;
  add the two composites, remove the two dead dueDate composites in
  `firestore.indexes.json`; `tests/rules/` for both arms. The three existing sections
  keep working unchanged on screen; `models/overview.ts` keeps its pure functions and
  its tests.
- **Phase 2 — Cards.** The card model and engine (`models/overview-cards.ts`:
  conditions, sort with nulls-last, slice), the three config surfaces + rules +
  `tests/rules/`, seeding on first read, the rank merge, one card renderer the three
  existing sections are re-expressed through, the four effort cards, empty behaviour,
  strings (en-US + sv-SE). e2e for claims 1–10 and 19.
- **Phase 3 — The editor.** Create, edit, remove, reorder, restore a seed, the
  three-way scope choice, hide a shared card, per-card menus and the Appbar action,
  strings. e2e for claims 11–16 and 18.
- **Phase 4 — Export/import.** Copy as text, import with preview, strings. e2e for
  claim 17.

Every phase ends green on `yarn lint --write`, `yarn invariants`, `yarn typecheck` and
`yarn test`, and runs its claim numbers with `scripts/dev-stack.sh up` and
`yarn playwright test --no-deps --grep '\b(<claims>):'` — `--project=setup` first.
