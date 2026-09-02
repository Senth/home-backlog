# Overview

The screen the app opens on. It answers *what is going on* without making anyone pick a
board first, and which questions it answers is the household's to decide: the screen is an
ordered list of **filter cards** over the home's open work, and a card is data a person
edits.

Every other screen in the app makes you choose a board before it tells you anything, so
the household's own question — *is anything on fire, and did we get anywhere* — had no
screen. Overview is that screen, it is the first tab, and it is the landing route, because
a summary you have to navigate to is a summary nobody reads.

It owns one document of its own, the card config. Every row on it is a node
([`boards-and-nodes`](boards-and-nodes.md)), rendered with the card face's own meta, and
every tap lands where a board card's tap lands.

## Named Overview, never "home"

*Overview* / *Översikt*. **Home** is the household you are in
([`home-and-members`](home-and-members.md)), and two meanings of one word on the screen
that shows which home you are in is the one place the app cannot afford it. "Dashboard
home" was rejected for the same reason.

## Cards, not fixed sections

The screen shipped with three fixed sections — ongoing projects, what is coming up, what
was recently done. Fixed sections answer three questions forever, and a household's
questions change with the season, the project and the person. So the sections became
cards: an ordered list a person composes, the way Home Assistant lets you compose a
dashboard, over one shared client-side pool of the home's open nodes.

A card is a `.filter().sort().slice()` over that pool. `models/overview-cards.ts` holds all
of it as pure functions over `Node[]`, unit tested without Firestore, the way
`models/overview.ts` held the three sections. The queries bound what *can* arrive; the
cards decide what is *shown*, and the overlap is deliberate — a listener stays open for
hours, so the `now` a query was built with drifts, and a card due in seven days is still in
the result set eight days later. Re-asking the question on every render is what keeps a
card agreeing with its own heading.

### The card

```ts
interface Card {
  id: string;
  kind: "filter" | "completed";   // "completed" is only ever the Recently done seed
  seedId: SeedId | null;          // set on seeds; a restore re-creates the card from it
  title: string | null;           // null on an untouched seed -> titled from i18n
  conditions: CardCondition[];    // AND together; a "completed" card has none
  sort: { field: SortField; direction: "asc" | "desc" } | null;  // null = board order
  shown: number;                  // rows collapsed
  max: number;                    // rows held; the rest is dropped, not hidden
  empty: { mode: "hide" } | { mode: "say"; key: string };
  rank: string;                   // fractional, from the same helpers as a node's rank
}
```

`scope` is not a field. It is **where the card is stored**, which is what makes moving a
card between scopes a delete and a write rather than a field edit, and what makes the rules
below say everything about who can touch what.

### Conditions AND together, and there is no OR

All seven seeds are expressible that way, and the day a real filter needs OR is the day to
design one. Within one condition the values are ORs — "effort is quick or an evening" — but
conditions never nest. The vocabulary is driven by `models/node.ts` rather than by the
roadmap: every comparable field on a node is offerable, including ones whose own editing UI
had not shipped when the cards did.

| Condition | Values |
| --- | --- |
| `status` | any of `backlog` / `next_up` / `execution` |
| `priority` | any of the enum, plus *not set* |
| `effort` | any of the enum, plus *not set* |
| `dueDate` | **coming up** (late, or within `n` days, `n` editable and defaulting to `soonInDays`), **late**, **not late** (dated, today or later), **no date** |
| `isRoot` | is a project (`parentId == null`), or is a step |
| `hasChildren` | has steps, or none |
| `assigneeIds` | me / unassigned / any of the members |
| `participantIds` | me / any of the members |
| `blockedBy` | waiting on something, or not |
| `locationId` | has a location / has none / in or under any of the picked places |
| `visibility` | shared / private |
| `createdVia` | in the app / by an agent |
| `notes`, `photos`, `checklist` | has / has none |

Two of those read the model rather than a field:

