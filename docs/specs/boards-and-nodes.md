# Boards and nodes

Every board, project, task and subtask in the app is the same document: a **node**, in
`homes/{homeId}/nodes`, hanging off the home that [`home-and-members`](home-and-members.md)
describes. A project, a task and a subtask differ only in depth, and any node with children
can be opened as a board.

This spec covers that document: its full field set, the invariants `firestore.rules`
enforces on it, the queries that load a board and a subtree, the indexes those queries
need, and the writes that create, edit, move and delete one. It also covers the screens
that render it: the projects board, drill-down with breadcrumbs, and everything a card can
do.

## The shape of it

One flat collection, `homes/{homeId}/nodes`, with `parentId` and a denormalized
`ancestorIds[]`. A board is the children of one node, or of the root, where `parentId` is
`null`. Depth is derived from `ancestorIds.length`, never stored.

Two hierarchies cross here and neither is a parent of the other: the project tree
(`parentId` / `ancestorIds`) answers *what*, and the location tree (`locationId` /
`locationAncestorIds`) answers *where*. A node moving in one never moves in the other.

A node is a board because it has children, derived from a stored `childCount`. See
[Board-ness is derived](#board-ness-is-derived-never-flagged). Everything a node carries
that is not its title lives on its [detail screen](#node-detail).

## Data

### `homes/{homeId}/nodes/{nodeId}`

Every field is written on create, with the default below.

| Field | Type | Default | Notes |
| ----- | ---- | ------- | ----- |
| `title` | `string` | — | 1–200 characters |
| `status` | `Status` | `'backlog'` | `backlog` `next_up` `execution` `done` |
| `columns` | `Status[]` | by depth, see below | the column set of the board this node's children form |
| `childCount` | `number` | `0` | direct children; clamped to ≥ 0 on read |
| `doneCount` | `number` | `0` | direct children with `status == 'done'` |
| `rank` | `string` | `rankAtEnd(last)` | fractional index, ordered within `(parentId, status)` |
| `parentId` | `string \| null` | `null` | `null` is a root node |
| `ancestorIds` | `string[]` | `[]` | root → parent; the last element equals `parentId` |
| `locationId` | `string \| null` | parent's | inherited unless overridden |
| `locationAncestorIds` | `string[]` | parent's | denormalized location path |
| `participantIds` | `string[]` | `[]` | whose project this is: set on a root; on a private node, the access list |
| `assigneeIds` | `string[]` | `[]` | who is doing this node: per node, inherited by nothing, read by no rule |
| `visibility` | `'shared' \| 'private'` | parent's, else `'shared'` | equals the parent's, always; only a root sets it |
| `dueDate` | `string \| null` | `null` | `'YYYY-MM-DD'` |
| `priority` | `Priority \| null` | `null` | `low` `normal` `high` `urgent` |
| `blockedBy` | `string[]` | `[]` | node ids; [#66](https://github.com/Senth/home-backlog/issues/66) |
| `notes` | `string` | `''` | ≤ 10 000 characters |
| `checklist` | `ChecklistItem[]` | `[]` | `{ id, text, done }`, ≤ 200; [#52](https://github.com/Senth/home-backlog/issues/52) |
| `effort` | `Effort \| null` | `null` | `quick` `hours` `evening` `weekend` `multi_week` |
| `photos` | `Photo[]` | `[]` | `{ id, path, uploadedAt, uploadedBy }`, ≤ 50; [#53](https://github.com/Senth/home-backlog/issues/53) |
| `archived` | `boolean` | `false` | constrains every board query |
| `createdVia` | `'app' \| 'api'` | `'app'` | written at creation, immutable; absent on a node older than the field, which reads as `'app'`. See [`rest-api`](rest-api.md) |
| `completedAt` | `Timestamp \| null` | `null` | set if and only if `status == 'done'` |
| `createdAt` | `Timestamp` | `serverTimestamp()` | immutable |
| `createdBy` | `string` | uid | immutable |
| `updatedAt` | `Timestamp` | `serverTimestamp()` | staleness input for [#55](https://github.com/Senth/home-backlog/issues/55) |

`Priority` and `Effort` are string ids with an ordinal map (`priorityOrder`,
`effortOrder`) beside them, so sorting and scoring never depend on the id's spelling and a
new value needs no migration. That is the same reason `status` is a string id. `effort`'s
ids are semantic (`quick`, `evening`) rather than duration-shaped, because "an evening" has
no numeric form and retuning "< 2 h" must not become a migration.

`photos[].path` is a Cloud Storage path, never a download URL. URLs carry tokens that
rotate.

### Three questions about people, three fields

They get confused with each other constantly, and the document had a field for only one of
them:

| Question | Field | Scope | Read by a rule? |
| --- | --- | --- | --- |
| Whose project is this? | `participantIds` | root only | only when private |
| Who is doing this card? | `assigneeIds` | this node | never |
| Is this anyone else's business? | `visibility` | root only | yes |

`participantIds` was already load-bearing: it is the ACL a private read rule consults, and
it is what board query Q2 constrains. It could not *also* become "who is doing this card"
without dragging assignment into the security model, and without making "my tasks" return
every card in every project you are involved in, which in a two-person household is close
to everything. So `assigneeIds` is its own field, and the split has a second payoff: an API
key ([#7](https://github.com/Senth/home-backlog/issues/7)) that may write `assigneeIds`
cannot revoke anybody's access, where one that may write `participantIds` can.

**`participantIds` and `visibility` are both root-only.** Both answer a question about a
*project* rather than about a step inside one, so a household that learns the rule once has
learned it for both, and neither ever needs a greyed-out inherited row on a descendant.

*Rejected:* one field for both people-questions. It is the confusion this exists to fix,
and it makes assignment a permission change.

*Rejected:* participants editable at every depth, inherited and greyed below. It needs the
ancestor named and linked on every card to not be a dead end. And if the inherited value
were *stored*, editing participants on a thirty-card project becomes a second top-down
subtree cascade with the same half-failure problems as the visibility flip.

*Rejected:* participants per node with no inheritance at all. The default-hide predicate
then bites unpredictably on drill-down boards, hiding individual steps from people who can
see the project they are in.

`assigneeIds` needed no backfill, and that is a real difference from `archived` rather
than an oversight. The absent-field trap bites a field a query must match *negatively*; an
`array-contains` clause matches neither an absent field nor an empty array, and a document
written before the field existed has no assignees. `toNode` reads it as `[]` and that is
the whole migration.

### A field that is absent can never be queried

Firestore does not index absent fields, so `where('archived', '==', false)` silently skips
every document written before `archived` existed. Adding a *queried* field later is a
backfill, not a schema change.

That is why `archived` and `completedAt` are written from the first document even though
[#64](https://github.com/Senth/home-backlog/issues/64) and
[#54](https://github.com/Senth/home-backlog/issues/54) own the features that use them, and
why `completedAt` in particular could not wait. A completion date is not reconstructible
after the fact, and deriving it from `updatedAt` is wrong the moment anyone edits a
finished node.

`columns` is the one field that could safely arrive later, and did: it is only ever read
with the document it sits on and is never queried, so it needed no backfill and no index.
Every other field was there from the start.

*Rejected:* writing only the mandatory fields and defaulting the rest client-side. It
saves ~200 bytes per document and buys the absent-field trap on every optional field.

*Rejected:* writing all fields with no index tuning. Index entries, not document bytes,
are the cost. See [the index](#storage-cost-lives-in-the-index-not-the-document).

### `blocked` is not a status

The vocabulary is four values. **Being blocked is a condition, not a stage.**

A card is in exactly one status, so parking one in Blocked destroys the stage it was in,
and nothing says where it goes when the blocker clears. `blockedBy[]` already exists on the
document and is already the actionability test the suggestion engine
([#55](https://github.com/Senth/home-backlog/issues/55)) uses, so the condition has a home
that is not `status`: the card stays in its real column and shows a mark. Nothing in the UI
writes `blockedBy` yet, which is
[#66](https://github.com/Senth/home-backlog/issues/66), so it arrives from the REST API
or a fixture until then.

*Rejected:* keeping `blocked` in the enum and merely not displaying it. A value nothing
writes and nothing shows is a trap for the REST API
([#7](https://github.com/Senth/home-backlog/issues/7)) and for whoever reads the enum next.

`toNode` coerces an unrecognised status to `backlog`, so a document carrying the old value
renders in To do rather than crashing a board.

### Find out, Plan and Check are cards, not stages

`research`, `planning` and `review` were in the enum and are not any more
([#99](https://github.com/Senth/home-backlog/issues/99)). They read as *Find out*, *Plan*
and *Check*, and living with them showed the mistake. Finding out whether the gutter vents
to the soffit is a step you put In progress and finish, not a stage the gutter job passes
through on its way to done. Nobody dragged a card across them. Three of the seven
columns stood empty on every board and cost the four that were used their width, which on
a 390 px phone showing one column at a time is three extra swipes to reach Done.

Removing them is the same argument `blocked` lost, run the other way: a value nothing
writes and nothing shows is a trap for the REST API and for whoever reads the enum next.

**Removing a status is a migration, and `blocked` was not.** `blocked` was gone before the
first document was written; these three were in production data. The rules check
`request.resource.data`, the *full post-update* document, so the moment `allStatuses()`
lost a value, every node still holding one would have had every update to it denied,
including the `childCount` bump that adding a step to the project above it performs, and
there is no admin tooling in this repo to unstick it. So the order is fixed: migrate every
stored `status` and every stored `columns` entry first, then ship the narrower rules.
`functions/scripts/migrate-99-statuses.mjs` is that migration, and `OPERATIONS.md` carries
the runbook, including the second `--apply` after the deploy lands, which catches anything
the still-live old build wrote in between. `toNode` also maps the three to `execution` on
read, which costs one lookup and covers the device holding a node it cached before the
migration; `backlog` would say a card in flight had never been started.

*Rejected:* leaving the three in the enum and hiding them in the UI. That is the trap
above, and it keeps the seven-wide column bound in the rules for columns no board draws.

*Rejected:* mapping them to `next_up` rather than `execution`. All three describe a card
somebody is holding right now, and Next up says nobody has picked it up yet.

### The column set is the same everywhere, then frozen

`columns` is the column set of the board formed by a node's children, taken from
`defaultColumns` when the node is created and then frozen. `defaultColumns` is the whole
enum, at every depth.

It used to be chosen by the node's own depth (`ancestorIds.length`). Depth 0 got the full
stage set, all seven, and depth ≥ 1 the simple set `backlog` / `execution` / `done`,
because a research column whose cards each contain their own research column is nonsense.
With the stage columns gone, the two sets collapsed into one, and one set buys more than
the depth rule did. Every board reads the same, and a card keeps its column when it is
moved deeper, where before a `next_up` card moved into a task's board landed in a set that
had no Next up.

**The root board is not a document.** It cannot be moved, deleted or reparented, so there
is nothing for a freeze to protect. Its set is the `defaultColumns` constant in
`models/node.ts`. [#63](https://github.com/Senth/home-backlog/issues/63) is where a stored
root set earns its keep, and can put one on the home document.

*Frozen* means the app never recomputes `columns` when a node moves. It does not mean
immutable. The rules validate the shape and let the value change, because #63 is exactly
the feature that changes it, and locking it would make #63 a rules change before it could
be a screen.

*Rejected:* deriving the columns from the default at render time. It costs no field, and
then every later change to the default, and #99 was one, silently swaps the set under every
board that already exists, stranding each card sitting in a column the new set drops.

**A column that is not in the set still renders.** A board shows its frozen columns in
order, and any status *present in the data but absent from `columns`* gets an extra column
appended after them, in enum order (`visibleColumns`). It appears only while such a card
exists and disappears when the card is moved out; the move menu offers only the frozen
destinations, so it is a one-way exit. Without it, `Move under…` and a seeded fixture can
each put a `next_up` card on a board frozen without that column, one created before #99 or
one configured narrow by #63, and the board would render as though the card were not
there. A card that exists is visible somewhere, the same principle as the orphaned node the
visibility invariant exists to prevent.

The REST API refuses to create that state at all: a status outside the parent's frozen
`columns` is a `400`, naming the allowed set. The rules still permit any of the four,
because [#63](https://github.com/Senth/home-backlog/issues/63) is the feature that edits
column sets and locking it in the rules would make that a rules change before it could be a
screen. The API is stricter on purpose. A person putting a card in an appended column can
see the board they did it to, and an agent cannot. See [`rest-api`](rest-api.md).

### Board-ness is derived, never flagged

The card and the board were the same thing once: every card carried a chevron, and a tap
opened it as a board, empty or not. That made two claims that are not true of a
household's work: that "buy tile adhesive" is a board, and that finding out whether it
has anything in it is not worth knowing.

**Board-ness is derived from `childCount`**, through `hasSteps(node)` in `models/node.ts`
so that no screen reads the field directly. No children means no chevron, and a tap opens
the [details](#node-detail). One step means a chevron, and a tap drills in. There is no
flag, no *convert to a board* action and no *undo the conversion*, because there is
nothing to convert. A card becomes a board the moment it gets its first step, and stops
being one when the last step goes.

That shape was chosen over the two alternatives for what it removes rather than what it
adds:

- *Rejected:* **an `isBoard` flag the user toggles.** It needs vocabulary Ingrid must
  learn, and the app already says *Öppna som tavla*, so "tavla" becomes load-bearing
  rather than incidental. It needs an undo action that appears and disappears from the
  menu with the child count, which is the "tapped something and cannot find my way back"
  failure at menu level. It leaves `Move under…` undefined: auto-converting the
  destination makes the flag decoration, and refusing a leaf destination halves the reach
  of the one feature that exists so nobody re-types forty cards. And it is a property the
  REST API ([`rest-api`](rest-api.md)) must set correctly or every generated project lands
  as a leaf holding children.
- *Rejected:* **leaving the tap alone and hanging details off a second icon.** Zero new
  fields and the smallest possible change, but three tap targets on a 48px row, and a
  household's one card still opens a blank pane that reads as a bug rather than as an
  empty board.

With derivation, all four of those disappear at once. `Move under…` onto a childless card
simply works, because it has a child afterwards. There is nothing for the REST API to send.

### The counters are a display convenience, never an invariant

`childCount` and `doneCount` are denormalized and maintained by the client. Three things
make that affordable here rather than reckless:

1. **`increment()` is a server-side transform.** It queues offline like any other write
   and it commutes, so two people adding a step to the same project from two sheds both
   land.
2. **Counts cannot diverge per viewer.** Every child of a node shares that node's
   visibility, so anyone who can read the parent can read all of its children, the same
   property that made a hidden child unacceptable, paying off in the other direction.
3. **`privacyUnchanged()` already exists.** A counter bump moves neither `parentId`,
   `visibility` nor `participantIds`, so the rules skip the parent `get()` and the write
   costs nothing against a batch's twenty-document-access budget.

Drift is still possible: a client crashing between two halves of a batch, or a future
REST writer that forgets. It is asymmetric, and only one direction matters:

| Drift | Effect |
| ----- | ------ |
| too high | a chevron on a childless card; you drill in and find an empty board |
| too low | a card with children shows no chevron |

The second could hide work, so it is closed by construction rather than by care. **The
detail screen's Steps section runs the real board queries**, `parentId ==` this node, the
same two, the same index, and lists the true children whatever the counter says. A card
that has lost its chevron still opens its details, and its steps are there, with *Open
board*. A card that exists is reachable somewhere, which is the same principle the
visibility invariant is built on.

For the same reason the rules do not bound the counters. `doneCount >= 0` looks correct
and is a trap. One device offline marks a step done while another deletes that step, and
the transformed value can dip below zero, which would reject the whole batch and fail a
*delete*, an operation whose atomicity this area is built around. The rules check
`is int` and nothing more; `toNode` clamps on read.

### Steps are counted, not drawn as progress

The card face shows `2/5` where there are steps. A count of direct steps is a fact. A
progress bar is a claim about the project, and on nested work it is a false one. A
bathroom with five children that each have six subtasks reads *1 of 5* when 20 of 30 real
jobs are done. Marcus reads that as broken once and stops reading bars.

An honest bar needs whole-subtree counts: `descendantCount` incremented across every id
in `ancestorIds` on create, delete and reparent. That puts a fan-out write on exactly
the three paths that already carry the delicate invariants. That is its own issue.

The count never drives the parent's status. `PROJECT.md` settled that: derived status
makes it impossible to say a project is parked while its tasks look active. The counts may
inform the [#65](https://github.com/Senth/home-backlog/issues/65) nudge later; they never
set a column.

## Privacy is uniform across a subtree

**A node's `visibility` equals its parent's. Only a root node, one whose `parentId` is
`null`, sets it.** A private node's `participantIds` must also contain all of its parent's.

This is less a rule about privacy than the rule that makes privacy *queryable*. Firestore
has no field-level read rules. A document is readable or it is not, so there is no way to
expose a node's id and hide its title. And a query may contain only one `array-contains`
clause, so `ancestorIds array-contains X && participantIds array-contains me` is not
expressible. Without the invariant, no client query can see another member's private
descendant. A reparent then leaves it with stale `ancestorIds`, and a delete orphans it
permanently, with no error anywhere and no way to find it afterwards.

With the invariant, both subtree reads are provably safe *and* complete:

| Subtree of | Query | Complete because |
| --- | --- | --- |
| a shared node X | `ancestorIds ⊕ X && visibility == 'shared'` | a shared node's descendants are all shared, transitively |
| a private node X | `participantIds ⊕ me`, `ancestorIds` filtered client-side | I am a participant of every descendant of a private node I can read |

The cost is a product restriction: **a private card cannot live inside a shared project.**
It sits at the root, or under another private card.

**Private is not "mine alone."** `participantIds` on a private node *is* the access list,
and it has always been allowed to hold several people. A private project is therefore *the
people on it*: two members planning something for a third in the same household have no
other way to express it, and the "Celebration as its own private project" example below
assumes exactly that. The one thing that cannot happen is a member writing themselves out.
`allow update` requires `visibleToMe(request.resource.data)`, so a private document whose
participants do not include the writer is denied on create and update alike. There is no
lockout path to defend against, only a bare permission error to avoid, by writing the actor
in.

*Rejected:* private means one person, convert to shared to involve anyone. Simpler to say,
and it removes the only expression the surprise-planning case has.

That restriction is worth having on its own merits. A hidden child makes its parent lie.
One member sees eight subtasks and another sees seven, so every count derived from children
diverges per viewer: progress, location roll-ups, and the "all 8 subtasks are done, move
this to Done?" nudge ([#65](https://github.com/Senth/home-backlog/issues/65)). A private
*project* is cleanly absent for everyone not in it. "Celebration" as its own private
project is the honest shape of what a private card was reaching for.

`newNodeData()` upholds both halves by construction. A child takes its parent's
visibility whatever the caller asked for, and a child of a private parent starts with that
parent's participants, so the rules are the backstop rather than the first line. The card
menu upholds it too: `Move under…` offers only destinations with the same visibility,
because offering the others would be offering a permission error.

*Rejected:* a skeleton document per node, with structure in a readable `nodes/{id}` and
content in a restricted child. It doubles every write and leaks that a hidden card exists,
where it sits and when it is due. A phantom card on the board is worse privacy than none.

*Rejected:* a Cloud Function with the admin SDK for reparent and delete. It closes the hole
without the restriction, but a callable cannot run offline, and `PROJECT.md`'s own
principle is that work happens in basements, sheds and gardens. Deleting a card without
signal is ordinary.

## Queries

Each one is shaped so that *every document it can match* is one the caller may read.
Firestore rejects an entire query if any matching document could be denied, so being
rule-safe is not enough. The node read rule is `isMember(homeId) &&
visibleToMe(resource.data)`, and `isMember` is resource-independent, so it holds for every
document in the collection, and each query below constrains one of `visibleToMe`'s two
disjuncts.

**A board.** The children of one node, or of the root. Two listeners, merged, held by
`useNodes`. Every board at every depth is this same pair, with `parentId` set to the node
being drilled into instead of `null`; drill-down added no new query shape and no new
index.

```ts
// Q1
query(nodesRef(homeId),
      where("archived", "==", false),
      where("parentId", "==", parentId),   // null for the root board
      where("visibility", "==", "shared"),
      orderBy("rank"))

// Q2
query(nodesRef(homeId),
      where("archived", "==", false),
      where("parentId", "==", parentId),
      where("participantIds", "array-contains", uid),
      orderBy("rank"))
```

Q1 constrains `visibility == 'shared'`, the rule's first disjunct; Q2 constrains
`participantIds array-contains uid`, its second. No matching document can be denied.

The two results are merged, deduped by id, then sorted `(rank, id)` and grouped into
columns by `status` client-side. Deduping is required, not defensive. A *shared* node I
participate in matches both queries. One query per board rather than one per column
keeps the listener count at two regardless of how many statuses a board shows.

Costed the way `PROJECT.md` costs things: roughly one extra document read per board load,
billing being per document rather than per query. It buys the free `array-contains` slot on
Q1 for `locationAncestorIds` later.

**A node's steps**, on its [detail screen](#node-detail), are that same pair again:
`useNodes(homeId, nodeId)`, with `parentId` set to the node being viewed. No new shape and
no new index. Opening a leaf's details costs the same two listeners a board does, plus the
node's own single-document listener. Three, constrained, torn down together, exactly like
a board.

**The board's own node.** One single-document listener, `useNode(homeId, nodeId)`. Three
constrained listeners per board rather than two. It buys two things a one-shot read cannot:
a rename by another member updates the title on the screen you are looking at, and a card
deleted under you, since `deleteNode` takes the whole subtree, bounces you to the parent
board with a message instead of leaving you on a board that no longer exists. A node that
cannot be read, or does not exist, is the same bounce.

Two things that listener has to get right, both of which were shipped wrong first:

- It subscribes with `includeMetadataChanges: true`. A document missing in the cache
  *and* missing on the server never changes, so the server's confirmation is a
  metadata-only event, which Firestore suppresses by default.
- A missing document is only *believed* once the server has said so. A cache miss is held,
  not answered. Offline, a board never opened while online resolves immediately as missing,
  and announcing a deletion that did not happen is worse than waiting.

**Breadcrumbs.** One `getDoc` per id in `ancestorIds`, issued in parallel, each handled on
its own, memoized for the session in `hooks/use-ancestors.ts`. An ancestor that cannot be
read costs one rejected promise and renders as a neutral crumb.

That case is real rather than theoretical. Participant inheritance runs downward: a
private child holds all of its parent's participants, not the reverse. So being added to a
private subtask does not grant a read on the private project above it.

The memo is keyed by uid, home and node id, and dropped whole when the uid changes.
Signing out does not reload the page, so on a shared device the next member would otherwise
be handed a title the previous one was allowed to read, drawn as a real, tappable crumb
rather than the neutral one the design exists for. Only nodes that were actually read are
remembered. A failure can be a cold cache or a dropped connection, and remembering *that*
would leave a crumb reading "Hidden" for the rest of the session after the connection came
back.

*Rejected:* `where(documentId(), 'in', ancestorIds)`. One read instead of *n*, and it is
query-unsafe. A single unreadable ancestor rejects the whole query and every crumb
disappears at once. Rule-safe but query-unsafe is the exact failure `CLAUDE.md` forbids.

*Rejected:* carrying the trail in router params. Free while navigating in-app, empty on
reload or on a shared link, and a board reached by URL is the case breadcrumbs exist for.

**The destination board, when re-parenting.** `reparentNode` takes a rank computed against
the target board's neighbours, and that board is not on screen. `Move under…` therefore
reads it once with the same two queries (`getDocs`, not a listener) and computes
`rankAtEnd` of the column matching the moved card's status. Deliberately *not* from the
server, unlike the subtree reads. A stale neighbour costs a card that lands in the wrong
place in a column, which the next reorder fixes, where a stale subtree orphans documents.

**A shared node's subtree.** One-shot, for reparent and delete.

```ts
query(nodesRef(homeId),
      where("visibility", "==", "shared"),
      where("ancestorIds", "array-contains", nodeId))
```

Safe by the same first disjunct, and complete by the uniform-visibility invariant. No
`archived` filter: a subtree operation moves or deletes archived descendants too.

**A private node's subtree.** One-shot, same callers.

```ts
query(nodesRef(homeId),
      where("visibility", "==", "private"),
      where("participantIds", "array-contains", uid))
// then filter ancestorIds.includes(nodeId) client-side
```

The second `array-contains` is not expressible, so the ancestor test is client-side. Safe
by the rule's second disjunct, since `participantIds array-contains uid` alone proves that,
and complete by participant inheritance.

The `visibility` clause is what *bounds* it. A member is also a participant of every shared
project that is theirs, so without that clause this would read every such card anywhere in
the home on each reparent or delete. Private nodes are small by construction.

**`subtreeOf()` runs both of these and dedupes by id**, rather than choosing one by the
node's own visibility. Choosing was only sound while a subtree really is all one thing,
and a [visibility flip](#the-flip-is-the-dangerous-part) is *n* sequential writes that
cannot be batched, so one abandoned partway leaves a mixed subtree, which is the state
this has to survive. Under the old form, a project left private with fourteen still-shared
descendants was a project whose later deletion ran the private query and never saw them.
They would survive the delete with a dead `parentId`, unreachable from every board and
every breadcrumb, precisely the orphan the whole invariant exists to prevent, and it bites
in both directions.

Each half is provably safe on its own, so the union is. It costs one extra one-shot server
read on reparent, delete and flip, and it buys a mixed subtree that still deletes whole and
still reparents whole. An abandoned flip then *degrades*, with some cards keeping the old
visibility, but can never orphan.

*Rejected:* a `flipPending` marker field so an interrupted flip could be found later.
Another field on every document, and the union above already removes the consequence that
made finding it urgent.

### Storage cost lives in the index, not the document

A document is 32 bytes plus its path plus its fields; twenty-two fields with empty defaults
come to roughly 200 bytes. An index entry is 32 bytes plus the full document path, about
110 bytes here, plus the value, and every automatically indexed scalar has two of them.
One null scalar is therefore ~290 bytes of index, more than ten times what it costs in the
document.

So a field gets a single-field index only if some query filters or orders by it *alone*.
Everything else is exempted in `firestore.indexes.json` with a field override carrying an
empty `indexes` array. Empty arrays already generate no index entries, so the array fields
cost nothing until they hold something. Roughly 2.9 KB of index entries saved per node.

Composite indexes:

| Collection | Fields | For |
| --- | --- | --- |
| `nodes` | `archived` ASC, `parentId` ASC, `visibility` ASC, `rank` ASC | board Q1 |
| `nodes` | `archived` ASC, `parentId` ASC, `participantIds` ARRAY_CONTAINS, `rank` ASC | board Q2 |
| `nodes` | `visibility` ASC, `ancestorIds` ARRAY_CONTAINS | shared subtree |
| `nodes` | `visibility` ASC, `participantIds` ARRAY_CONTAINS | private subtree |

Single-field indexing is disabled for `title`, `columns`, `childCount`, `doneCount`,
`notes`, `checklist`, `photos`, `effort`, `priority`, `rank`, `archived`, `createdBy` and
`updatedAt`. `columns` is a new array field that Firestore would otherwise index at roughly
two entries per element, and nothing queries it. `rank` and `archived` appear only inside
composite indexes, which an exemption does not affect. Left automatically indexed, because
a later feature filters on them alone: `status`, `parentId`, `visibility`, `locationId`,
`dueDate`, `completedAt`, `createdAt`, and the other array fields.

The emulator indexes everything on the fly and can never reveal a missing index, the same
trap the `emailHash` field override documents in
[`home-and-members`](home-and-members.md). Every query above is declared there for that
reason.

## Rules

`validNode()`, `structure()`, `inherits()` and `immutable()` live in `firestore.rules`
inside `match /homes/{homeId}/nodes/{nodeId}`, alongside the `visibleToMe()` read grant.
They are in the rules rather than in a component so the REST API
([#7](https://github.com/Senth/home-backlog/issues/7)) and any agent driving it inherit
every one.

```
validNode(data)
  title      is string, size 1..200
  status     in the four-value enum
  columns    is a list, size 1..4, every entry in the same four
  childCount is int             doneCount is int
  rank       is string, size > 0
  parentId   == null or is string
  locationId == null or is string
  ancestorIds, locationAncestorIds, participantIds, blockedBy  are lists
  assigneeIds  present-only: !('assigneeIds' in data) || data.assigneeIds is list
  visibility in ['shared', 'private']
  dueDate    == null or matches '^\d{4}-\d{2}-\d{2}$'
  priority   == null or in ['low','normal','high','urgent']
  effort     == null or in ['quick','hours','evening','weekend','multi_week']
  notes      is string, size <= 10000
  checklist  size <= 200        photos size <= 50
  archived   is bool
  completedAt == null or is timestamp
  (status == 'done') == (completedAt != null)
  createdAt, updatedAt are timestamps; createdBy is string

structure(data)
  parentId == null  ->  ancestorIds == []
  parentId != null  ->  ancestorIds.size() > 0
                        && ancestorIds[ancestorIds.size() - 1] == parentId
  !(nodeId in ancestorIds)

inherits(data)            // one get() on the parent; skipped when parentId == null
  data.visibility == parent.visibility
  data.visibility == 'private'
    -> data.participantIds.hasAll(parent.participantIds)

immutable(next, current)
  next.createdAt == current.createdAt && next.createdBy == current.createdBy

privacyUnchanged(next, current)   // when true, update skips inherits() entirely
  next.parentId == current.parentId
  && next.visibility == current.visibility
  && next.participantIds == current.participantIds
```

`assigneeIds` is the one field validated present-only, and the one deliberately absent
from `privacyUnchanged()`. It is not privacy, since no rule anywhere reads it, so an
assignment stays an ordinary edit that skips the parent `get()`. And requiring it outright
would deny every update to a node written before it existed, including the `childCount`
bump that adding a step to an old project performs. `request.resource.data` is the full
post-update document, so the missing field fails on a patch that never mentioned it. There
is no admin tooling in this repo to unstick them, so it would deadlock. New documents
always carry it; old ones gain it the first time anything writes it.

The status vocabulary is written once, as `allStatuses()`, because `status` and every entry
of `columns` are drawn from it and the two must never drift.

The two counters are checked for their type and nothing else. No bounds, and no relation
between them. See [the counters](#the-counters-are-a-display-convenience-never-an-invariant):
`doneCount >= 0` would fail a *delete* on an ordinary offline race, and the clamp belongs
on the read side where the worst a wrong value can do is draw a chevron.

`request.resource.data` is the full post-update document, so `validNode()` costs the same
on an update as on a create and no partial-patch case can slip past. Reading a field that
is absent is an evaluation error, which denies the write. That is why "every field is
written on create" is enforced rather than hoped for. `createdAt` and `updatedAt` are
required for the same reason `immutable()` exists: a document created without them could
never be updated again.

### A node that is not there is an answer, not an error

`get` and `list` are granted separately:

```
allow get:  if isMember(homeId) && (resource == null || visibleToMe(resource.data));
allow list: if isMember(homeId) && visibleToMe(resource.data);
```

`resource` is null for a document that does not exist, and reading a field off null is an
evaluation error, which denies the read. Under the single grant the two shared, a board
whose card somebody else had deleted came back as a raw permission error rather than "that
card is gone". The screen listening to it then had a failure to log instead of a fact to
act on, and deleting a card while another member is standing on its board is ordinary
rather than exotic.

`list` keeps the strict form. A query never matches a document that does not exist, so
nothing about query safety changes.

And a refusal on `get` is not logged as a failure either, in `useNode` or in `getNode`.
Both are documented to treat it as the same answer as "not there". It is what a private
card somebody else owns looks like, and what an unreadable ancestor looks like to a
breadcrumb, so console-logging it made an ordinary, expected outcome draw a raw
`FirebaseError` over the honest message in development. Any other failure keeps its entry.

### Rules cannot see the rest of a batch, so the invariants are split

A `get()` inside a security rule reads committed state. It does not see other writes in
the same `writeBatch` or transaction. So a rule that validates a child against its parent's
*new* value fails for every write that changes both at once.

The two invariants are therefore enforced differently, chosen by whether the rule needs to
see the parent change:

- **Visibility and participants.** Enforced with a `get()` on the parent. During a
  reparent the parent's visibility does not change and the new parent is not in the batch,
  so the `get()` reads correct state inside a batch.
- **`ancestorIds`.** Validated structurally, with no `get()`: the last element must equal
  `parentId`, and a node may not be its own ancestor. A descendant's `parentId` does not
  change during a reparent, so its rewritten `ancestorIds` passes inside a batch too.

Reparent and delete stay atomic. The unrecoverable invariant stays enforced.

### The parent `get()` is spent only where it can matter

A batched write may make at most twenty document access calls in total, across every
document in it. An update rule that always reads the parent therefore caps a subtree move
at twenty distinct parents, and fails as a bare permission error, with nothing to say that
size was the cause. A project whose twenty tasks each have a subtask is an ordinary
Saturday, not scale-check territory.

So `privacyUnchanged()` gates the `get()`. A write that moves neither `parentId`,
`visibility` nor `participantIds` cannot break the invariant, and skipping the read is not
weakening the check but declining to re-prove something this write does not touch. A
reparent's *moved* node still pays it, since its `parentId` changes, while its descendants
and every ordinary edit do not. The shape matters as much as the size, because a rule
evaluation caches a `get()` per path. Twenty siblings under one parent cost one call
between them, and it is *distinct* parents that spend the budget. The rules test moves a
subtree past it deliberately.

The one window this opens is during a [top-down visibility
flip](#the-flip-is-the-dangerous-part): a child edited between its parent's flip and its
own is let through while temporarily mismatched, and the flip then reaches it. The failure
all of this exists to prevent is a *silent orphan*, and producing one needs `parentId` or
`visibility` to change, which is exactly the case that still pays for the `get()`.

What this gives up is full-path verification: a wrong *grandparent* id passes the rules.
That is the recoverable class of error. `parentId` is the source of truth and `ancestorIds`
is derived from it, so a corrupt path is always recomputable, and `movedAncestorIds()`,
the function that builds it, is unit-tested.

*Rejected:* sequential top-down writes with a full `get()`-checked ancestor path. Maximum
enforcement, but it trades atomicity on every subtree operation and imposes an ordering
discipline everywhere from day one.

*Rejected:* structural rules only, with no `get()` at all. Simplest rules, and it leaves
uniform visibility enforced by the client alone, so a bug, or the REST API (#7),
reintroduces the silent orphan.

Operations that *do* change visibility, or create a parent and a child together, still
cannot be batched: the [subtree visibility flip](#the-flip-is-the-dangerous-part) and bulk
subtree create (#7) must write top-down, one document at a time. They fail loudly, with a
permission error, if they forget, which is the right way for that constraint to be
discovered.

## Rank

`rank` is a fractional index, and was from the first document. Drag and drop
([#5](https://github.com/Senth/home-backlog/issues/5)) was deliberately post-MVP, and this
is the bet that made it a pure UI change when it arrived: no migration, no new field, no
new index, and no change to any query or listener.

A rank is ordered within its `(parentId, status)` column, which is what a board reorder
manipulates. Moving a card to another column recomputes its rank from that column's
neighbours in the same write as the status change.

`rankBetween`, `rankAtEnd` and `rankSequence` in `models/node.ts` wrap
`fractional-indexing` over a base-62 alphabet.

*Rejected:* rank global per parent. A card keeps its value across a column change, but
dropping it at the top of another column still has no valid rank to take, so the rewrite
happens anyway and the invariant is weaker for nothing.

*Rejected:* float ranks with renormalization. Around fifty repeated midpoint inserts at one
spot exhaust double precision, and the renormalization pass rewrites a whole column, a
batch write that fails offline, which is exactly where drag and drop gets used.

*Rejected:* hand-rolling the base-62 midpoint. It is the same algorithm
`fractional-indexing` implements, and the fiddly parts, the integer-length prefix, the
no-trailing-zero normalization and the unbounded ends, are where a hand-rolled version
breaks. `generateNKeysBetween` is also exactly what #7's bulk create needs.

Two people offline can still produce the same rank between the same neighbours. The client
sort is therefore `(rank, id)`, always, so a tie renders identically on every device and
the next drag breaks it permanently. No extra field, no write, and it covers ties arriving
from the REST API or a seeded fixture too.

A tie has one more consequence, met by [dragging](#moving-a-card-by-dragging-it). There is
no key strictly *between* two equal ranks, and asking `rankBetween` for one throws. A card
dropped inside a tied run therefore lands just after the run rather than inside it, and
that drop breaks the tie for good.

**A drop ranks against the cards you can see.** Where a column is
[hiding](#whose-projects-a-board-shows) somebody's personal projects, those cards keep
their own ranks wherever they fall, and the hidden-card line at the bottom of a column is
never a drop target.

*Rejected:* ranking a drop against the unfiltered list. It keeps the order stable whether or
not *Show everyone's projects* is on, at the price of a card landing visibly in one place
and actually being in another, which is the kind of lie the board refuses everywhere else.

## `dueDate` is a calendar day, not an instant

`'YYYY-MM-DD'`. "Clean the gutters by Sep 30" is the same day in every timezone, and
lexicographic order is chronological, so `orderBy` and range queries work unchanged. A
`Timestamp` would need a pinned timezone on every read and write or drift a day, and the
season *windows* in `PROJECT.md` (Sep 1 – Nov 30) would become instants.

It follows that whether a date is overdue is a comparison of calendar days, never of
instants. An instant comparison makes a card late for six hours in the evening and not
late in the morning, in one of the two timezones the app ships strings for.
`models/due-date.ts` carries it: `dayDifference(dueDate, now)` and `dueState(dueDate, now)`
returning `'late' | 'soon' | 'later' | null`, with "soon" being 0–7 days inclusive. Both
sides of the subtraction are reduced to a year, month and day and compared through
`Date.UTC`, which is what makes the answer survive a DST change. A local day is 23 or 25
hours long twice a year, and dividing an instant difference by 24 hours lands a day out on
exactly those nights. Unit tested at both sides of every boundary, because this is the kind
of arithmetic that is wrong at exactly one of them.

`toCalendarDay` and `fromCalendarDay` are the seam to the date picker, which deals in
`Date`. Never `toISOString()`, which converts to UTC first, so a day picked east of
Greenwich in the evening is stored as the day before.

The three formatters are tried, not feature-detected. `Intl.RelativeTimeFormat` is
missing outright from some Hermes builds, which a `typeof` check would catch, but
`Intl.NumberFormat` can be present and still throw `RangeError` on `style: 'unit'`, and
that one lands inside a card's render, so an overdue card would take the whole board down.
Each falls back to the stored date, which is worse but never blank. The overdue string uses
`unitDisplay: 'narrow'` so both locales read *14d*; `short` is locale-asymmetric, "14 days"
against "14 d", for the same fact on the same chip.

## Writes, and what each one may touch

`data/nodes.ts` carries six writes, split by what they have to keep consistent:

- **`createNode`** returns the new id immediately, generated on the device rather than by
  the server, alongside an `acknowledged` promise that resolves when the server has the
  write. A caller that awaits that promise before closing a sheet has built a form that
  hangs in a shed, so the failure is logged inside `createNode` too. An ignored rejection
  is an unhandled one, and that shows up as a console error nobody owns. It also puts the
  author into `participantIds` on a private *root* card, which has no parent to inherit
  them from and which the rules refuse without them. It is a batch: the child `set` and the
  parent's `childCount` update together, so a card can never exist without having been
  counted.
- **`updateNode`** takes everything *except* structure, status, rank, visibility and the
  two counters, each of which belongs to one of the others.
- **`moveNode`** changes `status` and `rank` together, because a card arriving in another
  column takes a rank computed from that column's neighbours. It owns `completedAt`, which
  follows the status in both directions, and a node that was already done keeps the date
  it has, because "completed" must not quietly become "last touched".
- **`reparentNode`** rewrites `ancestorIds` for the node and its whole subtree in one
  batch, plus the moved node's `rank`. A rank is ordered within its `(parentId, status)`
  column and a new parent is a new column, so the caller passes one computed from the
  target board's neighbours. `locationId` is untouched: a node moving in the project tree
  never moves in the location tree. Moving a node into its own subtree throws before any
  write. It also **clears `participantIds` on a shared node that stops being a root**. The
  control that edits them is root-only and the default-hide filter bites at every depth, so
  a demoted project would otherwise stay hidden from everyone not on it with nothing
  anywhere able to clear the flag. A private node keeps its list, because the rules require
  every descendant to carry all of its parent's.
- **`deleteNode`** deletes the subtree and the node in one batch. A node whose parent is
  gone is unreachable from every board and every breadcrumb.
- **`flipVisibility`** makes a project private or shared again, and is the only write here
  that is not one batch. See [the flip](#the-flip-is-the-dangerous-part).

### The counters are maintained by four of those five

`NodeChanges` excludes `childCount` and `doneCount`, so an ordinary edit can never touch
them. They belong to the structural writes, the same way `status` and `rank` belong to
`moveNode`. The arithmetic itself is `childArrives`, `childLeaves` and `doneChange` in
`models/node.ts`, so it is testable without Firestore.

| Write | Counter effect |
| ----- | -------------- |
| `createNode` | parent `childCount +1`; also `doneCount +1` when created straight into Done |
| `moveNode` | parent `doneCount +1` on `completionChange === 'set'`, `−1` on `'clear'` |
| `reparentNode` | old parent `−1`, new parent `+1`; likewise `doneCount` when the node is done |
| `deleteNode` | parent `childCount −1`, and `doneCount −1` when the node was done |

Three details that are easy to get wrong:

- **A subtree delete only touches one parent.** Every descendant's parent is inside the
  subtree and is deleted with it, so only the top node's parent is decremented.
- **A root-level node has no parent document**, so `parentId === null` means no counter
  write at all, on create, reparent and delete alike.
- **`createNode`'s batch still passes `inherits()`**, which does a `get()` on the parent.
  A rule's `get()` reads committed state and cannot see the rest of the batch, which is
  sound here precisely because the parent's own update changes neither its visibility nor
  its participants, so the value it reads is correct.

A counter bump writes no `updatedAt` on the parent. A step appearing under a project is
not somebody editing the project, and [#55](https://github.com/Senth/home-backlog/issues/55)
reads that field as "last touched".

### Offline

`createNode`, `updateNode` and `moveNode` queue optimistically. That is Firestore's default
and it is what a board in a shed needs.

`reparentNode` and `deleteNode` require a connection, and the screens that call them
disable the action with a hint, the pattern [`home-and-members`](home-and-members.md)
already applies to creating a home and sending an invitation. Both read the subtree first,
and they read it from the server rather than the cache. Offline the cache holds only the
boards that happen to have been opened, so a subtree delete would silently miss descendants
and orphan them, which is precisely the failure the visibility invariant exists to prevent.
Reading from the server turns that into a loud failure.

*Rejected:* allowing an offline delete when the cache shows no children. "No children in
cache" is not "no children". A cold cache after a reload, or a node reached by URL, brings
the orphan straight back.

`flipVisibility` requires a connection for a different reason. Queuing it optimistically
would show a private project that is not private yet. Changing participants on an
**already private** project goes through the same call and inherits the same requirement,
because there the list *is* the ACL. On a shared project it is a plain `updateNode` and
queues like any edit, because the read grant's first disjunct already lets every member in,
so the list changes no permission at all.

### The flip is the dangerous part

Uniform visibility means every descendant physically carries the same `visibility` value.
Board Q1 filters on it directly, so it cannot be derived. Making a project private is
therefore *n* writes, and they cannot be one batch. A rule's `get()` reads committed
state, so a child written to the new visibility while its parent still holds the old one
fails `inheritsFrom`. Top-down, one document at a time, in both directions.

`flipVisibility(homeId, node, target, uid, { participantIds, onProgress })`:

- reads the subtree from the server through the unioned `subtreeOf()`;
- computes `flipPlan()` in `models/node.ts`: the documents to write, ordered by depth,
  with every document already at the target dropped;
- writes them one at a time, `await`ing each, reporting `{ done, total }` after every write
  and on failure.

Target participants going private are the root's list plus the actor, on every document.
`allow update` requires `visibleToMe(request.resource.data)`, so writing yourself out is
refused, and the answer is to write yourself in rather than to defend against a lockout
that cannot happen. Going shared, the root keeps its list, which becomes "whose project"
again, and descendants drop to `[]`.

`participantIds` is a separate argument rather than a doctored `node`, and that is not
cosmetic. `flipPlan` measures every skip against what is *stored*, so a copy carrying the
new list makes the root look already-correct and drops it from its own plan. That is
exactly the participants-change-on-an-already-private-project case, where the visibility is
not moving and the list is the only thing that is. It silently wrote nothing.

Dropping the already-correct documents is what makes an interrupted flip resumable rather
than repeated: running it again finishes the job. Which is why the retry lives on the
progress dialog rather than on the control. The root lands first, so after a half-finished
participants change the checkbox already shows the new person, and ticking it again would
take them back off.

Each write changes `visibility` or `participantIds`, so `privacyUnchanged()` is false and
one parent `get()` is spent per document. These are single-document writes, not a batch, so
the twenty-document-access budget does not apply.

*Rejected:* a Cloud Function with the admin SDK. It bypasses rules, so all *n* writes go in
one atomic batch and no half-state exists, and the offline objection that rules out Cloud
Functions elsewhere in this area does not bind, since the flip is online-only anyway.
Rejected for what it costs instead: the project's first Cloud Function, a deploy pipeline,
and the uniform-visibility invariant no longer enforced by the rules on the one path most
likely to break it.

## The board

One board component at every depth. `PROJECT.md`: resist per-level special cases, they
multiply. `/projects` renders the root board from `defaultColumns`; `/projects/[nodeId]`
renders the same component from that node's frozen `columns`.

### Layout

- **Below `compactBreakpoint` (720).** One column at a time, with a scrollable strip of
  chips above it: each names its column and carries its card count, the current one is
  marked, and a tap switches to it. Two of the four panes are empty in a small household,
  and without the strip a board is navigated blind, because an empty pane is
  indistinguishable from a broken app. The strip is also the way back after a move, and the
  way to Done without three swipes.
- **At 720 and above.** Columns side by side, the board scrolling horizontally, each
  column on its own `Surface`. The column headers say what the strip says, so the strip is
  not rendered.
- A board always opens on its first column, rather than restoring the last pane anyone
  was on.
- Below the breakpoint every pane is mounted and one is shown. That is what lets a card
  [dragged to the screen edge](#crossing-columns-and-two-ways-to-do-it-on-a-phone) walk the
  board without the gesture dying with the column it came from. See
  [the traps](#paper-and-react-native-web-traps-this-area-hit).

**The pane on screen is state, set only by deliberate input**: a tap on a chip, or a card
held at the screen edge long enough to walk the board one column. It is never read back
from a scroll position, and that is not a stylistic preference. It was a swipeable pager,
and the pager is what broke it. A scroll-snapping container is not something the app is the
only one moving. The browser re-snaps it when content changes and scrolls it to bring a
focused element into view. The board drifted to whichever column a card happened to land
in, so twelve cards added in a row from a FAB reading *Add to To do* went to In progress
and Next up, alternately. That is the household-fills-a-board-on-a-Saturday-morning case
this feature exists for. Swiping between columns is tracked as
[#78](https://github.com/Senth/home-backlog/issues/78) and needs a foundation where the
gesture reports *to* that state rather than the state being read *from* a scroll offset.

### Whose projects a board shows

**A board hides a card whose `participantIds` is non-empty and does not contain me**,
unless *Show everyone's projects* is on. That is the motivating sentence implemented
literally: "I want us to have a shared house, but I want to add my personal projects to
the list; it does not make sense that my spouse sees them by default, and they should still
be able to see them." Hidden by default, never denied, always one toggle away.

It costs no query, no index and no listener. The two board listeners already merge
client-side, so this is a predicate over a list the screen already holds
(`hiddenByParticipants` in `models/node.ts`, applied in `hooks/use-participant-filter.ts`).
The predicate is uniform at every depth and *bites* only where participants exist, which is
roots. A shared descendant carries `[]`, and a private one carries the root's, which
include me or I could not have read it.

The toggle lives in the board's app-bar overflow, because it is rarely touched and a board
is already carrying a column strip. It is board-level UI state, defaulting to off and not
persisted. A board always opens in the hiding state, the same way it always opens on its
first column. The overflow appears only where it could do something: a household of one has
nobody else's projects to hide, and `hiddenCount` covers the case where a card with
participants arrives from the REST API into one anyway, where hiding with no way back would
be a trap.

**A board that is hiding something says so**, rather than drawing as though the cards were
not there: whole-board when every card is held back, and per column, which is what a
compact pane shows one of. Both name the toggle. "Nothing here yet. Add the first card."
with a control two taps away that disproves it is the kind of lie people stop trusting a
screen for, and it is the same principle the narrowed assignee list and the stale assignee
already follow: never a dead end.

The board is handed the hidden cards rather than a count, so each column can speak for
itself, and `visibleColumns` counts them too, so a held-back card sitting in a status
outside the frozen set still has a column to be counted in.

**A board that could not be read says that instead**, for the same reason. Once its
listeners have spent the retry ladder in `data/live-query.ts`, `useNodes()` reports
`failed` and the board draws `board.loadFailed` with a Try again in place of the empty
state. "Add the first card" and "could not load" are contradictory instructions and only
one of them is ever true. It is said whether or not any cards arrived. A board is two
listeners and only one has to fail, so a board missing every shared card on it otherwise
looks perfectly ordinary, and that is the board a card gets added to twice. See
`docs/specs/platform-offline.md` for the ladder itself.

*Rejected:* enforcing the hiding in the rules. It is a display preference, not a
permission. "Should still be able to see them" is the requirement, and a rule cannot
express "hidden but readable".

*Rejected:* shipping participants with no filter. Without something that *reads* the field,
setting participants on a shared project changes nothing observable anywhere. A control
with no effect is a control nobody understands the point of, and the household would meet
it before meeting the reason for it.

### The card

A title, a mark when `blockedBy[]` is non-empty, and, only when the value is set, an
outlined priority chip, an outlined effort chip and a due chip. On the right, `2/5` and the
chevron when `hasSteps(node)`, and neither when not. A card with nothing set is a title and
nothing else.

Two of those marks answer the people questions, both only when set, the same rule the due
chip follows:

- **Who is doing it**, as a row of small avatars above the chips. "Is this mine, or is he
  asking me?" is otherwise answered only on the detail screen, and the phone-only member
  never opens the detail screen. The row carries one accessibility label for all of it,
  because a screen reader reading "M W, N A" learns nothing.
- **A *Hidden* chip** with an eye-off icon on a private card, beside priority and effort.

Neither costs a read, since `memberProfiles` is already on `activeHome`. The *Hidden* mark
stays a `MetaChip`, deliberately not a control, which is what keeps a screen reader from
announcing every private card as "dimmed".

**Tap opens the card as a board once it has a step in it, and as its
[details](#node-detail) until then.** The chevron is what says which, so the gesture is
never ambiguous. A card without steps has nothing to drill into, and an empty board reads
as a bug rather than as an empty board. Everything else is on an overflow menu on the card,
whose button stops the press reaching the card underneath.

The chips are outlined labels, not Paper's `Chip`. See
[the traps](#paper-and-react-native-web-traps-this-area-hit).

**The due date appears only when it is overdue or within a week.** A date three months out
is not asking for anything, and a board where every card carries a date teaches people to
stop reading dates.

**Overdue is carried by words, not by colour**: *14d late* / *14d sen*, in the warning
colour the blocked mark already uses, at the same visual weight. Nothing in the app acts on
a due date yet. No reminder, no notification, no overview
([#54](https://github.com/Senth/home-backlog/issues/54)), no suggestion engine
([#55](https://github.com/Senth/home-backlog/issues/55)). So a red card would be pure
guilt for a deadline nothing will ever remind anyone about. Nadia's greenhouse is a
multi-year drift with a date somebody else typed in April; it says *late* once, plainly,
and does not escalate. Words also survive 200% text and colour blindness, which a red chip
does not.

For the same reason the priority chip is a label, not a colour-coded alarm. On a
curated board the priority is one member's judgement of another member's Saturday, and four
red chips on the outdoor cards is `PERSONAS.md`'s stated quit line rendered as UI.

*Rejected:* all three chips whenever set, unconditionally. On a curated board that is a
three-line card, and at Ingrid's text size the chip row is a fourth line under a title that
already wrapped to three, on the person with the most scrolling to do.

*Rejected:* a due date on the face whenever set. See above; a date that is always visible
is a date nobody reads.

*Rejected, and reversed:* the chevron on every card whether or not it has children, because
finding out cost a query per card. `childCount` is what made it free: one number on a
document the board already reads.

### Creating a card

Title only. The add control belongs to a column, not to the screen. At 720 and above
each column has its own add row, and below it one FAB naming its destination in words:
*Add to To do*. Status comes from that column, so a card typed one-handed in a greenhouse
lands where the button said it would. `createNode` queues offline; the sheet closes
immediately and never waits on the acknowledgement.

A board whose own node has not arrived yet renders no board at all. `parent` is what
`createNode` receives, and a null parent is not "this board" but the root, so a card
added during that window would silently become a top-level project.

### The card menu

| Action | What it does |
| ------ | ------------ |
| Details… | the node's [detail screen](#node-detail); the only way in for a card that *is* a board, where the tap drills in |
| Move to → *column* | one tap, appends at the end of that column |
| Change position… | lists the current column's cards: *At the top*, *After ‹card›* |
| Move under… | the other cards on this board, plus *Up one level* / *Top level* |
| Rename | a dialog with the title field |
| Delete | confirm, then the card and everything under it |

The menu changes *page* rather than opening a submenu: Paper's `Menu` scrolls its own
content, so a column of thirty cards is a list you scroll rather than a second overlay to
dismiss.

**Move** stays on the pane you are on and raises a snackbar naming the destination, with
Undo, which restores the status *and* the rank the card had, both of which are in hand.
Following the card would drag someone moving six cards in a row three panes sideways each
time; saying nothing makes a move read as a delete, because the destination is off-screen.
Only the board's frozen columns are offered as destinations.

**Change position** is what makes ordering real. Up / down / top / bottom cannot place a
card at position three of thirty without twenty-seven taps, so the position list picks the
slot directly and `rankBetween` ranks it against its two new neighbours. The slot the card
already occupies is disabled rather than offered as a write that changes nothing.

**Move under…** is why drill-down alone was not enough. A household fills a board the day
it gets one, and nesting *new* work does nothing for work already typed; without it, the
first thing the app asks of its only user is to re-type forty cards. It lists only siblings
with the same `visibility`, never the card itself, and *Up one level* and *Top level* are
the same destination one level below the root, so they are never both offered. It has no
Undo, because reversing a re-parent needs a second server read, which is
[#79](https://github.com/Senth/home-backlog/issues/79).

**Delete** warns that everything under the card goes too, in as many words, and is styled
as the destructive action the way `ConfirmDialog` already does elsewhere.

**Offline**, the split is the one the writes already draw: move, change position and rename
queue; `Move under…` and `Delete` are disabled with a hint rather than failing after the
tap.

Nothing on this menu was removed when [dragging](#moving-a-card-by-dragging-it) arrived.
The drag is an added gesture, and the menu stays the path that works without it: with a
keyboard, with a screen reader, and for the two actions a drag deliberately cannot do.

### Moving a card by dragging it

A card can be picked up and dropped: within a column to reorder it, or onto another
column to change its status. It is an added gesture on top of [the card
menu](#the-card-menu), which is unchanged and stays the complete, accessible,
offline-proof path to everything a drag can do.

The board is where a household's work gets sorted, and sorting it through a menu costs two
dialogs per card. Eleven cards typed the night before is eleven trips through *Change
position…*, and that number only grows on a real renovation board.

A drop is exactly the write *Move to → column* already makes: `moveNode(homeId, node,
status, rank)`, one write, `completedAt` owned in both directions, the parent's `doneCount`
kept in step, queued offline. No document, rule, query or listener changes, which is
what [`rank`](#rank) was made fractional for.

#### The gesture was built around the person it endangers

`PERSONAS.md` has Ingrid, 71, at 200 % text with one thumb, doing the most scrolling in the
app. Her scroll is *press → hesitate → move*, and her deliberate tap is long. So:

- **Touch** arms on a press that stays still for 500 ms. Movement past a small slop
  threshold before the hold completes is a scroll, and can never become a drag afterwards.
  Releasing before it is the tap the card already had.
- **A pointer** arms on a few pixels of movement with the button down, and never waits.

A 200 ms long-press-anywhere reads both her hesitation and her tap as a drag, so ordinary
scrolling would move cards she never touched, her stated quit line. The 500 ms hold, the
movement threshold that turns an arming hold back into a scroll, and the Undo on every drop
that changes anything are all there because the gesture is otherwise a trap for the person
with the least ability to get out of it.

*Rejected:* a drag handle on the card. It removes the gesture collision completely and a
keyboard could reach it, but it puts a third target on a 48 dp card row that already
carries a tap and an overflow button, and [the card face](#the-card) refuses exactly that
kind of addition.

*Rejected:* 200 ms with only a movement threshold added. The pause is what misfires, not
the movement. A still finger resting before a deliberate scroll is precisely that gesture,
and a threshold does not see it.

*Rejected:* the same hold on pointer and touch. A mouse that waits half a second before a
card moves reads as lag, on the wide board where the heaviest reordering happens.

#### While a card is held

- It lifts to `elevation.high` and follows the finger at a slight scale, drawn at board
  level so it is not clipped by the column it is leaving.
- The other cards part to leave a card-height gap at the landing spot. The gap is the
  indicator: nothing extra is drawn under the hand, which matters when a card is three
  lines tall at 200 % text and a thumb covers most of the pane.
- **Every column keeps a named landing area**, *Drop here in Next up*, while a card is
  up. Two of four columns are empty in a small household, and an empty column is otherwise
  one line of grey text, which is nothing to aim at.
- **The rendered order freezes** for the duration. A board is two live listeners, and a
  card arriving from the garden, or twenty from an agent, would otherwise move the gap
  out from under the finger, which is a bug nobody can reproduce or describe. Arrivals
  apply the instant the card lands.

*Rejected:* an insertion line between cards. Cheaper, and nothing reflows during the drag,
but a hairline is exactly what disappears under a thumb and at 200 % text.

#### Crossing columns, and two ways to do it on a phone

At 720 and above the columns are side by side and a card is dragged straight into one.
Below the breakpoint only one is on screen, and both paths exist because one is not
enough:

- **Dropping on a chip in the column strip** is the primary one. The strip is already how
  you change column, so the gesture agrees with a model the board has taught since it
  shipped, and it never moves the pane, so a bulk sort of six cards out of To do costs no
  navigation at all. A chip drop appends. The chip under the finger is marked, and the
  strip draws above the lifted card, which would otherwise cover the very chip it is aimed
  at.
- **Holding the card in the narrow zone at a screen edge** switches the visible pane, one
  column per dwell, with a visible fill so the switch is never a surprise. The first switch
  takes 750 ms; each repeat while the finger stays there takes 1250 ms, the fill
  restarting visibly. The first is deliberate, since you moved there on purpose, and the
  repeats are the dangerous ones, so they get the longer window to escape.

The pane an edge hold sets is the same state a chip tap sets, so [the pane
rule](#layout) is untouched: after an edge-hold drop the board stays where the drag walked
it, and after a chip drop it never moved.

*Rejected:* edge-hold as the only path. A thumb naturally rests near the right edge of a
390 px screen, which *is* the edge zone, so aiming at a gap one-handed would walk a card
through three columns without meaning to.

*Rejected:* chips as the only path. It works, and it is the safest thing here, but it makes
the phone the one place a card cannot be put where you want it, which is most of the app's
use.

*Rejected:* returning to the origin column after every drop, to match the card menu's
*Move*. The menu has no way to stay put *and* place a card precisely, so its rule is a
compromise; the drag has two paths and the chip drop already is the stay-put one. Yanking
someone back after they deliberately walked three panes across reads as the move being
undone.

#### Nesting stays out, and the drag does not pretend otherwise

Dropping a card onto a card to nest it is not part of this. `reparentNode` requires a
connection, reads a subtree from the server, and has no Undo
([#79](https://github.com/Senth/home-backlog/issues/79)), so one gesture would be
sometimes-offline-capable and sometimes not, which is worse than a gesture that does one
thing. [*Move under…*](#the-card-menu) stays the only way to nest.

The consequence is designed for rather than ignored: there is no drop-onto-card target at
all. The gesture only ever resolves to a position between cards, and nothing in the drag
highlights, scales or outlines a card in a way that suggests it could receive another one.
An affordance that does nothing is worse than no affordance.

*Rejected:* a one-time hint pointing at *Move under…* when somebody releases a card squarely
over another. Nesting is the app's differentiator and a drag-first reflex can hide it, but
this app has no onboarding, no coach marks and no "you have seen this" flag, and the first
one should not be introduced by a message that fires on a gesture the person may have meant
exactly as it landed.

#### When the card lands

- A drop that changes nothing writes nothing and says nothing, and the card settles
  back, mirroring *Change position…* disabling the slot a card already occupies. A
  snackbar for a move that did not happen teaches people that the screen lies.
- Every drop that changes something raises one snackbar with Undo, restoring both
  `status` and `rank`. Across columns it reuses *Moved to ‹column›*; within a column it
  says which way the card went.
- Twelve drags in a row raise one snackbar, replaced and never stacked, its Undo
  applying to the most recent drop.
- A card deleted under you while you carried it writes nothing and says
  *That card is gone.*

A drag queues offline like the *Move* and *Change position…* it shares a write with.
Nothing here needs a connection and nothing is disabled offline.

#### Accessibility, and the card face

**A drag is never the only path to any board change**, and that is the rule to keep rather
than a limitation to apologise for. Keyboard and screen-reader users get no drag. They get
*Move to*, *Change position…* and *Move under…*, which between them do everything a drag
does and more. The result of a drop is announced through the same snackbar every other move
already uses. The card keeps its own semantics, and the drag adds no `aria-*` state a
reader would announce on every card.

The card face gains nothing: no handle, no grip dots, no drag affordance of any kind.
The gesture is invisible until it is used.

#### Where the logic lives

`models/drag.ts` is pure and sibling-tested: `dropPlan({ column, dragged, toStatus,
toIndex })` returns `{ status, rank, direction }` or `null` when the drop changes
nothing, plus the hit testing: which column a point is over, which slot in it, and which
screen edge a held card is resting in. The gesture's timings and slop live there too,
because a millisecond is not a spacing step; the lift scale, the landing height and the
edge-zone width are layout and live in `theme/tokens.ts`.

`components/board/use-board-drag.ts` owns one drag: the frozen board, the measured
geometry, the write and the snackbar. **The geometry is measured once, when the card
lifts**, and hit-tested against for the rest of the drag. The gap that opens at the
landing spot moves every card below it, so re-measuring would feed the gesture its own
output and the gap would flicker between two slots. The one exception is an edge hold,
which changes the pane on purpose and so measures the pane that arrives.

### Breadcrumbs and navigation

*Projects › Bathroom › Tiling*, above the board, the last crumb being the current board and
each earlier one tappable. An unreadable ancestor renders as a neutral crumb rather than a
gap. The app bar names the card; the home's name is on the root board's app bar, which is
where the first crumb goes.

Navigation is a Stack inside the Projects tab, over the routes `/projects`,
`/projects/[nodeId]` and `/projects/[nodeId]/details`, so the tab bar stays put at every
depth, and browser back, the PWA back gesture, reload and a shared link all work.
`board-href.ts` is the one place those paths are written.

Going *up* uses `dismissTo`, not `push`: the crumbs are the stack you came down. Two things
make that work:

- The screen carries `dangerouslySingular` keyed on the node id, and so does the details
  screen. Every nested board is the same route *name*, and `POP_TO` matches on the name,
  so without an identity it resolves to the screen you are already on and merely swaps its
  params. Tapping a crumb then left the whole stack in place with its top re-pointed, so
  browser back went *deeper* rather than up, and every stranded screen kept its three
  listeners alive. The two route names differ, so they cannot collide on the shared id.
- The app-bar back arrow goes to the parent board explicitly rather than calling
  `router.back()`, which on a screen reached by reload or a shared link is a no-op that
  logs "GO_BACK was not handled by any navigator" and leaves the arrow dead.

A card that is deleted under you bounces to the parent board, remembered while the card
still existed, since a deleted card cannot say who its parent was. The message travels as a
route param, because the screen that has to *say* it is not the screen that discovered it.
The flag is cleared as it is read, so reloading that URL later does not announce the
deletion again. Only the *focused* screen may bounce: deleting a project takes its whole
subtree, so every stacked board below it sees the deletion in the same tick.

### Strings

Every one goes through `t()`, in `en-US.json` and `sv-SE.json`. The status labels are
plain-language on purpose: `PERSONAS.md` has Ingrid quitting over transliterated stage
names, and Priya reading "Execution / Review" as the work Jira she opened this app to get
away from. Swedish uses verbs where a verb is what a household says.

| Key | `en-US` | `sv-SE` |
| --- | ------- | ------- |
| `status.backlog` | To do | Att göra |
| `status.next_up` | Next up | Härnäst |
| `status.execution` | In progress | Pågående |
| `status.done` | Done | Klart |

`status.research`, `status.planning` and `status.review`, which read *Find out* /
*Undersök*, *Plan* / *Planera* and *Check* / *Granska*, went with the statuses themselves
in #99, and are gone from both locale files.

Dragging obeys the same register: nothing a person reads says *drag*, *drop zone*, *rank*
or *reorder*, which is the vocabulary the status labels already avoid. What it says is
where the card went: *Moved up* / *Flyttad uppåt*, *Moved down* / *Flyttad nedåt*, and
*Drop here in ‹column›* / *Släpp här i ‹column›* on an empty column. Everything else it
needs was already there: *Moved to ‹column›*, *That card is gone.*, *Undo*, and the
`status.*` labels the strip and the landing areas name themselves with.

The detail screen is written to one more vocabulary rule: **a household never meets the
word "board" until it has made one.** So the section is *Steps* / *Steg* and the button is
*Add step* / *Lägg till steg*; *Open board* / *Öppna tavla* appears only once a step
exists, matching `board.open`'s existing *Öppna som tavla*.

*Rejected:* *Subtasks* / *Deluppgifter*, the word `PROJECT.md` itself uses. It is
project-management register, exactly the Jira vocabulary Priya opened this app to get away
from, and a word Ingrid has never used.

| Key | `en-US` | `sv-SE` |
| --- | ------- | ------- |
| `detail.title` | Details | Detaljer |
| `detail.dueDate` | Due by | Klart senast |
| `detail.addDate` | Add a date | Lägg till datum |
| `detail.priority` | Priority | Prioritet |
| `detail.effort` | Time needed | Tidsåtgång |
| `detail.notes` | Notes | Anteckningar |
| `detail.notesPlaceholder` | Anything worth remembering | Något värt att minnas |
| `detail.saved` | Saved {{time}} | Sparat {{time}} |
| `detail.steps` | Steps | Steg |
| `detail.stepsNone` | No steps yet | Inga steg ännu |
| `detail.stepsFailed` | Could not load the steps. Check your connection. | Kunde inte ladda stegen. Kontrollera din anslutning. |
| `detail.stepsDone` | {{done}} of {{total}} done | {{done}} av {{total}} klara |
| `detail.addStep` | Add step | Lägg till steg |
| `detail.openBoard` | Open board | Öppna tavla |
| `detail.clear` | Clear | Rensa |
| `priority.low` … `urgent` | Low · Normal · High · Urgent | Låg · Normal · Hög · Brådskande |
| `effort.quick` … `multi_week` | Under 30 min · Under 2 hrs · An evening · A weekend · Several weeks | Under 30 min · Under 2 tim · En kväll · En helg · Flera veckor |
| `board.steps` | {{done}}/{{total}} | {{done}}/{{total}} |
| `board.dueLate` | {{elapsed}} late | {{elapsed}} sen |
| `board.dueSoon` | {{elapsed}} | {{elapsed}} |
| `board.details` | Details… | Detaljer… |

The people strings are question-shaped and plain, the precedent that produced *Att
göra*, *Klart senast* and *Tidsåtgång*.

*Rejected:* *Deltagare* and *Tilldelad*. The first collides with the existing *Medlemmar*
for a different set of people in the same home; the second is HR-register Swedish for what
is meant to read as a question between two people who live together. "Assigned to Nadia"
is `PERSONAS.md`'s stated quit line rendered as UI.

| Key | `en-US` | `sv-SE` |
| --- | ------- | ------- |
| `detail.participants` | Who's in on this? | Vilka är med? |
| `detail.participantsPrivate` | Who can see this? | Vilka ser det här? |
| `detail.participantsYouStay` | You cannot take yourself off a private project — you would lose it. | Du kan inte ta bort dig själv från ett privat projekt — då förlorar du det. |
| `detail.assignees` | Who's doing it? | Vem gör det? |
| `detail.visibility` | Who can see this project? | Vilka kan se projektet? |
| `detail.visibilityShared` | Everyone in the home | Alla i hemmet |
| `detail.visibilityPrivate` | Only the people I choose | Bara de jag väljer |
| `detail.assigneesNarrowed` | Only people in {{project}} are shown. | Bara de som är med i {{project}} visas. |
| `detail.assigneesChange` | Change who's in on {{project}} | Ändra vilka som är med i {{project}} |
| `detail.assigneeStale` | {{name}} is doing this but is no longer in {{project}}. | {{name}} gör det här men är inte med i {{project}} längre. |
| `detail.assigneeStaleClear` | Remove {{name}} | Ta bort {{name}} |
| `detail.privateOnlyProjects` | Only a whole project can be kept to yourself, not a step inside one. | Bara ett helt projekt kan hållas för sig, inte ett steg inuti ett. |
| `detail.privateMoveUp` | Move {{title}} to the top level | Flytta {{title}} högst upp |
| `board.hidden` | Hidden | Dold |
| `board.assignedTo` | {{names}} is / are doing this | {{names}} gör det här |
| `board.showEveryone` | Show everyone's projects | Visa allas projekt |
| `board.boardActions` | Board actions | Tavlans åtgärder |
| `board.allHidden` | Everything here is somebody's own project. Turn on "Show everyone's projects" to see them. | Allt här är någons eget projekt. Slå på ”Visa allas projekt” för att se dem. |
| `board.loadFailed` | Could not load this board. Check your connection. | Kunde inte ladda den här tavlan. Kontrollera din anslutning. |
| `board.hiddenHere` | {{count}} more here are somebody's own projects. Turn on "{{action}}" to see them. | {{count}} till här är någons egna projekt. Slå på ”{{action}}” för att se dem. |
| `visibility.confirmPrivateTitle` | Keep this to yourself? | Hålla det här för dig själv? |
| `visibility.confirmPrivateBody` | Only {{keeping}} will be able to see {{title}}. | Bara {{keeping}} kommer att se {{title}}. |
| `visibility.confirmPrivateLosing` | {{names}} will no longer see any of it. | {{names}} kommer inte att se något av det. |
| `visibility.confirmSharedTitle` | Show this to everyone? | Visa det här för alla? |
| `visibility.confirmSharedStillHidden` | Anyone will be able to open it, but it stays off the boards of people who are not in on it. | Alla kommer att kunna öppna det, men det syns inte på tavlan för dem som inte är med. |
| `visibility.progress` | Moving {{done}} of {{total}} | Flyttar {{done}} av {{total}} |
| `visibility.failed` | {{done}} of {{total}} moved. Try again to finish. | {{done}} av {{total}} flyttade. Försök igen för att bli klar. |

The confirm bodies have an `…All` variant apiece, *and everything in it* / *och allt som
ligger i det*, used when the project has steps, and `assignedTo`, `hiddenHere` and the
`…Body` keys carry i18next plurals. `names` and `keeping` are joined with
`Intl.ListFormat` in `i18n/format-list.ts`, tried rather than feature-detected, the same
discipline `models/due-date.ts` documents, since the whole sentence sits inside a dialog
that has to open.

`common.closeMenu` / `common.closeDialog` exist because Paper names its own scrim in
English; see [the traps](#paper-and-react-native-web-traps-this-area-hit).

The effort labels are words, not arithmetic: `<30 min` and `<2 h` are math symbols to a
71-year-old at 200% text, and the ids stay `quick` / `hours` precisely so re-tuning what
they mean is a string change rather than a migration. *En kväll*, *en helg* and *flera
veckor* are what a Swedish household actually says.

### Reducing overwhelm

The column strip with counts, a board that opens on its first column, a one-field add, and
a card face that carries a title plus at most what is genuinely set. Never five metadata
chips, never a due date that is not asking for anything yet, never a progress bar that
lies. The four detail fields live one tap away rather than on the face, and the chevron and
`2/5` say whether that tap opens a board or the details. Done grows without bound until
[#64](https://github.com/Senth/home-backlog/issues/64) archives it and
[#76](https://github.com/Senth/home-backlog/issues/76) sorts it newest-first. Dragging adds
nothing to any of it: the card face gains no handle and no grip, and the gesture is
invisible until it is used.

### Paper and React Native Web traps this area hit

Kept because each one is the kind of thing the next person reintroduces:

- **A horizontal `ScrollView` in a column parent grows to fill it.** One line of breadcrumbs
  took half the screen. Both strips carry `flexGrow: 0`.
- **`Appbar.Content`'s `subtitle` renders only outside Material 3.** It is not a way to show
  the home's name on a nested board; it is a prop that does nothing.
- **A `Portal` registers with the portal host even when the modal inside it renders
  nothing.** Every card mounting a rename dialog and a confirm dialog cost two portal
  entries and two focus-trap subscriptions per card, on a Done column that grows without
  bound. They mount only while open, which is what Paper's own `Menu` does.
- **Paper's `Chip` `selected` tint alone is not a mark.** On a strip of eight it is a
  slightly different shade of the same green; filled against outlined is legible.
- **A Paper `Chip` with no `onPress` is a *disabled* pressable.** It renders through
  `TouchableRipple`, which computes `disabled = disabledProp || !hasPassedTouchHandler`, so
  React Native Web writes `aria-disabled="true"` on it. A screen reader announced the
  priority on every card as "High, dimmed", and automation refused to click through it. The
  same trap `Row` documents for `List.Item`. The card's metadata chips are therefore
  `MetaChip`, an outlined pill with no ripple; the strip and the detail screen's choice
  chips keep Paper's `Chip`, where the ripple has a handler. And a chip's border is measured
  *inside* its own height, so `minHeight: touchTarget` leaves the pressable at 46, and
  `outlinedTouchTarget` adds the two hairlines back.
- **`Checkbox.Item` is the same trap wearing a different label.** It is a `TouchableRipple`
  wrapping a *second* `Checkbox` that is handed no `onPress`, so the inner one carries
  `role="checkbox" aria-disabled="true"`, and Paper's `importantForAccessibility` guard
  does not become `aria-hidden` on React Native Web, so every person in a list was
  announced twice, the second time as dimmed. `PeopleField` builds the row itself: a plain
  `Icon` for the mark, the semantics on the row.
- **`accessibilityState` reaches the DOM as nothing.** React Native Web 0.21 does not
  forward the object form at all, so a selected priority chip carried no `aria-pressed` and
  a ticked person no `aria-checked`. The ARIA props (`aria-pressed`, `aria-checked`) are
  what work, and React Native accepts them too, so this is not a web-only spelling.
- **A browser decides whether a touch belongs to a scroll as the finger lands, and never
  looks again.** So a card cannot ask for the touch back when a long press completes:
  `preventDefault()` on the first move is already too late, holding the scrolling ancestors
  still is too late, and setting `touch-action` at that point is ignored. Chrome takes the
  pointer away with a `pointercancel` and the card dies in mid-air. All three were measured
  here, in that order. Declaring `touch-action: none` up front does work, and is what every
  gesture library does, `react-native-gesture-handler` included, but on this board the
  cards *are* the column, so that is a column that will not scroll, for the person who
  scrolls most. The web drag therefore lets the browser win: the scrolling ancestors are
  held still so the pan moves nothing, and `pointercancel` on a touch is not the end of the
  drag, because *touch* events keep coming and the finger is still on the card. Native is a
  separate file and has none of this; there the gesture handler arbitrates with the scroll
  view properly.
- **React Native Web recognises a press through its responder system**, on the mouse and
  touch events that arrive alongside pointer events, and a mouse is not retargeted by
  pointer capture. Left alone, releasing a dragged card reads as a tap on whatever is under
  it, usually the card in its new place, and the board navigates into it. The drag holds
  those events at the document, in the capture phase, while a card is up, and swallows the
  click that follows a drop.
- **A touch belongs to the element it landed on for as long as it lasts.** Unmount that
  element mid-gesture and the events go where nothing can hear them. Both halves of the
  drag depend on this: the row of a lifted card stays mounted and flattened to nothing
  rather than being removed, and below the breakpoint every pane is mounted with one
  visible, so an edge hold that walks the board does not take the card's own element with
  it.
- **Paper names its own scrim, in English, and `Dialog` gives you no way to change it.**
  `Menu` takes `overlayAccessibilityLabel`; `Dialog` hard-codes its `Modal`'s to "Close
  modal". A Swedish screen-reader user got that mid-sentence on every dialog in the app.
  `useModalFocus` already reaches into the portal DOM by `testID`, so it relabels the
  backdrop there, which is cheaper and safer than rebuilding `AppDialog` on `Modal` to fix
  a word.

## Node detail

Every node has a detail screen carrying its notes, due date, priority and effort, and a
node without children opens it on a tap, because a node is a board only once it has a step
in it.

The four fields had been on the document, validated by the rules and indexed (or
deliberately exempted) since the node shipped, and on no screen at all. This is the screen
that was being waited for.

### Reaching it

Three ways in, one screen:

- **Tapping a card with no steps.** `hasSteps(node)` is false, so the card has no chevron
  and the tap goes to the details rather than to an empty board.
- **`Details…` on any card's overflow menu.** The only way in for a card that *is* a board.
- **An app-bar action on the board you are standing on**, showing its own node's details.
  It carries a dot when there is anything in them, which `hasDetails(node)` defines as a
  due date, a priority, an effort or a non-empty note, so opening it is a decision rather
  than a lottery. Steps are not counted there; they have a chevron of their own. The root
  board has no node and so no action.

### The screen

`Appbar` with the node title and a back arrow that prefers real history and falls back to
the parent board. Neither half is optional. `router.back()` alone is a no-op on a screen
reached by reload or a shared link, which logs `GO_BACK was not handled by any navigator`
and leaves the arrow dead, the same trap the board hit. And the parent board alone pops
the board you were standing on when you reached the details from *its* app-bar action,
landing you a level above where you started.

Fields, in this order, each a Paper component on a surface, spaced from `space`. The screen
is the same at every width, laid out with `contentWidth` the way the other non-board
screens are.

| Field | Control |
| ----- | ------- |
| Due date | a `Button` showing the date or *Add a date*, opening `DatePickerModal`; a `Clear` action when set |
| Priority | a wrapping row of chips, four values, tapping the selected one clears it |
| Effort | the same control, five values |
| Notes | multiline `TextInput`, `maxLength` 10 000, with the `Saved hh:mm` line beneath |
| Who's in on this? | checkbox rows of the home's members; **root only** |
| Who's doing it? | the same control, over the assignable members |
| Who can see this project? | two chips, *Everyone in the home* / *Only the people I choose*; **root only** |

Then **Steps**: a count line, the children as plain rows in board order, an *Add step*
button, and *Open board* once there is at least one. With no steps it reads *No steps yet*
and offers only the button. `Add step` opens the same `TitleDialog` the board uses, creates
the child with `rankAtEnd` of the parent's first column, and stays on the details. Ingrid
types three steps in a row without the screen moving under her. The list is deliberately
read-only beyond adding: reordering, moving between columns, renaming and deleting all stay
on the board, so there is one place that does the complicated things.

**Priority and effort are a wrapping row of chips, not `SegmentedButtons`.** Segments
divide the width evenly and ellipsize what does not fit, and these labels are words: at
390px the five effort segments came out as *Und… · Und… · An … · A w… · Sev…*, where the
first two are "Under 30 min" and "Under 2 hrs" rendered as the same string, and `sv-SE`
clipped "Brådskande" to "Bråds…". That defeats the reason the values are words at all.
`PROJECT.md` chose "an evening" over "< 2 h" because a math symbol is not what a
71-year-old at 200% text can read, and an ellipsis is worse than either. Chips wrap instead
of shrinking, so every label stays whole and the row gets taller.

Neither field has a *None* value. Tapping the selected chip clears it, because a chip
meaning "not set" is indistinguishable from no selection, and a value that cannot be
removed is one people learn not to set.

**Effort stays editable on a project.** `PROJECT.md` says effort is on tasks only, and a
node with children is unambiguously a project, but "tasks only" is enforced where effort
is *used*: quick wins and the split nudge
([#56](https://github.com/Senth/home-backlog/issues/56)) both take `childCount === 0`.
Hiding the control was rejected because the value would disappear at the exact moment it
mattered most. The nudge fires on *effort ≥ a weekend and no children*, so accepting it and
adding a first step would delete the field that fired it from view.

*Rejected:* a details panel pinned to the left of the status columns on desktop. Real, and
left to [#31](https://github.com/Senth/home-backlog/issues/31), which owns desktop layout.
Building it here would mean two layouts for one content definition before the content has
been used once.

#### The three people controls

**All three are hidden while the home has one member.** Ingrid is alone in her house and
one of four people at the cabin; in the house, participants (nobody to involve), assignees
(only her) and privacy (nothing to hide from) are clutter on the screen she uses to write
down what the chimney sweep said, at 200% text. The one exception: a node that is *already*
private always shows the visibility control, so a home that drops back to one member can
undo it rather than being stuck with a setting it cannot reach.

Both people controls are built from `membersOf(activeHome)`, with no listener and no read.

**Checkboxes, not chips.** These are people rather than one-of-a-scale values: several are
ticked at once, ticking one is not "instead of" the others, and a row of green chips reads
as a state machine. A search-and-add picker above four members is
[#88](https://github.com/Senth/home-backlog/issues/88); checkboxes serve every household
that exists today.

**The assignee checkboxes offer the effective participants**: the root's `participantIds`,
or every member of the home when that is empty, which is the common case and has no
friction at all. It is not a stylistic restriction. With the default-hide filter, assigning
somebody a step inside a project they are not a participant of hands them work that is
*hidden from their board and reachable from nowhere*. Adding them to the project is what
makes the task findable, and the hint under the control says so and takes you there.

The reverse, somebody assigned who has *since* been removed from the project or who has
left the home, is a real state and is deliberately shown rather than hidden: a named
sentence with a clear action, never a stray checked box outside its own list. It is
information, and drawing it as an orphaned checkbox is what would make it read as a bug. A
member who has left renders through the existing `members.unknown`, as *Someone*.

The root a descendant reads its participants from is its own single-document listener,
not the breadcrumb memo. `useAncestors` never invalidates within a session, which is right
for a crumb title and wrong for an ACL: participants edited on the project would otherwise
leave a step's assignee list narrowed to the old set, with the "Only people in X are shown"
and stale-assignee sentences saying something untrue until a reload. A node that is itself a
root subscribes to nothing extra.

**On a descendant there is no participants control and no visibility control**, just one
sentence each, and only when it has something to say. *Change who's in on…* navigates to
the root's detail screen; *Move … to the top level* makes the same `reparentNode` call
`Move under… › Top level` does, and needs a connection for the same reason.

**On a private project you are the one person who cannot come off it.** That row is locked
with the reason written under the list rather than left as a checkbox that silently
refuses. The rules would deny the write, and a control that refuses without saying so is
the failure the whole checkbox rebuild exists to avoid.

Changing participants on a private project runs the [flip](#the-flip-is-the-dangerous-part)
rather than a plain update, with the same offline disable and the same progress dialog: the
list is the ACL there, and the rules require every descendant to carry all of its parent's
participants, so a plain update would hand somebody a project whose steps they still could
not read. An empty board is the worst possible answer to "you have been let in".

The confirm dialog before a flip names the people and says what happens to the work, and is
careful in both directions. It says "and everything in it" rather than a count. The
flip writes the whole subtree and `childCount` is direct children only, so a project of
three tasks with six steps each would promise "its 3 steps" and then count to 22, a
privacy confirmation understating its own reach. Going shared it adds that the
project stays off other people's boards while its participants are set, because the
permission really does change and the observable outcome does not.

### Saving has four triggers because one of them always fails

Every control writes on the spot. Pickers need no acknowledgement, because the control
showing the new value *is* the acknowledgement.

Notes are the exception, and blur alone loses them. Ingrid types what the chimney sweep
said, taps the app-bar back arrow, and the screen unmounts; whether blur fires first is a
platform detail, not a guarantee. There is no Save button she failed to press, no warning,
no snackbar. She concludes the app does not keep things and does not report it. So notes
write on a pause in typing, on blur, on unmount, and on the app going to background. That
last one is `visibilitychange` on web and `AppState` on native, because a backgrounded PWA
can be killed without any of the other three firing, and `beforeunload` is not delivered on
that path at all.

`useAutosave` holds the outstanding text in refs rather than state, because an unmount
cleanup closes over the render that registered it, which is exactly the text that would be
lost.

And a `Saved 10:42` / `Sparat 10:42` line sits under the field, because even a write
that succeeds says nothing, and silence reads as "did not take" to anyone who has pressed
Save on every device they have owned. The line reports the *local* write, which is durable
immediately; `OfflineBar` already says the rest, and nothing user-facing blocks on the
server acknowledgement.

### Offline on the detail screen

Most writes on this screen queue: the four fields and both people-fields go through
`updateNode`, and `Add step` through `createNode`.

The exceptions are the ones that read a subtree from the server first, and they are
disabled with a hint rather than left to fail after the fact: the visibility flip,
participants on an *already private* project, and *Move … to the top level*. `Move under…`
and `Delete` on the board are the same case.

### One dependency

`react-native-paper-dates`, for `DatePickerModal`. It is the Paper ecosystem's own date
picker, takes the app's Material 3 theme without a second palette, works under React Native
Web and on native, and registers translations per locale, under the app's own `en-US` and
`sv-SE` tags, so one value flows through both it and `i18n`.

*Rejected:* a `<input type="date">` behind a `.web.tsx` split. Free and locale-aware for
nothing, but it cannot be themed, and it needs a whole second implementation the first
time a native build happens, which `PROJECT.md` schedules rather than rules out.

## Out of scope

- **A progress bar of any kind.** Direct-children bars lie about nested work, and an
  honest whole-subtree bar needs `descendantCount` fanned out across `ancestorIds` on
  create, delete and reparent. Its own issue.
- **Due-date quick picks**, [#83](https://github.com/Senth/home-backlog/issues/83).
  *This weekend · This month · Before winter*, for people who do not think in calendar days.
- **A configurable tap**, [#84](https://github.com/Senth/home-backlog/issues/84). Whether
  a tap opens the board or the details, once there is usage saying which way people reach.
- **Reminders and notifications on a due date.** Nothing acts on dates yet, which is why
  overdue is words rather than red. #54 and #55 are where a date starts to do something.
- **Effort derived from a project's children**, deliberately not filed. Try the editable
  field first and see what it is like to live with.
- **Reordering, moving, renaming or deleting a step from the detail screen.** The board
  does that.
- **Per-board column configuration and relabels**,
  [#63](https://github.com/Senth/home-backlog/issues/63). The field it edits ships here, so
  #63 is a screen and not a schema change.
- **My tasks, unassigned, and what is in progress anywhere**,
  [#62](https://github.com/Senth/home-backlog/issues/62). Narrowed by the default-hide
  filter, which shipped here because participants have no observable effect without it.
  *My tasks* reads `assigneeIds`; whether it also means "unassigned work in a project I
  participate in" is #62's starting point, not settled here. *Unassigned* stays client-side
  either way, because Firestore cannot query for an empty array.
- **A search-and-add member picker above four members**,
  [#88](https://github.com/Senth/home-backlog/issues/88).
- **What happens to a removed member's private nodes**,
  [#39](https://github.com/Senth/home-backlog/issues/39). `members.removeBody` already
  warns about it and nothing here changes the cascade.
- **Notifying somebody that they have been assigned.** Nothing in the app notifies yet, and
  Nadia's notifications are off. The card face is the notification.
- **Persisting the *Show everyone's projects* toggle.** A board always opens in the hiding
  state, the same way it always opens on its first column.
- **Bulk subtree create over REST.** Shipped, and it escapes the top-down constraint
  rather than obeying it: the function writes with the Admin SDK, which no rule evaluates,
  so a whole subtree commits in one atomic batch and the ordering problem the flip has
  does not arise. What that costs is every invariant on this page re-stated in TypeScript,
  which is [`rest-api`](rest-api.md)'s subject. `rankSequence` exists for it, board-ness
  stays derived, and the endpoint maintains both counters itself. Of the two people-fields
  a key may write `assigneeIds` and may not write `participantIds`, which is an ACL on a
  private node, so writing it would let a bearer token revoke a member's read.
- **Locations**, [#50](https://github.com/Senth/home-backlog/issues/50),
  [#51](https://github.com/Senth/home-backlog/issues/51). The two location fields are
  written and inherited, but nothing maintains them when a *location* moves.
- **Nesting by dropping a card onto a card.** *Move under…* stays the only way to nest, and
  the drag has no drop-onto-card target at all rather than an affordance that does nothing.
  Its missing Undo is [#79](https://github.com/Senth/home-backlog/issues/79).
- **Cancelling a lifted card by dropping it outside the board**,
  [#129](https://github.com/Senth/home-backlog/issues/129). The Undo on every drop covers
  the recoverable case; #129 is for the person who would rather not have committed at all.
- **Selecting several cards and moving them at once**,
  [#130](https://github.com/Senth/home-backlog/issues/130), by drag *and* from the card
  menu. Not before single-card drag has been lived with; a multi-select gesture layered on
  a drag nobody has used yet is a guess. That is where `rankSequence` finally gets a caller
  in the UI.
- **A keyboard drag.** The card menu is the keyboard path, by design.
- **Archive** #64, **Done newest-first** #76, checklists #52, photos #53, blocked-by #66:
  fields only, or not yet. An archive *cascade* over a subtree carries the same top-down
  constraint as the visibility flip. Checklists and photos are both on the document and on
  no screen, and both belong on the detail screen when they arrive.
- **Cost and budget fields**, [#70](https://github.com/Senth/home-backlog/issues/70).
  `PROJECT.md`: notes absorb it until the real need is understood.
- **One-tap done on the card row**, [#75](https://github.com/Senth/home-backlog/issues/75).
  **Custom statuses**, [#69](https://github.com/Senth/home-backlog/issues/69).
  **Swipe between columns**, [#78](https://github.com/Senth/home-backlog/issues/78).
  **Desktop beyond side-by-side columns**,
  [#31](https://github.com/Senth/home-backlog/issues/31).
- **A full destination picker** for `Move under…`. Browsing the whole tree is a second
  navigation screen with its own query-safety story.
- **A Cloud Function for node operations.** Not needed: the invariants keep reparent and
  delete client-side and offline-capable.
  [#39](https://github.com/Senth/home-backlog/issues/39) stays scoped to home deletion and
  member removal.
