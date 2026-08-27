# Overview — ongoing projects, what is coming up, and what recently got done

> Issue [#54](https://github.com/Senth/home-backlog/issues/54). Temporary: `/ship` folds
> this into an area spec and deletes the file.

## Handoff

- This file is the implementation plan. `/implement` works the **Phases** in order.
- Read [`CLAUDE.md`](../../../CLAUDE.md) first, then
  [`boards-and-nodes.md`](../boards-and-nodes.md) — "Queries" (line 420), "Rules" (596),
  "`dueDate` is a calendar day, not an instant" (804) — and
  [`home-and-members.md`](../home-and-members.md) "Navigation" (310).
- Nothing durable may live only in **Handoff**, **Acceptance** or **Phases**. `/ship`
  deletes all three.
- After the last phase: `/review` in a fresh session, then `/ship` on a PASS.

## 1. What

A landing screen that answers "what is going on" without opening a board: the projects
that are in progress, what is coming up or already late, and what recently got done.

## 2. Why

Roadmap item 1 in [`PROJECT.md`](../../PROJECT.md). Every other screen in the app makes
you pick a board before it tells you anything, so the household's own question — *is
anything on fire, and did we get anywhere* — has no screen. Overview is that screen, and
it is the first tab and the route the app opens on, because a summary you have to
navigate to is a summary nobody reads.

**Named Overview / Översikt, never "home".** *Home* is the household you are in
([`home-and-members.md`](../home-and-members.md)), and two meanings of one word on the
screen that shows which home you are in is the one place the app cannot afford it.

### The three sections, and the one that is a stand-in

- **Ongoing projects** — root nodes with `status === 'execution'`. Roots, not every node
  in progress at any depth: "ongoing project" is a question about projects, and a list
  that mixes *Renovate bathroom* with *order tiles* answers neither.
- **Coming up** — anything with a due date that is late or within `soonInDays`.
- **Recently done** — anything completed in the last 30 days.

Recurring maintenance ([#57](https://github.com/Senth/home-backlog/issues/57)) does not
exist, so there is no `recurring` collection to read. **Coming up** is deliberately *not*
called "Upcoming maintenance": a section under that name containing "order gravel" and
none of the gutters, hedge or service intervals teaches Tom that the app forgot the season
calendar rather than that it was never built. When #57 ships, its spawned instances are
nodes with due dates and join this section under the name it already has.

The sections are fixed. The issue's own plan is that a household eventually composes them
as filters — "fun label, under 30 minutes", "everything with no estimate" — which needs
custom labels ([#100](https://github.com/Senth/home-backlog/issues/100)) first. Building
configurability before there is anything to configure would be building the filter engine
twice. What this design owes that future is only that a fourth section costs a list entry,
not a rewrite.

### Why not a progress bar

`doneCount / childCount` on a root is a lie about nested work: *Renovate bathroom* reads
1/4 while the tiling child alone holds eleven real steps. `boards-and-nodes.md` rejected a
progress bar on the card face for exactly this, and a landing screen renders it at higher
volume to more people. Overview reuses the card's existing `board.steps` glyph, `3/8`,
which is honest because it says **steps** rather than percent. An honest whole-project bar
needs a `descendantCount` fanned across `ancestorIds` on every create, delete and
reparent, and that is not this issue.

### Why nothing here is counted

**Recently done carries titles and nothing else** — no total, no streak, no per-person
tally. A number turns encouragement into a grade, and a "0 completed" empty state is
precisely the guilt the app exists to remove, which is why the section is *absent* rather
than empty when there is nothing in it. For the same reason it does not name who finished
each item: attribution would make one person's four items visible beside another's forty,
which is a scoreboard, and there is no `completedBy` field — only `completedAt` — so it
would also cost a new `Node` field, a `validNode()` case and a REST API change to build
the thing we do not want.

### Why hiding is root-scoped and silent

A board hides a shared card whose `participantIds` does not contain you, so that one
member's personal projects stay off another's board without ever being denied to them.
Overview applies the same predicate or the two screens disagree about which projects
exist — and the household member who curates nothing gets a landing screen made entirely
of somebody else's work.

But `hiddenByParticipants` is `participantIds.length > 0 && !includes(uid)`, and a shared
*descendant* deliberately carries `[]`, which is what keeps a step visible. Applied per
node it would hide a personal project from **Ongoing projects** while that project's dated
step still landed in **Coming up** and its finished step in **Recently done** — the screen
contradicting itself within one scroll. So a node is hidden when **its root** is hidden,
resolved through `ancestorIds[0] ?? node.id` against the roots the screen already holds.

**No toggle, and no "n more are hidden" line.** A summary with a filter control on it is a
board, and the board one tab over already has both. A root that cannot be found among the
loaded roots is treated as hidden: the roots pair is answered before any section renders,
so the only way to reach that branch is a state that should not exist, and leaking
somebody's private work is the worse of the two failures.

### Why listeners, and why only six

Every section needs the read rule's two disjuncts as two queries — Firestore rejects a
whole query if any matching document could be denied — so a section is a pair, not a
query. Three sections would be six pairs' worth of temptation on the screen the app opens
on, and `CLAUDE.md` names listener breadth the cost risk in this app.

It is six listeners, not eight, because **root-scoped hiding and Ongoing projects want the
same data**: every unarchived root. That is `sharedBoardQuery(homeId, null)` and
`participatingBoardQuery(homeId, null, uid)` — the root board's own pair, already written,
already indexed, already wrapped in `useNodes(homeId, null)`. Ongoing projects is a
client-side `status === 'execution'` filter over it, in the board's own `rank` order,
which is the order the household chose. Overview adds no query and no index for its first
section.

They are listeners rather than one-shot reads because `subscribeWithRetry` and
`isQueryAnswer` are what stop an empty cache reading as an empty house — the failure
[#101](https://github.com/Senth/home-backlog/issues/101) was, now on the first screen of
every cold start. Writing a one-shot path would mean writing the cache-only hold and the
retry ladder a second time.

## 3. Data & queries

**No new fields.** `dueDate`, `completedAt`, `archived`, `visibility`, `participantIds`
and `ancestorIds` all exist and are all written on every document.

### Roots — Ongoing projects, and the hide scope

Unchanged, reused as-is:

```
Q1  archived == false && parentId == null && visibility == 'shared'          orderBy rank
Q2  archived == false && parentId == null && participantIds array-contains me  orderBy rank
```

Provably safe by the read rule's two disjuncts, exactly as a board load is. Merged and
deduped by `mergeNodeResults`. Existing indexes cover both.

### Coming up

```
Q3  archived == false && completedAt == null && visibility == 'shared'
    && dueDate >= '' && dueDate <= <today + soonInDays>      orderBy dueDate asc, limit 20
Q4  archived == false && completedAt == null && participantIds array-contains me
    && dueDate >= '' && dueDate <= <today + soonInDays>      orderBy dueDate asc, limit 20
```

Three things in that shape are load-bearing:

- **`dueDate >= ''` is what excludes undated nodes.** Firestore orders values by type
  before value — `Null < Boolean < Number < Timestamp < String` — so `null` sorts below
  every string, and `dueDate <= <cutoff>` **on its own matches every node in the home that
  has no due date at all**. The empty string is the smallest string, so the lower bound
  costs nothing and removes the entire null class. This is the single easiest way to turn
  this screen into an unbounded listener, and claim 3 exists to keep it fixed.
- **`completedAt == null` is how "not done" is spelled.** `firestore.rules` enforces
  `(data.status == 'done') == (data.completedAt != null)`, so the two say the same thing —
  and this one keeps saying it when custom statuses
  ([#69](https://github.com/Senth/home-backlog/issues/69)) arrive, which
  `status in ['backlog', 'next_up', 'execution']` would not.
- **Ascending order is late-first.** The section wants overdue at the top, which is what
  `orderBy dueDate asc` already gives; no second query, no client sort. A household with
  more than 20 items in the window sees the 20 oldest, which is the right 20.

There is **no lower bound on how far back late reaches**. A card overdue by 400 days is
still overdue, and the honest answer to it is archiving it
([#64](https://github.com/Senth/home-backlog/issues/64)), not hiding it from the one
screen that would say so. The `limit` is what bounds the listener.

### Recently done

```
Q5  archived == false && visibility == 'shared'
    && completedAt >= <now - 30 days>              orderBy completedAt desc, limit 20
Q6  archived == false && participantIds array-contains me
    && completedAt >= <now - 30 days>              orderBy completedAt desc, limit 20
```

`completedAt` needs no lower-bound trick: `null` sorts below every timestamp, so the range
excludes not-done nodes by itself.

### New indexes

Four entries in `firestore.indexes.json`:

| Fields |
| --- |
| `archived` ASC, `completedAt` ASC, `visibility` ASC, `dueDate` ASC |
| `archived` ASC, `completedAt` ASC, `participantIds` CONTAINS, `dueDate` ASC |
| `archived` ASC, `visibility` ASC, `completedAt` DESC |
| `archived` ASC, `participantIds` CONTAINS, `completedAt` DESC |

No `fieldOverrides` change: `dueDate` and `completedAt` are not in the exclusion list, so
their single-field indexes already exist.

### The `array-contains` slot

Q4 and Q6 spend their one permitted `array-contains` on `participantIds`, which is what
makes them safe. Q3 and Q5 keep theirs free, for `locationAncestorIds` when the location
tree ([#51](https://github.com/Senth/home-backlog/issues/51)) gives Overview a place
filter.

## 4. Rules & tests

**No change to `firestore.rules` or `storage.rules`.** Every query above is composed of
fields the rules already validate and is permitted by one of the two disjuncts of the
existing node read grant.

`tests/rules/firestore.test.ts` still gains cases, in the existing `the board queries`
describe or a sibling — a query being *permitted* is the claim, and nothing else in the
repo makes it:

1. Q3 succeeds for a member, and returns the shared dated node and not the private one.
2. Q4 succeeds for its participant and returns the private dated node.
3. Q5 succeeds for a member and returns only the shared completed node.
4. Q6 succeeds for its participant.
5. The one-query variant of Coming up — the same filters without the `visibility` /
   `participantIds` clause — **fails**, which is what makes the pair necessary rather than
   stylistic.
6. The same, for Recently done.

Domain tests, in `models/`: the section selectors and the root-scoped hide predicate get
unit tests — which root id a node resolves to, that a node whose root is hidden is hidden,
that a node whose root is missing is hidden, that an undated node is in no section, and
the `soonInDays` and 30-day boundaries in both directions. These are pure functions over
`Node[]` and need no Firestore.

## 5. UI flow

### Placement

Overview is the **first tab** and the route the app opens on. `app/index.tsx` redirects a
signed-in visitor to `/(app)/(tabs)/overview`, and `(tabs)/_layout.tsx` declares Overview
before Projects. Projects, Locations and Maintenance keep their order below it.

The landing route never depends on what is in the database. A rule like "open on Projects
until the first node exists" moves the app under a household the moment they create — and
delete — their first card.

### The screen

`Appbar.Header` copies the root board's exactly: a `BackAction` to `/homes`,
`Appbar.Content` titled `activeHome.name`, and `AccountMenu`. **The app bar names the
home, not the screen** — the tab bar already names the screen, and Overview is now the
highest-risk place in the app for recording cabin work on the house board, with no
breadcrumb to lean on. No `BoardMenu`: there is no filter here to toggle.

Three sections in a scrolling `View`, each a Paper `List.Subheader` heading over its rows,
separated by `space` tokens. A row is a `List.Item` — title, and the meta the card face
already carries: `board.steps` for a project with children, and the
`board.dueLate` / `board.dueSoon` chip via `MetaChip` for a dated one. Tapping a row goes
where a board card's tap goes: the board if it has steps, the details screen if not.

**Overdue is words, never colour.** `boards-and-nodes.md` settled that on the card face —
nothing in the app acts on a due date yet, so a red chip is pure guilt for a deadline
nothing will remind anyone about, and words survive 200% text and colour blindness.

### Caps and overflow

Each section shows **five** rows. Past that it renders one control reading `+{{count}}
more`, which expands the section in place from data already held; expanded, it reads
`Show less`. No navigation — Coming up and Recently done have no cross-board dated screen
to land on, and inventing one is a different issue.

Ongoing projects' count is exact, because its query is unlimited. Coming up and Recently
done count against their `limit(20)`, so a section holding more than twenty says `+15
more` and expands to twenty. That ceiling is deliberate: twenty rows is already past what
a summary can be, and lifting it trades a bounded listener for rows nobody reads.

### Empty, and the first run

Each section holds independently on `isQueryAnswer`, so a cache-only empty snapshot is
"I do not know yet" rather than "there is nothing". A section that is genuinely empty
behaves by what its emptiness *means*:

- **Ongoing projects** says `Nothing in progress.` — that is an answer Marcus wants.
- **Coming up** says `Nothing coming up.` — so is that.
- **Recently done** is **absent**. "Nothing completed" is the report card, and a household
  that has finished nothing does not need a box saying so.

When all three are answered and empty, the whole screen is replaced by one line —
`Nothing here yet. Add the first project.` — rather than three boxes each explaining that
the household has nothing.

### Adding

A `FAB` labelled `Add a project`, opening the same `TitleDialog` the board uses and
calling `createNode` with `parent: null`, `status: 'backlog'`, `rank: rankAtEnd(...)` and
`participantIds` set to every member of the home — the root board's own create, because a
shared project is born with the whole household on it. Naming a destination column, as the
board's FAB does, would be naming something Overview does not show.

The FAB is why moving Projects to the second tab does not lengthen the path for the person
whose only write is "add the one thing I just noticed". The first-run line points at the
FAB rather than carrying a second button for the same action.

### Offline

Nothing new. The listeners are Firestore listeners, so a cached Overview renders offline
and a queued create appears in Ongoing projects the moment Firestore applies it locally.

## 6. Strings

`sv-SE` was written first and `en-US` translated from it. *Snart förfaller* is what a bill
does and *senaste 30 dagarna* is a report; neither is how a household talks about the
gutters.

| Key | `en-US` | `sv-SE` |
| --- | --- | --- |
| `tab.overview` | Overview | Översikt |
| `overview.ongoing.title` | Ongoing projects | Pågående projekt |
| `overview.ongoing.empty` | Nothing in progress. | Inget pågår. |
| `overview.due.title` | Coming up | Kommande |
| `overview.due.empty` | Nothing coming up. | Inget på gång. |
| `overview.done.title` | Recently done | Senaste gjorda |
| `overview.more` | +{{count}} more | +{{count}} till |
| `overview.less` | Show less | Visa färre |
| `overview.empty` | Nothing here yet. Add the first project. | Inget här ännu. Lägg till första projektet. |
| `overview.add` | Add a project | Lägg till projekt |

`overview.empty` deliberately mirrors `board.empty` — "Nothing here yet. Add the first
card." — because it is the same sentence about a different thing.

Reused unchanged: `board.steps`, `board.dueLate`, `board.dueSoon`, `homes.title` for the
back action, and everything `TitleDialog` already owns.

**Recently done** names no window, in either language, so the heading can never disagree
with the query the way "the last 30 days" would.

## 7. Acceptance

1. `[test]` The app opens on Overview, and Overview is the first tab.
2. `[test]` A root card in In progress appears under Ongoing projects, and leaves the
   section when it is moved to To do.
3. `[test]` A node with no due date is absent from Coming up.
4. `[test]` Under Coming up, a node whose due date has passed sorts above one due in three
   days.
5. `[test]` A node due further out than `soonInDays` is absent from Coming up.
6. `[test]` A node completed yesterday appears under Recently done; one completed 40 days
   ago does not.
7. `[test]` A root whose `participantIds` excludes the signed-in member appears in no
   section, and neither does that root's dated step.
8. `[test]` The Overview app bar shows the active home's name.
9. `[test]` A section holding more than five items shows five rows and a `+N more`
   control, and the control reveals the rest.
10. `[test]` The FAB creates a root project, which then appears in the To do column of the
    Projects board.
11. `[test]` A home with no nodes shows the first-run line, and no section headings.
12. `[test]` With an ongoing project but nothing due and nothing completed, Coming up says
    it is empty and Recently done is not rendered at all.
13. `[eye]` Recently done reads as memory rather than as a grade.
14. `[eye]` The `sv-SE` headings read as a household rather than as an administrator.
15. `[eye]` Three sections on a phone read as a summary rather than as a wall.
16. `[eye]` The overdue rows in Coming up land as information rather than as guilt.

## 8. What this does NOT change

- `firestore.rules`, `storage.rules`, and every existing `tests/rules/` case.
- The `Node` shape. No new field, no migration, nothing for the REST API to learn.
- The board, the card, the card menu, drag, the detail screen, and every existing query.
- Projects, Locations and Maintenance keep their screens and their content. Only their
  position in the tab bar moves.
- `soonInDays`. Overview reuses the constant that already decides whether a card face
  shows a due chip, so "soon" means one thing in the app.

## 9. Out of scope

- **Quick wins — "what can I do in twenty minutes"**
  ([#56](https://github.com/Senth/home-backlog/issues/56)). The one thing a household
  would look for on this screen and not find, and the section list is built so a fourth
  section is a list entry rather than a rewrite. It needs `effort` to be worth reading.
- **User-composed sections and saved filters.** The issue's own eventual plan; needs
  custom labels ([#100](https://github.com/Senth/home-backlog/issues/100)).
- **Recurring maintenance instances in Coming up**
  ([#57](https://github.com/Senth/home-backlog/issues/57)). They are nodes with due dates,
  so they join the section as data, not as code.
- **A whole-project progress bar.** Rejected in `boards-and-nodes.md`; needs a
  `descendantCount` fanned across `ancestorIds` on every structural write.
- **`completedBy` and per-person attribution.** New field, rules case and REST API change,
  to build a scoreboard.
- **A blocked mark on an Overview row**
  ([#66](https://github.com/Senth/home-backlog/issues/66)) — `blockedBy` is not built.
- **Suggestions** ([#55](https://github.com/Senth/home-backlog/issues/55)) and the
  **calendar view** ([#67](https://github.com/Senth/home-backlog/issues/67)).
- **Desktop layout.** Overview is the phone layout stretched until
  [#31](https://github.com/Senth/home-backlog/issues/31) says otherwise.

## 10. Phases

| # | Work | Agent |
| --- | --- | --- |
| 1 | Queries Q3–Q6 in `data/nodes.ts`, the four indexes, the `tests/rules/` cases, and the section selectors + root-scoped hide predicate in `models/` with unit tests | `feature-large` |
| 2 | `hooks/use-overview.ts` — the three listener pairs, per-section `isQueryAnswer`, merge, hide, cap | `feature-small` |
| 3 | `app/(app)/(tabs)/overview.tsx`, the tab reorder, the root redirect, the section rows, the FAB, the first-run line, and the strings in both locales | `feature-large` |
| 4 | `e2e/overview.spec.ts` for claims 1–12, with its dated and completed fixture nodes via `createFixtureNode` | `feature-small` |

Phase 4 is not optional, and it is where the fixture question lands: `completedAt` is
written by `moveNode` as *now*, so claim 6's 40-day-old completion and claim 4's past due
date have to be written directly through `createFixtureNode`, under the `E2E ` prefix that
`fixture.setup.ts` sweeps.