- **Waiting is #66's meaning, not `blockedBy.length`.** A blocker that completed while the
  card waited stays in `blockedBy` as inert history, so the stored length answers the wrong
  question. The condition asks `unresolvedBlockers`, the same function the card face's
  *Waiting* mark asks, so a row's mark and the card that selected it can never disagree. A
  blocker absent from the map — private to another member, deleted, not read yet — counts
  as unresolved, which is the privacy-safe not-yet direction the rest of the app takes.
- **A location condition means in or under.** `locationAncestorIds` holds only the
  ancestors, so matching is the union of the node's own `locationId` with that chain
  ([`location-tree`](location-tree.md)). Picking *Garden* and getting nothing filed in
  *Garden / Shed* would be a filter that lies about a tree the household can see.

`labels` is not in the vocabulary and the editor does not offer it: the field does not
exist until [#100](https://github.com/Senth/home-backlog/issues/100) adds it.

### Sort, and where the unknowns go

Sortable: `dueDate`, `priority`, `effort`, `status`, and `completedAt` on the completed
card. Ascending or descending, and `null` means **board order** — `(rank, id)`, which for
roots is the order the household chose on the root board.

A `null` priority or effort **sorts last whatever the direction**. "Unknown" is not
"lowest", and a descending priority sort that opened with every unestimated card would bury
the answer under the absence of one. Ties break on `(rank, id)`, so a card with no sort at
all is the board's own order rather than an arbitrary one.

### Shown, held, and no screen-wide cap

`shown` is the rows a card renders collapsed; `max` is what it holds in total, and the rest
is dropped rather than hidden behind the expander. `overviewLimit` stopped being a screen
constant and became the per-card `max`, so the screen's row ceiling is whatever the cards
add up to — the seeds alone are 31 collapsed rows against the 15 the fixed sections
reasoned from.

A global cap was rejected: it makes a card's contents depend on what sits above it, so
reordering silently changes cards and one can empty out for a reason nothing on screen
explains. Overwhelm is managed by card defaults and by hiding, not by a screen rule.

### Empty is decided per card

Every card keeps its heading when it is empty and says one sentence, except when its
`empty` says `hide`. A card you configured that vanishes reads as broken config; and for
several of the seeds an empty card is the *good* outcome, which is a sentence rather than
an absence.

Recently done is the one seed that hides — for the reason under "Nothing here is counted"
— and it is a card setting, not a screen rule, so a user card can choose the same.

### The seven seeds

| Card | Conditions | Sort | Shown / held | Empty |
| --- | --- | --- | --- | --- |
| Ongoing projects | `status` execution, is a project | board order | 5 / 20 | *Nothing in progress.* |
| Coming up | due **coming up** | `dueDate` asc | 5 / 20 | *Nothing coming up.* |
| Quick wins | `effort` `<30 min`, is a step, no steps | `priority` desc | 3 / 3 | *Set the time needed…* |
| A few hours | `effort` `<2 h` or *an evening* | `priority` desc | 3 / 3 | generic |
| Needs splitting | `effort` *a weekend* or *multi-week*, is a step, no steps | `priority` desc | 5 / 10 | *Nothing needs splitting up.* |
| Needs an estimate | `effort` **not set** | board order | 5 / 10 | generic |
| Recently done | built-in `completed` card | `completedAt` desc | 5 / 20 | absent |

The first two and the last are the fixed sections, re-expressed; they render the same rows
they always did, through the card renderer. The four effort cards are what
[#56](https://github.com/Senth/home-backlog/issues/56) asked for, and this feature
supersedes it.

**The four effort cards partition the effort scale** — `quick` / `hours`–`evening` /
`weekend`+ / unset — so every task with an effort lands in exactly one of them. The cost is
an upper bound on *A few hours* nobody asked for; the defence is that a weekend job is not
a win you knock out, it is one you split, which is what the next card says.

*Quick wins* and *Needs splitting* also require a childless step, because a project that is
a weekend of work is not a project to split — it already is one — and "twenty minutes" is
a claim about a task.

### Seeding writes once, and a deleted seed stays deleted

The seeds are written into the **global** config doc on the first read that finds it
missing, together with a `seededAt` marker. Never a diff against a hardcoded list on later
reads: that would resurrect a seed somebody deleted, every time they opened the app.

A cache-only miss is held rather than seeded — the same line `hooks/use-node.ts` holds.
Offline, "not in my cache" is not "not there", and seeding over a config that exists on the
server is exactly the resurrection the marker exists to prevent.

Untouched seeds carry `title: null` and are titled from i18n, so they follow the reader's
language. Edit the title and the card stores its own and stops following the key.

### The Coming up / Ongoing projects overlap is accepted

The fixed-section spec had a rule that Coming up never repeated a row Ongoing projects was
showing: one project taking two of the five rows a section had, and the single thing in the
house that is late said twice in one glance, is guilt arriving through repetition instead
of through colour.

The rule does not survive the move to cards, and it is not re-implemented. The AND-only
language cannot say *not (a root and in execution)* — that needs an OR — and a rule the
screen applies that no card can express would be a rule nobody editing a card could see,
predict or turn off. Excluding all roots from Coming up instead would hide the dated
backlog project whose only date sits on the root, which is how "before winter" gets
recorded.

So: no exclusion. Ongoing projects stays projects-only, a duplicate appears only when a due
date sits on a root, and the discipline the app already teaches is that dates belong on the
thing you do. The same seam exists between Coming up and the effort cards for tasks due
inside the window, and the **not late** condition is what a household that minds it uses to
take the late repeats out — which are the ones that read as guilt.

### Recently done is the one card that is not a filter

It reads completed nodes, which the pool excludes by definition, so it stays a built-in
card type (`kind: "completed"`) fed by the done pair rather than something a user can
rebuild out of conditions. A card cannot be turned into it and an imported string claiming
to be it is rejected.

## Where cards live

| Path | Contents | Rules |
| --- | --- | --- |
| `users/{uid}/dashboard/config` | the global cards map, and the `seededAt` marker | owner only |
| `homes/{homeId}/dashboards/{uid}` | this home's cards map, and `hiddenSharedIds` | own uid, and a member |
| `homes/{homeId}/dashboardCards/{cardId}` | one **shared** card | any member |

Shared cards are one document each rather than a map in one doc, so two members editing
different shared cards never clobber each other.

The screen merges all three, minus this member's `hiddenSharedIds`, and sorts the result by
`(rank, id)` — so a home-only card can sit above a global one. **Reordering a global card
reorders it in every home**, because there is one rank and it is on the global doc. The
alternative is a per-home order list that every newly added global card must be appended
to in every home, including the ones the member has not opened yet.

### Three scopes, and why not two

Per-user storage is the default and the protection: nobody can arrange your screen, so the
chore list pushed at the member who curates nothing cannot exist. But a two-person
household where only one person curates would leave the other on the seven seeds forever,
so a card can also be **shared with the home** — the household's shared questions ("what is
unassigned", "what is waiting") are the same for everyone, and re-creating them per member
is make-work.

The per-member **hide** is what keeps shared cards from becoming the chore wall: anyone
removes any shared card from their own screen, on their own document, without touching it
for anyone else. A hidden card is still in the editor, badged *Hidden*, with *Show for me*
in its menu.

Rejected: share-by-copying only, with no live card. It answers the make-work but not the
"we all watch the same thing" case, and the copy silently rots the day the original is
edited.

The three scopes are three plain words on the read-facing side — *All homes* / *Home* /
*Everyone* — chosen to fit a 390px segmented control at 200% text in Swedish, where *All my
homes* / *Only this home* / *Everyone here* did not.

### Export and import

*Copy as text* puts the card on the clipboard as plain JSON: kind, title, conditions, sort,
`shown`, `max`, `empty`, and nothing else. No id, no rank — the importer mints their own —
no `seedId`, because an import is never a seed, and the title already resolved, because the
reader's i18n does not travel with it.

Importing creates the card as the **importer's own**, in the scope they pick. This is how
Marcus's "assigned to Marcus" card becomes Nadia's "assigned to Nadia" card: she imports,
then swaps the assignee in the editor. Member and location references travel inside the
string as ids, and one imported into a home where that id does not exist simply matches
nothing until it is edited. A member-swap wizard at import time was rejected — the editor
is where those conditions are edited anyway.

A string that will not parse, or that claims to be the built-in completed card, is not a
card: the dialog says one sentence and nothing is written. `importCard` returns `null` and
never throws, and `toCard` does the defensive reading, so a field the string cannot say
falls back exactly the way a stored document does.

## Nothing here is counted

**Recently done carries titles and nothing else** — no total, no streak, no per-person
tally. A number turns encouragement into a grade, and a "0 completed" empty state is
precisely the guilt the app exists to remove, which is why that card is *absent* rather
than empty when it holds nothing.

For the same reason it does not name who finished each item. Attribution would make one
person's four items visible beside another's forty, which is a scoreboard — and there is
no `completedBy` field, only `completedAt`, so it would also cost a new `Node` field, a
`validNode()` case and a REST API change to build the thing we do not want.

**It names no window either**, in either language, so the heading can never disagree with
the query the way "the last 30 days" would.

## No progress bar

`doneCount / childCount` on a root is a lie about nested work: *Renovate bathroom* reads
1/4 while the tiling child alone holds eleven real steps. [`boards-and-nodes`](boards-and-nodes.md)
rejected a progress bar on the card face for exactly this, and a landing screen renders it
at higher volume to more people. Overview reuses the card's existing `board.steps` glyph,
`3/8`, which is honest because it says **steps** rather than percent. An honest
whole-project bar needs a `descendantCount` fanned across `ancestorIds` on every create,
delete and reparent.

## Hiding is root-scoped, and silent

A board hides a shared card whose `participantIds` does not contain you, so one member's
personal projects stay off another's board without ever being denied to them. Overview
applies the same predicate, or the two screens disagree about which projects exist — and
the household member who curates nothing gets a landing screen made entirely of somebody
else's work.

But `hiddenByParticipants` is `participantIds.length > 0 && !includes(uid)`, and a shared
*descendant* deliberately carries `[]`, which is what keeps a step visible. Applied per
node it would hide a personal project from the Ongoing projects card while that project's
dated step still landed in Coming up and its finished step in Recently done — the screen
contradicting itself within one scroll.

So `hiddenByRoot` hides a node when **its root** is hidden, resolved through
`ancestorIds[0] ?? node.id` against the roots the screen already holds. A node whose root
is not among them is hidden. That is mostly a state that should not exist — the roots pair
is answered before any card renders — but one real case reaches it: a private step you are
a participant of, under a private root you are not on and therefore cannot read. Leaking
somebody's private work is the worse of the two failures.

The predicate runs before any card's conditions, so no card can be written that escapes it.

**No toggle, and no "n more are hidden" line.** A summary with a filter control on it is a
board, and the board one tab over already has both.

## Queries

**Nine listeners, regardless of how many cards exist.** Three node pairs and the three card
config surfaces:

| | What it feeds |
| --- | --- |
| Roots pair (Q1/Q2) | the hide predicate, the Ongoing projects card's rows, and the FAB's rank |
| Pool pair (Q3/Q4) | every filter card |
| Done pair (Q5/Q6) | the completed card |
| `users/{uid}/dashboard/config` | one document |
| `homes/{homeId}/dashboards/{uid}` | one document |
| `homes/{homeId}/dashboardCards` | one bounded collection |

Every node query needs the read rule's two disjuncts as two queries — Firestore rejects a
whole query if any matching document could be denied — so a pair, never a query. The card
surfaces are read by id or as the one collection only members can name, so every read here
is provably safe as well.

### Roots — the hide scope, and Ongoing projects

```
Q1  archived == false && parentId == null && visibility == 'shared'            orderBy rank
Q2  archived == false && parentId == null && participantIds array-contains me  orderBy rank
```

The root board's own pair, already written, already indexed, already wrapped in
`useNodes(homeId, null)`, and merged by `mergeNodeResults` which sorts by `(rank, id)`.
Overview adds no query and no index for it, and it is why board order is available as a
card's sort at all.

### The pool

```
Q3  archived == false && completedAt == null && visibility == 'shared'
Q4  archived == false && completedAt == null && participantIds array-contains me
```

**No `limit` and no `orderBy`.** Every filter card reads this one set, so the pair cannot
be shaped for any card in particular, and a `limit` would make which cards fill depend on
an ordering none of them chose.

That **bends CLAUDE.md's "never subscribe to a whole collection" knowingly**. The rejected
alternative was server-side narrowing, which is not available: *Needs splitting* is
`effort >= weekend` and not a root and no children sorted by priority, and Firestore
requires an inequality field to lead the sort; every distinct filter shape would want its
own entry in `firestore.indexes.json`, which a person editing a filter in the UI cannot
deploy; and `effort`, `priority` and `childCount` are excluded from indexing by field
override today. PROJECT.md's scale check puts a household's open work in the hundreds
against a 1 GiB / 50k-reads-a-day free tier. If a home's open set ever outgrows that, the
answer is SQL, not a differently shaped listener.

Safety is the same argument the dated pair used: the shared arm can only match documents
the read rule's first disjunct allows, the participant arm only documents the second
allows, so no matching document can be rule-denied.

**`completedAt == null` is how "not done" is spelled.** `firestore.rules` enforces
`(data.status == 'done') == (data.completedAt != null)`, so the two say the same thing —
and this one keeps saying it when custom statuses
([#69](https://github.com/Senth/home-backlog/issues/69)) arrive, which
`status in ['backlog', 'next_up', 'execution']` would not.

There is **no lower bound on how far back late reaches**, and now there is no upper bound
on how far ahead a card may look either: both are the card's question, asked client-side
against a fresh `now`. A card overdue by 400 days is still overdue, and the honest answer
to it is archiving it ([#64](https://github.com/Senth/home-backlog/issues/64)), not hiding
it from the one screen that would say so.

### Recently done

```
Q5  archived == false && visibility == 'shared'
    && completedAt >= <now - 30 days>              orderBy completedAt desc, limit 20
Q6  archived == false && participantIds array-contains me
    && completedAt >= <now - 30 days>              orderBy completedAt desc, limit 20
```

Unchanged by the cards. `completedAt` needs no lower-bound trick: `null` sorts below every
timestamp, so the range excludes not-done nodes by itself. The bound is an instant rather
than a calendar day, because `completedAt` is a `Timestamp` and nothing about a completion
is timezone-shaped.

### Indexes

| Fields |
| --- |
| `archived` ASC, `completedAt` ASC, `visibility` ASC |
| `archived` ASC, `completedAt` ASC, `participantIds` CONTAINS |
| `archived` ASC, `visibility` ASC, `completedAt` DESC |
| `archived` ASC, `participantIds` CONTAINS, `completedAt` DESC |

The first two replaced the dated pair's composites, which carried a trailing `dueDate` and
lost their only consumers with it. They are still needed without it: `archived` is excluded
from single-field indexing, so an equality-only query on the other two cannot zigzag its way
there.

No `fieldOverrides` change: `completedAt` is not in the exclusion list, so its single-field
index already exists.

### The `array-contains` slot

Q4 and Q6 spend their one permitted `array-contains` on `participantIds`, which is what
makes them safe. Q3 and Q5 keep theirs free, for `locationAncestorIds` if a location ever
has to narrow the pool server-side — which the in-or-under condition does client-side
today.

### Rules

Three additions to `firestore.rules`, and `tests/rules/` covers each in the same change:

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

The node queries add nothing to the rules: they are composed of fields the rules already
validate, and each arm is permitted by one of the two disjuncts of the existing read grant.
`tests/rules/firestore.test.ts` proves both arms of the pool pair are permitted, that the
shared arm does not return another member's private node that matches the same filters, and
that the one-query variant — the same filters without the `visibility` / `participantIds`
clause — **fails**, which is what makes the pair necessary rather than stylistic.

### Why listeners rather than one-shot reads

`subscribeWithRetry` and `isQueryAnswer` are what stop an empty cache reading as an empty
house — the failure [#101](https://github.com/Senth/home-backlog/issues/101) was, now on
the first screen of every cold start. A one-shot path would mean writing the cache-only
hold and the retry ladder a second time.

`hooks/use-paired-listener.ts` is that pair — subscribe, retry, merge, hold — and both
`useNodes` and `useOverview`'s two pairs are built on it. The done pair closes over a `now`
taken at subscribe rather than tracked as a dependency: rebuilding the query on every tick
would tear the listener down and reopen it just as often, so `now` is whatever it was when
the pair last subscribed — which is exactly what the cards re-filter against on every
render. The pool pair closes over no time at all, which is one fewer way for a long-open
listener to drift.

`hooks/use-dashboard-cards.ts` does the same job for the three config surfaces, and merges
them into the one ordered list the screen renders plus the editor's view of the same data.
No listener is opened for the editor.

## The screen

### Placement

Overview is the first tab, ahead of Projects, Locations and Maintenance, which keep their
order below it. Three redirects land on it: `app/index.tsx`, `app/(auth)/_layout.tsx` once
sign-in resolves, and picking a home on `/homes`.

The landing route never depends on what is in the database. A rule like "open on Projects
until the first node exists" moves the app under a household the moment they create — and
delete — their first card.

### The cards get air, a board column does not

The scroller sets `space.lg` between its groups — the install offer and the cards — against
`space.md` within them. Overview's job is to answer *what is going on* at a glance, and
headed lists with the same gap inside and between them read as one block with headings in
it rather than as separate answers.

This is a **per-route** call, not a global one. A board column's whole job is cards per
screen, and spending the same vertical pixels there buys separation nobody asked for at the
cost of the thing the column is for. `docs/DESIGN.md` records the split so it is not
re-argued as a finding on the next design pass.

### Chrome

`Appbar.Header` copies the root board's: a `BackAction` to `/homes`, `Appbar.Content` titled
the active home's name, and `AccountMenu`. **The app bar names the home, not the screen** —
the tab bar already names the screen, and Overview is the highest-risk place in the app for
recording cabin work on the house board, with no breadcrumb to lean on.

It gains one action, a tune icon, opening the editor. That is the only chrome the cards add
to the read screen; there is still no `BoardMenu` and no filter to toggle, because a card
*is* the filter and it is edited elsewhere.

### Rows

Each card is a `List.Subheader` heading over `List.Item` rows, separated by `space` tokens.
A row carries the title and the meta the card face already carries: `board.steps` for a
project with children, the `DueChip` for one that is late or due soon, and the *Waiting*
mark for a card whose blockers are unresolved — the card's own components, so the two
surfaces cannot disagree about what a due date or a blocker says. Tapping a row goes where
a board card's tap goes: the board if it has steps, the details screen if not.

**Overdue is words, never colour.** [`boards-and-nodes`](boards-and-nodes.md) settled that
on the card face — nothing in the app acts on a due date yet, so a red chip is pure guilt
for a deadline nothing will remind anyone about, and words survive 200% text and colour
blindness.

### The per-card menu, and overflow

Each card header carries a menu: *Edit*, *Hide for me* or *Show for me* on a shared card,
*Copy as text*, *Move up* / *Move down*, and *Remove*. It is an `IconButton` opening a
`Menu` rather than always-visible chrome, because the read screen is read-first and the
arranging lives one tap in. Remove asks first, and says the built-in cards can be restored
in the editor, because "gone forever" and "restorable" are not the same word.

Past `shown` rows a card renders one control reading `+{{count}} more`, which expands it in
place from data already held; expanded, it reads *Show less*. No navigation — there is no
cross-board dated screen to land on, and inventing one is a different issue. The count is
exact for what the card holds, and what a card holds is `max`.

### Empty, and the first run

Each pair holds independently on `isQueryAnswer`, so a cache-only empty snapshot is "I do
not know yet" rather than "there is nothing", and nothing renders until the config and the
roots are answered — a heading over a gap is indistinguishable from an empty card, and this
screen has seven of them.

A card that is genuinely empty says its own sentence, or is absent if its `empty` says so.
When every card is empty **and the home holds no root at all**, the whole screen is replaced
by one line — *Nothing here yet. Add the first project.* — rather than seven boxes each
explaining that the household has nothing.

The root count is what keeps that line honest, and it is not redundant with the empty cards.
Two ordinary states empty every card while the house is full: every project sitting in To do
or Next up, undated, with nothing finished this month; and a member who is on none of the
household's roots, where root-scoped hiding empties the screen by design.
[`boards-and-nodes`](boards-and-nodes.md) settled that a "nothing here yet" the household
can disprove is the kind of lie people stop trusting a screen for — and unlike the board,
Overview carries no filter control to disprove it with. In both states the cards say what is
true instead. The count is taken over every unarchived root the pair returned, *before* the
hide predicate, which is what makes the second case say *Nothing in progress* rather than
*Add the first project*.

The first-run line is also never shown while anything failed: "add the first project" and
"could not load" are contradictory instructions, and only one of them is true.

### When a listener fails

A pair that has spent its retry ladder says so — `overview.loadFailed` over a `common.retry`
button — rather than rendering as empty. "Nothing coming up" is the wrong answer to "I could
not ask".

It is reported **once per pair, not once per card**. The roots pair fails the whole screen,
because every card's hide predicate reads it. The pool pair's failure is said once above the
filter cards, which are not rendered; the completed card reads the done pair and still
renders. The done pair's failure is said where that card would have been. A failed config is
the whole screen too, since without it there are no cards. Seven copies of one sentence over
seven buttons that reopen the same listener is one failure reported as seven.

### The editor

A dedicated screen pushed over Overview, reached from the tune action or a card's *Edit*.
It lists every card in the merged order with a scope badge, and a hidden shared card is
shown here, badged *Hidden*, so hiding is never a card you cannot get back.

Reordering is the board's own drag (`DragArea`), with *Move up* / *Move down* in each card's
menu as the accessible alternative — the drag-plus-controls pairing boards already
established. A drag writes one rank, `rankBetween` the neighbours, on the surface the card
lives on.

The app bar carries *Add card* and *Import card*. Below the list, a *Removed originals*
section lists the seeds this person deleted, each with *Restore*, re-created from `seedId`
with its original settings. That section is the reason seeding never diffs: the seeds can
come back, but only when asked for.

### Editing a card

A sheet over the editor: the title, the scope as three segmented buttons, the conditions as
chip groups one field at a time, the sort as a field and a direction, and steppers for rows
shown and rows held. Off the read screen, filter vocabulary is allowed to be precise —
*Late*, *Coming up*, *Not late*, *No date* — because the person here is composing a filter
and the words have to mean what they do.

An untouched seed's title field is empty with a hint saying it uses its default name; typing
gives the card its own.

Changing the scope moves the card: it is written to the new surface and deleted from the old
one, in one batch, because scope is storage.

Import is a `Portal` dialog with a paste field, a decoded preview of the title and the
conditions, and Add. Invalid strings get one sentence, never a stack trace.

### Adding

A `FAB` labelled *Add a project* opens the board's own `TitleDialog` and calls `createNode`
with `parent: null`, `status: 'backlog'`, `rank: rankAtEnd(...)` over every root there is,
and `participantIds` set to every member of the home — the root board's own create, because
a shared project is born with the whole household on it. Naming a destination column, as
the board's FAB does, would name something Overview does not show; and Overview shows no
columns, so "the end" can only mean after every root, which is where the board's own create
would have put it too.

The FAB stays the screen's one primary action: the cards added a tune icon and per-card
menus, and none of them competes with it. It is why moving Projects to the second tab does
not lengthen the path for the person whose only write is "add the one thing I just noticed".
The first-run line points at it rather than carrying a second button for the same action.
The screen reserves space under it from the FAB's *measured* height, because the label is
words and so is taller in Swedish, and taller again at 200% text.

**It carries the board FAB's two footprint caps**, for the same reason and from the same
token: `maxWidth` at `fab.widthShare` of the window, and the plus glyph dropped below
`denseBreakpoint` so a wrapped Swedish label keeps the words without overflowing the button.
Overview is the screen the app opens on, so it is where a button that spans the screen would
be met first.

### Offline

The node listeners are Firestore listeners, so a cached Overview renders offline, and a
queued create appears in the Ongoing projects card the moment Firestore applies it locally.
Every card write is a Firestore document write, so the offline queue carries it exactly like
a node edit, and a shared card edited offline by two members reconciles the same way two
node edits do. Export and import are clipboard-local and need no connection at all.

## Strings

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
| `overview.done.title` | Recently done | Nyligen klart |
| `overview.more` | +{{count}} more | +{{count}} till |
| `overview.less` | Show less | Visa färre |
| `overview.empty` | Nothing here yet. Add the first project. | Inget här ännu. Lägg till första projektet. |
| `overview.add` | Add a project | Lägg till projekt |
| `overview.loadFailed` | Could not load this. Check your connection. | Kunde inte ladda det här. Kontrollera din anslutning. |

The cards add one namespace, `overview.cards.*`: the four seed titles (*Quick wins* /
*Snabba vinster*, *A few hours* / *Några timmar*, *Needs splitting* / *Behöver delas upp*,
*Needs an estimate* / *Behöver en uppskattning*), the empty sentences, the card menu, the
editor, and the condition and sort words. Condition labels reuse the detail screen's
strings wherever one exists — priority, effort, status names, the assignee and participant
wording — so a card is edited in the same words the card itself is edited in.

Three of those strings were argued over and are what they are on purpose:

- **The scope words are three short ones.** *All homes* / *Home* / *Everyone*, not *All my
  homes* / *Only this home* / *Everyone here*: the segmented control is three labels across
  390px, and the long forms wrapped or truncated in Swedish at 200% text. The middle one is
  the risk — *Home* beside a screen that will not say "home" for the household — and it
  survives because it sits inside a scope control whose other two options are about homes,
  where it can only mean this one.
- **The empty sentences carry a tone each.** *Nothing needs splitting up.* is good news.
  *Set the time needed on a task and the quick ones land here.* is an invitation with no
  guilt in it. *Nothing matches this card.* is what every other card gets, because a card
  the person wrote themselves needs a fact, not encouragement.
- **`overview.empty` deliberately mirrors `board.empty`** — "Nothing here yet. Add the first
  card." — because it is the same sentence about a different thing.

`overview.loadFailed` names neither the card nor the query. It is rendered at four scopes,
and a sentence that named which would have to be four sentences to stay true at all of them.

The Swedish heading for Recently done is *Nyligen klart*, not *Senaste gjorda*. The first
draft was the one heading of the three that read as a translation: an adjectival noun with
its head noun cut off, the register of a column label rather than of a person, beside
*Pågående projekt* and *Kommande* which are both plain Swedish.

Reused unchanged: `board.steps`, `board.dueLate`, `board.dueSoon`, the waiting mark's own
string, `common.retry` on the failure button, `homes.title` for the back action, `install.*`,
and everything `TitleDialog` already owns.

## Out of scope

- **OR conditions, and nesting.** All seven seeds are AND-only, and the day a real filter
  needs OR is the day to design one.
- **A screen-wide "each row at most once"**, rejected above with the Coming up / Ongoing
  seam accepted in its place.
- **A subtree condition** — *everything under this project* — which is the per-project card
  a household would compose next. Filed as
  [#180](https://github.com/Senth/home-backlog/issues/180).
- **A `labels` condition**, waiting on [#100](https://github.com/Senth/home-backlog/issues/100)
  to add the field.
- **API access to the cards.** An agent can neither read nor write card config: the three
  surfaces are new, and the REST story ([`rest-api`](rest-api.md)) catches up later,
  deliberately.
- **Server-side filtering, or an index per card shape.** Never available; the upgrade path
  is SQL, argued under the pool.
- **Recurring maintenance instances**
  ([#57](https://github.com/Senth/home-backlog/issues/57)). They are nodes with due dates,
  so they join Coming up as data, not as code.
- **A whole-project progress bar**, and **`completedBy` attribution**, both rejected above.
- **Suggestions** ([#55](https://github.com/Senth/home-backlog/issues/55)), now rescoped to
  a sort option this screen does not own, and the **calendar view**
  ([#67](https://github.com/Senth/home-backlog/issues/67)).
- **Desktop layout.** Overview is the phone layout stretched until
  [#31](https://github.com/Senth/home-backlog/issues/31) says otherwise.
