# Overview

The screen the app opens on. It answers *what is going on* without making anyone pick a
board first: the projects in progress, what is coming up or already late, and what
recently got done.

Every other screen in the app makes you choose a board before it tells you anything, so
the household's own question — *is anything on fire, and did we get anywhere* — had no
screen. Overview is that screen, it is the first tab, and it is the landing route, because
a summary you have to navigate to is a summary nobody reads.

It owns no data of its own. Every row is a node
([`boards-and-nodes`](boards-and-nodes.md)), rendered with the card face's own meta, and
every tap lands where a board card's tap lands.

## Named Overview, never "home"

*Overview* / *Översikt*. **Home** is the household you are in
([`home-and-members`](home-and-members.md)), and two meanings of one word on the screen
that shows which home you are in is the one place the app cannot afford it. "Dashboard
home" was rejected for the same reason.

## The three sections

- **Ongoing projects** — roots with `status === 'execution'`, in the board's own `rank`
  order. Roots, not every node in execution at any depth: "ongoing project" is a question
  about projects, and a list that mixes *Renovate bathroom* with *order tiles* answers
  neither.
- **Coming up** — anything dated that is late or due within `soonInDays`, oldest first,
  except a root Ongoing projects is already showing.
- **Recently done** — anything completed in the last `doneWithinDays` (30), newest first.

`models/overview.ts` holds all three as pure functions over `Node[]`, and they are unit
tested without Firestore. The queries bound what *can* arrive; these decide what is
*shown*, and the overlap is deliberate — a listener stays open for hours, so the `now` a
query was built with drifts, and a card due in seven days is still in the result set eight
days later. Re-asking the question on every render is what keeps a section agreeing with
its own heading.

The sections are fixed. A household eventually composing them as filters — "fun label,
under 30 minutes", "everything with no estimate" — needs custom labels
([#100](https://github.com/Senth/home-backlog/issues/100)) first, and building
configurability before there is anything to configure would build the filter engine twice.
What the design owes that future is only that a fourth section costs a list entry, not a
rewrite.

### Coming up is not "Upcoming maintenance"

Recurring maintenance ([#57](https://github.com/Senth/home-backlog/issues/57)) does not
exist yet, so there is no `recurring` collection to read. A section named *Upcoming
maintenance* holding "order gravel" and none of the gutters, hedge or service intervals
teaches the household that the app forgot the season calendar, rather than that it was
never built. When #57 ships, its spawned instances are nodes with due dates and join this
section under the name it already has.

### Coming up never repeats a row Ongoing projects is showing

An in-progress root that is overdue would otherwise fill a row in both, with the same
title and the same *26 days late* chip, on a screen that holds fifteen rows at its cap —
one project taking two of the five rows a section has, and the single thing in the house
that is late said twice in one glance. That is the guilt this screen refuses to carry in
colour arriving through repetition instead.

**Showing, not holding.** The comparison is against Ongoing projects' first five rows —
the ones on screen, in the `rank` order the household chose — not against everything the
section holds. A sixth in-progress project that is overdue sits behind `+N more`, so
deduping it against the whole list would take it off the screen altogether: not visible in
Ongoing projects, and dropped from the one section that sorts late-first and would have
put it at the top. *Is anything on fire* is the question this screen exists to answer, and
that is the answer disappearing.

Expanding Ongoing projects past five can therefore surface a row that is also in Coming
up. That is the better half of the trade: it costs a deliberate tap, it puts the two a
section apart, and the alternative loses the row in the state the screen is almost always
in.

Only the root is ever a duplicate. Its dated *step* is a different row saying a different
thing, and Ongoing projects never shows steps.

### Nothing here is counted

**Recently done carries titles and nothing else** — no total, no streak, no per-person
tally. A number turns encouragement into a grade, and a "0 completed" empty state is
precisely the guilt the app exists to remove, which is why the section is *absent* rather
than empty when it holds nothing.

For the same reason it does not name who finished each item. Attribution would make one
person's four items visible beside another's forty, which is a scoreboard — and there is
no `completedBy` field, only `completedAt`, so it would also cost a new `Node` field, a
`validNode()` case and a REST API change to build the thing we do not want.

**Recently done names no window either**, in either language, so the heading can never
disagree with the query the way "the last 30 days" would.

### No progress bar

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
node it would hide a personal project from Ongoing projects while that project's dated
step still landed in Coming up and its finished step in Recently done — the screen
contradicting itself within one scroll.

So `hiddenByRoot` hides a node when **its root** is hidden, resolved through
`ancestorIds[0] ?? node.id` against the roots the screen already holds. A node whose root
is not among them is hidden. That is mostly a state that should not exist — the roots pair
is answered before any section renders — but one real case reaches it: a private step you
are a participant of, under a private root you are not on and therefore cannot read.
Leaking somebody's private work is the worse of the two failures.

**No toggle, and no "n more are hidden" line.** A summary with a filter control on it is a
board, and the board one tab over already has both.

## Queries

Six listeners, not eight, because root-scoped hiding and Ongoing projects want the same
data: every unarchived root. That is the root board's own pair — already written, already
indexed, already wrapped in `useNodes(homeId, null)`. Ongoing projects is a client-side
`status === 'execution'` filter over it, so Overview adds no query and no index for its
first section.

Every section needs the read rule's two disjuncts as two queries — Firestore rejects a
whole query if any matching document could be denied — so a section is a pair, not a
query. Three sections would be six pairs' worth of temptation on the screen the app opens
on, and listener breadth is the cost risk in this app.

### Roots — Ongoing projects, and the hide scope

```
Q1  archived == false && parentId == null && visibility == 'shared'            orderBy rank
Q2  archived == false && parentId == null && participantIds array-contains me  orderBy rank
```

Merged and deduped by `mergeNodeResults`, which sorts by `(rank, id)`. Existing indexes
cover both.

### Coming up

```
Q3  archived == false && completedAt == null && visibility == 'shared'
    && dueDate >= '' && dueDate <= <today + soonInDays>      orderBy dueDate asc, limit 20
Q4  archived == false && completedAt == null && participantIds array-contains me
    && dueDate >= '' && dueDate <= <today + soonInDays>      orderBy dueDate asc, limit 20
```

Three things in that shape are load-bearing:

- **`dueDate >= ''` is a belt beside a brace, not the brace.** Firestore orders values by
  type before value — `Null < Boolean < Number < Timestamp < String` — which is the reason
  to fear that `dueDate <= <cutoff>` alone returns every node in the home with no due date
  at all. Asked of the emulator, it does not: an inequality filter is already scoped to
  its own type, so the upper bound excludes the null class by itself and this lower bound
  is a no-op today. It is kept because the empty string is the smallest string, so it
  costs nothing and no index, and because "every undated card in the house" is what this
  listener degrades to if that type-scoping ever stops holding. `tests/rules/` asserts the
  exclusion **both with and without the bound**, against the real thing rather than
  against either reading — that pair of cases is what would notice the day it changes.
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
excludes not-done nodes by itself. The bound is an instant rather than a calendar day,
because `completedAt` is a `Timestamp` and nothing about a completion is timezone-shaped —
where `dueDate` is a calendar day, and Coming up's cutoff is one.

### Indexes

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

### Rules

Overview adds nothing to `firestore.rules`. Every query above is composed of fields the
rules already validate, and each is permitted by one of the two disjuncts of the existing
node read grant. `tests/rules/firestore.test.ts` proves it: that each of Q3–Q6 is
permitted and returns what it should, and that the one-query variant of each dated section
— the same filters without the `visibility` / `participantIds` clause — **fails**, which
is what makes the pair necessary rather than stylistic.

### Why listeners rather than one-shot reads

`subscribeWithRetry` and `isQueryAnswer` are what stop an empty cache reading as an empty
house — the failure [#101](https://github.com/Senth/home-backlog/issues/101) was, now on
the first screen of every cold start. A one-shot path would mean writing the cache-only
hold and the retry ladder a second time.

`hooks/use-paired-listener.ts` is that pair — subscribe, retry, merge, hold — and both
`useNodes` and `useOverview`'s two dated pairs are built on it. A dated pair differs from a
board's in one way only: Q3–Q6 close over a `now`, taken at subscribe rather than tracked
as a dependency. Rebuilding the query on every tick would tear the listener down and
reopen it just as often, so `now` is whatever it was when the pair last subscribed — which
is exactly what the section selectors re-filter against on every render.

## The screen

### Placement

Overview is the first tab, ahead of Projects, Locations and Maintenance, which keep their
order below it. Three redirects land on it: `app/index.tsx`, `app/(auth)/_layout.tsx` once
sign-in resolves, and picking a home on `/homes`.

The landing route never depends on what is in the database. A rule like "open on Projects
until the first node exists" moves the app under a household the moment they create — and
delete — their first card.

### The sections get air, a board column does not

The scroller sets `space.lg` between its groups — the install offer and the three sections
— against `space.md` within them. Overview's job is to answer *what is going on* at a
glance, and three headed lists with the same gap inside and between them read as one block
with headings in it rather than as three answers.

This is a **per-route** call, not a global one. A board column's whole job is cards per
screen, and spending the same vertical pixels there buys separation nobody asked for at the
cost of the thing the column is for. `docs/DESIGN.md` records the split so it is not
re-argued as a finding on the next design pass.

### Chrome

`Appbar.Header` copies the root board's exactly: a `BackAction` to `/homes`,
`Appbar.Content` titled the active home's name, and `AccountMenu`. **The app bar names the
home, not the screen** — the tab bar already names the screen, and Overview is the
highest-risk place in the app for recording cabin work on the house board, with no
breadcrumb to lean on. No `BoardMenu`: there is no filter here to toggle.

`InstallCard` renders here rather than on Projects. The PWA install offer belongs on
whatever the app opens on; left behind a tab tap, the member who never opens Projects is
never asked. It sits inside the scroller rather than pinned under the app bar, so on the
browsers that fire `beforeinstallprompt` it scrolls away instead of holding a phone's
worth of height for a one-time offer ([`platform-offline`](platform-offline.md)).

### Rows

Three sections in a scrolling `View`, each a `List.Subheader` heading over `List.Item`
rows, separated by `space` tokens. A row carries the title and the meta the card face
already carries: `board.steps` for a project with children, and the `DueChip` for one that
is late or due soon — the card's own component, so the two surfaces cannot disagree about
what a due date says. Tapping a row goes where a board card's tap goes: the board if it
has steps, the details screen if not.

**Overdue is words, never colour.** [`boards-and-nodes`](boards-and-nodes.md) settled that
on the card face — nothing in the app acts on a due date yet, so a red chip is pure guilt
for a deadline nothing will remind anyone about, and words survive 200% text and colour
blindness.

### Caps and overflow

Each section shows **five** rows. Past that it renders one control reading `+{{count}}
more`, which expands the section in place from data already held; expanded, it reads *Show
less*. No navigation — Coming up and Recently done have no cross-board dated screen to
land on, and inventing one is a different issue.

Ongoing projects' count is exact, because its query is unlimited. Coming up and Recently
done count against their `limit(20)` — **per half**, so a section is capped at forty in
the worst case and at twenty whenever the two halves overlap completely, which is what a
household with nothing private looks like. The count is always exact for what the section
actually holds; what is bounded is what can arrive. That ceiling is deliberate: twenty
rows is already past what a summary can be, and lifting it trades a bounded listener for
rows nobody reads.

### Empty, and the first run

Each section holds independently on `isQueryAnswer`, so a cache-only empty snapshot is "I
do not know yet" rather than "there is nothing", and a section that is still loading
renders nothing rather than a heading over a gap — a heading with nothing under it is
indistinguishable from an empty section, and this screen has three of them.

A section that is genuinely empty behaves by what its emptiness *means*:

- **Ongoing projects** says *Nothing in progress.* — an answer the household wants.
- **Coming up** says *Nothing coming up.* — so is that.
- **Recently done** is **absent**, for the reason above.

When all three are answered and empty **and the home holds no root at all**, the whole
screen is replaced by one line — *Nothing here yet. Add the first project.* — rather than
three boxes each explaining that the household has nothing.

The root count is what keeps that line honest, and it is not redundant with the three
empty sections. Two ordinary states empty all three while the house is full: every project
sitting in To do or Next up, undated, with nothing finished this month; and a member who is
on none of the household's roots, where root-scoped hiding empties the screen by design.
[`boards-and-nodes`](boards-and-nodes.md) settled that a "nothing here yet" the household
can disprove is the kind of lie people stop trusting a screen for — and unlike the board,
Overview carries no filter control to disprove it with. In both states the sections say
what is true instead. The count is taken over every unarchived root the pair returned,
*before* the hide predicate, which is what makes the second case say *Nothing in progress*
rather than *Add the first project*.

The first-run line is also never shown while anything failed: "add the first project" and
"could not load" are contradictory instructions, and only one of them is true.

### When a listener fails

A section that has spent its retry ladder says so — `overview.loadFailed` over a
`common.retry` button — rather than rendering as empty. "Nothing coming up" is the wrong
answer to "I could not ask", and a section is two listeners of which only one has to fail.

The roots pair is the exception, and it is reported **once, for the whole screen**. Ongoing
projects *is* that pair, and the other two sections need it for the hide scope, so a roots
failure fails all three — and three copies of one sentence over three buttons that all
reopen the same listener is one failure reported as three. Each dated section's own retry
reopens the roots pair alongside its own, for the same reason it waits on it.

### Adding

A `FAB` labelled *Add a project* opens the board's own `TitleDialog` and calls `createNode`
with `parent: null`, `status: 'backlog'`, `rank: rankAtEnd(...)` over every root there is,
and `participantIds` set to every member of the home — the root board's own create, because
a shared project is born with the whole household on it. Naming a destination column, as
the board's FAB does, would name something Overview does not show; and Overview shows no
columns, so "the end" can only mean after every root, which is where the board's own create
would have put it too.

The FAB is why moving Projects to the second tab does not lengthen the path for the person
whose only write is "add the one thing I just noticed". The first-run line points at the
FAB rather than carrying a second button for the same action. The screen reserves space
under it from the FAB's *measured* height, because the label is words and so is taller in
Swedish, and taller again at 200% text.

**It carries the board FAB's two footprint caps**, for the same reason and from the same
token: `maxWidth` at `fab.widthShare` of the window, and the plus glyph dropped below
`denseBreakpoint` so a wrapped Swedish label keeps the words without overflowing the
button. Overview is the screen the app opens on, so it is where a button that spans the
screen would be met first — the cap belongs here at least as much as on the board.

### Offline

Nothing new. The listeners are Firestore listeners, so a cached Overview renders offline,
and a queued create appears in Ongoing projects the moment Firestore applies it locally.

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

`overview.empty` deliberately mirrors `board.empty` — "Nothing here yet. Add the first
card." — because it is the same sentence about a different thing.

`overview.loadFailed` names neither the section nor the query. It is rendered at two scopes
— one section, or the whole screen when the roots pair went — and a sentence that named
which would have to be two sentences to stay true at both.

The Swedish heading for Recently done is *Nyligen klart*, not *Senaste gjorda*. The first
draft was the one heading of the three that read as a translation: an adjectival noun with
its head noun cut off, the register of a column label rather than of a person, beside
*Pågående projekt* and *Kommande* which are both plain Swedish.

Reused unchanged: `board.steps`, `board.dueLate`, `board.dueSoon`, `common.retry` on the
failure button, `homes.title` for the back action, `install.*`, and everything
`TitleDialog` already owns.

## Out of scope

- **Quick wins — "what can I do in twenty minutes"**
  ([#56](https://github.com/Senth/home-backlog/issues/56)). The one thing a household would
  look for on this screen and not find, and the section list is built so a fourth section
  is a list entry rather than a rewrite. It needs `effort` to be worth reading.
- **User-composed sections and saved filters**, which need custom labels
  ([#100](https://github.com/Senth/home-backlog/issues/100)).
- **Recurring maintenance instances in Coming up**
  ([#57](https://github.com/Senth/home-backlog/issues/57)). They are nodes with due dates,
  so they join the section as data, not as code.
- **A whole-project progress bar**, and **`completedBy` attribution**, both rejected above.
- **A blocked mark on a row** ([#66](https://github.com/Senth/home-backlog/issues/66)) —
  built there since: a card waiting on another shows the waiting mark on its Overview row.
- **Suggestions** ([#55](https://github.com/Senth/home-backlog/issues/55)) and the
  **calendar view** ([#67](https://github.com/Senth/home-backlog/issues/67)), the two
  cross-board screens that come after this one.
- **Desktop layout.** Overview is the phone layout stretched until
  [#31](https://github.com/Senth/home-backlog/issues/31) says otherwise.
