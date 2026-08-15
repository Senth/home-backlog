# Boards and nodes

Every board, project, task and subtask in the app is the same document: a **node**, in
`homes/{homeId}/nodes`, hanging off the home that [`home-and-members`](home-and-members.md)
describes. A project, a task and a subtask differ only in depth, and any node with children
can be opened as a board.

This spec covers that document — its full field set, the invariants `firestore.rules`
enforces on it, the queries that load a board and a subtree, the indexes those queries
need, the writes that create, edit, move and delete one — and the screens that render it:
the projects board, drill-down with breadcrumbs, and everything a card can do.

## The shape of it

One flat collection, `homes/{homeId}/nodes`, with `parentId` and a denormalized
`ancestorIds[]`. A board is the children of one node — or of the root, where `parentId` is
`null`. Depth is **derived** from `ancestorIds.length`, never stored.

Two hierarchies cross here and neither is a parent of the other: the project tree
(`parentId` / `ancestorIds`) answers *what*, and the location tree (`locationId` /
`locationAncestorIds`) answers *where*. A node moving in one never moves in the other.

## Data

### `homes/{homeId}/nodes/{nodeId}`

Every field is written on create, with the default below.

| Field | Type | Default | Notes |
| ----- | ---- | ------- | ----- |
| `title` | `string` | — | 1–200 characters |
| `status` | `Status` | `'backlog'` | `backlog` `next_up` `research` `planning` `execution` `review` `done` |
| `columns` | `Status[]` | by depth, see below | the column set of the board this node's **children** form |
| `rank` | `string` | `rankAtEnd(last)` | fractional index, ordered within `(parentId, status)` |
| `parentId` | `string \| null` | `null` | `null` is a root node |
| `ancestorIds` | `string[]` | `[]` | root → parent; the last element equals `parentId` |
| `locationId` | `string \| null` | parent's | inherited unless overridden |
| `locationAncestorIds` | `string[]` | parent's | denormalized location path |
| `participantIds` | `string[]` | `[]` | empty means unassigned |
| `visibility` | `'shared' \| 'private'` | parent's, else `'shared'` | equals the parent's, always |
| `dueDate` | `string \| null` | `null` | `'YYYY-MM-DD'` |
| `priority` | `Priority \| null` | `null` | `low` `normal` `high` `urgent` |
| `blockedBy` | `string[]` | `[]` | node ids — [#66](https://github.com/Senth/home-backlog/issues/66) |
| `notes` | `string` | `''` | ≤ 10 000 characters |
| `checklist` | `ChecklistItem[]` | `[]` | `{ id, text, done }`, ≤ 200 — [#52](https://github.com/Senth/home-backlog/issues/52) |
| `effort` | `Effort \| null` | `null` | `quick` `hours` `evening` `weekend` `multi_week` |
| `photos` | `Photo[]` | `[]` | `{ id, path, uploadedAt, uploadedBy }`, ≤ 50 — [#53](https://github.com/Senth/home-backlog/issues/53) |
| `archived` | `boolean` | `false` | constrains every board query |
| `completedAt` | `Timestamp \| null` | `null` | set if and only if `status == 'done'` |
| `createdAt` | `Timestamp` | `serverTimestamp()` | immutable |
| `createdBy` | `string` | uid | immutable |
| `updatedAt` | `Timestamp` | `serverTimestamp()` | staleness input for [#55](https://github.com/Senth/home-backlog/issues/55) |

`Priority` and `Effort` are string ids with an ordinal map (`priorityOrder`,
`effortOrder`) beside them, so sorting and scoring never depend on the id's spelling and a
new value needs no migration — the same reason `status` is a string id. `effort`'s ids are
semantic (`quick`, `evening`) rather than duration-shaped, because "an evening" has no
numeric form and retuning "< 2 h" must not become a migration.

`photos[].path` is a Cloud Storage path, never a download URL — URLs carry tokens that
rotate.

### A field that is absent can never be queried

Firestore does not index absent fields, so `where('archived', '==', false)` silently skips
every document written before `archived` existed. Adding a *queried* field later is a
backfill, not a schema change.

That is why `archived` and `completedAt` are written from the first document even though
[#64](https://github.com/Senth/home-backlog/issues/64) and
[#54](https://github.com/Senth/home-backlog/issues/54) own the features that use them, and
why `completedAt` in particular could not wait: a completion date is not reconstructible
after the fact, and deriving it from `updatedAt` is wrong the moment anyone edits a
finished node.

`columns` is the one field that could safely arrive later, and did: it is only ever read
with the document it sits on and is never queried, so it needed no backfill and no index.
Every other field was there from the start.

*Rejected:* writing only the mandatory fields and defaulting the rest client-side. It
saves ~200 bytes per document and buys the absent-field trap on every optional field.

*Rejected:* writing all fields with no index tuning. Index entries, not document bytes,
are the cost — see [the index](#storage-cost-lives-in-the-index-not-the-document).

### `blocked` is not a status

The vocabulary is seven values. Being **blocked is a condition, not a stage.**

A card is in exactly one status, so parking one in Blocked destroys the stage it was in,
and nothing says where it goes when the blocker clears. `blockedBy[]` already exists on the
document and is already the actionability test the suggestion engine
([#55](https://github.com/Senth/home-backlog/issues/55)) uses, so the condition has a home
that is not `status`: the card stays in its real column and shows a mark. Nothing in the UI
writes `blockedBy` yet — that is
[#66](https://github.com/Senth/home-backlog/issues/66) — so it arrives from the REST API
or a fixture until then.

*Rejected:* keeping `blocked` in the enum and merely not displaying it. A value nothing
writes and nothing shows is a trap for the REST API
([#7](https://github.com/Senth/home-backlog/issues/7)) and for whoever reads the enum next.

`toNode` coerces an unrecognised status to `backlog`, so a document carrying the old value
renders in To do rather than crashing a board.

### The column set is chosen by depth, then frozen

`columns` is the column set of the board formed by a node's **children**, decided once when
the node is created from the node's own depth (`ancestorIds.length`):

- depth 0 → the **full stage set**, all seven. Its children are depth 1, and `PROJECT.md`
  gives the full set to the root board and to a board inside a project.
- depth ≥ 1 → the **simple set**, `backlog` / `execution` / `done`. A research column whose
  cards each contain their own research column is nonsense.

The **root board is not a document.** It cannot be moved, deleted or reparented, so there
is nothing for a freeze to protect: its set is the `rootColumns` constant in
`models/node.ts`. [#63](https://github.com/Senth/home-backlog/issues/63) is where a stored
root set earns its keep, and can put one on the home document.

*Frozen* means the app never recomputes `columns` when a node moves. It does **not** mean
immutable: the rules validate the shape and let the value change, because #63 is exactly
the feature that changes it, and locking it would make #63 a rules change before it could
be a screen.

*Rejected:* deriving the columns from depth at render time. It costs no field, and moving a
subtree from depth 1 to depth 2 then silently swaps the full stage set for the simple one —
stranding every card that was in Find out or Check in a column that no longer exists.

**A column that is not in the set still renders.** A board shows its frozen columns in
order, and any status *present in the data but absent from `columns`* gets an extra column
appended after them, in enum order (`visibleColumns`). It appears only while such a card
exists and disappears when the card is moved out; the move menu offers only the frozen
destinations, so it is a one-way exit. Without it, `Move under…`, the REST API and a seeded
fixture can each put a `research` card on a simple-set board, and the board would render as
though the card were not there. A card that exists is visible somewhere — the same
principle as the orphaned node the visibility invariant exists to prevent.

## Privacy is uniform across a subtree

**A node's `visibility` equals its parent's. Only a root node — `parentId == null` — sets
it.** A private node's `participantIds` must also contain all of its parent's.

This is less a rule about privacy than the rule that makes privacy *queryable*. Firestore
has **no field-level read rules**: a document is readable or it is not, so there is no way
to expose a node's id and hide its title. And a query may contain only **one**
`array-contains` clause, so `ancestorIds array-contains X && participantIds array-contains
me` is not expressible. Without the invariant, no client query can see another member's
private descendant — which means a reparent leaves it with stale `ancestorIds`, and a
delete orphans it permanently, with no error anywhere and no way to find it afterwards.

With the invariant, both subtree reads are provably safe *and* complete:

| Subtree of | Query | Complete because |
| --- | --- | --- |
| a **shared** node X | `ancestorIds ⊕ X && visibility == 'shared'` | a shared node's descendants are all shared, transitively |
| a **private** node X | `participantIds ⊕ me`, `ancestorIds` filtered client-side | I am a participant of every descendant of a private node I can read |

The cost is a product restriction: **a private card cannot live inside a shared project.**
It sits at the root, or under another private card.

That restriction is worth having on its own merits. A hidden child makes its parent lie —
one member sees eight subtasks and another sees seven, so every count derived from children
diverges per viewer: progress, location roll-ups, and the "all 8 subtasks are done — move
this to Review?" nudge ([#65](https://github.com/Senth/home-backlog/issues/65)). A private
*project* is cleanly absent for everyone not in it. "Celebration" as its own private
project is the honest shape of what a private card was reaching for.

`newNodeData()` upholds both halves by construction — a child takes its parent's
visibility whatever the caller asked for, and a child of a private parent starts with that
parent's participants — so the rules are the backstop rather than the first line. The card
menu upholds it too: `Move under…` offers only destinations with the **same** visibility,
because offering the others would be offering a permission error.

*Rejected:* a skeleton document per node — structure in a readable `nodes/{id}`, content in
a restricted child. It doubles every write and leaks that a hidden card exists, where it
sits and when it is due. A phantom card on the board is worse privacy than none.

*Rejected:* a Cloud Function with the admin SDK for reparent and delete. It closes the hole
without the restriction, but a callable **cannot run offline**, and `PROJECT.md`'s own
principle is that work happens in basements, sheds and gardens. Deleting a card without
signal is ordinary.

## Queries

Each one is shaped so that *every document it can match* is one the caller may read.
Firestore rejects an entire query if any matching document could be denied, so being
rule-safe is not enough. The node read rule is `isMember(homeId) &&
visibleToMe(resource.data)`, and `isMember` is resource-independent — so it holds for every
document in the collection, and each query below constrains one of `visibleToMe`'s two
disjuncts.

**A board** — the children of one node, or of the root. Two listeners, merged, held by
`useNodes`. Every board at every depth is this same pair, with `parentId` set to the node
being drilled into instead of `null`; drill-down added **no new query shape and no new
index**.

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

The two results are **merged, deduped by id, then sorted `(rank, id)`** and grouped into
columns by `status` client-side. Deduping is required, not defensive: a *shared* node I
participate in matches **both** queries. One query per board rather than one per column
keeps the listener count at two regardless of how many statuses a board shows.

Costed the way `PROJECT.md` costs things: roughly one extra document read per board load,
billing being per document rather than per query. It buys the free `array-contains` slot on
Q1 for `locationAncestorIds` later.

**The board's own node** — one single-document listener, `useNode(homeId, nodeId)`. Three
constrained listeners per board rather than two. It buys two things a one-shot read cannot:
a rename by another member updates the title on the screen you are looking at, and a card
deleted under you — `deleteNode` takes the whole subtree — bounces you to the parent board
with a message instead of leaving you on a board that no longer exists. A node that cannot
be read, or does not exist, is the same bounce.

Two things that listener has to get right, both of which were shipped wrong first:

- It subscribes with **`includeMetadataChanges: true`**. A document missing in the cache
  *and* missing on the server never changes, so the server's confirmation is a
  metadata-only event, which Firestore suppresses by default.
- A missing document is only *believed* once the server has said so — a cache miss is held,
  not answered. Offline, a board never opened while online resolves immediately as missing,
  and announcing a deletion that did not happen is worse than waiting.

**Breadcrumbs** — one `getDoc` per id in `ancestorIds`, issued in parallel, each handled on
its own, memoized for the session in `hooks/use-ancestors.ts`. An ancestor that cannot be
read costs one rejected promise and renders as a neutral crumb.

That case is real rather than theoretical: participant inheritance runs **downward** — a
private child holds all of its parent's participants, not the reverse — so being added to a
private subtask does not grant a read on the private project above it.

The memo is keyed by **uid**, home and node id, and dropped whole when the uid changes.
Signing out does not reload the page, so on a shared device the next member would otherwise
be handed a title the previous one was allowed to read — drawn as a real, tappable crumb
rather than the neutral one the design exists for. Only nodes that were actually read are
remembered: a failure can be a cold cache or a dropped connection, and remembering *that*
would leave a crumb reading "Hidden" for the rest of the session after the connection came
back.

*Rejected:* `where(documentId(), 'in', ancestorIds)`. One read instead of *n*, and it is
**query-unsafe**: a single unreadable ancestor rejects the whole query and every crumb
disappears at once. Rule-safe but query-unsafe is the exact failure `CLAUDE.md` forbids.

*Rejected:* carrying the trail in router params. Free while navigating in-app, empty on
reload or on a shared link — and a board reached by URL is the case breadcrumbs exist for.

**The destination board, when re-parenting.** `reparentNode` takes a rank computed against
the target board's neighbours, and that board is not on screen. `Move under…` therefore
reads it once with the same two queries (`getDocs`, not a listener) and computes
`rankAtEnd` of the column matching the moved card's status. Deliberately *not* from the
server, unlike the subtree reads: a stale neighbour costs a card that lands in the wrong
place in a column, which the next reorder fixes, where a stale subtree orphans documents.

**A shared node's subtree** — one-shot, for reparent and delete.

```ts
query(nodesRef(homeId),
      where("visibility", "==", "shared"),
      where("ancestorIds", "array-contains", nodeId))
```

Safe by the same first disjunct, and complete by the uniform-visibility invariant. No
`archived` filter: a subtree operation moves or deletes archived descendants too.

**A private node's subtree** — one-shot, same callers.

```ts
query(nodesRef(homeId),
      where("visibility", "==", "private"),
      where("participantIds", "array-contains", uid))
// then filter ancestorIds.includes(nodeId) client-side
```

The second `array-contains` is not expressible, so the ancestor test is client-side. Safe
by the rule's second disjunct — `participantIds array-contains uid` alone proves that — and
complete by participant inheritance.

The `visibility` clause is what *bounds* it. Being a participant is also how assignment on
an ordinary **shared** card works, so without that clause this reads every card assigned to
me anywhere in the home on each private reparent or delete. Private nodes are small by
construction; assigned ones are not.

### Storage cost lives in the index, not the document

A document is 32 bytes plus its path plus its fields; twenty-two fields with empty defaults
come to roughly 200 bytes. An **index entry** is 32 bytes plus the full document path —
about 110 bytes here — plus the value, and every automatically indexed scalar has two of
them. One null scalar is therefore ~290 bytes of index, more than ten times what it costs
in the document.

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

Single-field indexing is **disabled** for `title`, `columns`, `notes`, `checklist`,
`photos`, `effort`, `priority`, `rank`, `archived`, `createdBy` and `updatedAt`. `columns`
is a new array field that Firestore would otherwise index at roughly two entries per
element, and nothing queries it. `rank` and `archived` appear only inside composite
indexes, which an exemption does not affect. Left automatically indexed, because a later
feature filters on them alone: `status`, `parentId`, `visibility`, `locationId`, `dueDate`,
`completedAt`, `createdAt`, and the other array fields.

The emulator indexes everything on the fly and can never surface a missing index — the same
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
  status     in the seven-value enum
  columns    is a list, size 1..7, every entry in the same seven
  rank       is string, size > 0
  parentId   == null or is string
  locationId == null or is string
  ancestorIds, locationAncestorIds, participantIds, blockedBy  are lists
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

The status vocabulary is written once, as `allStatuses()`, because `status` and every entry
of `columns` are drawn from it and the two must never drift.

`request.resource.data` is the full post-update document, so `validNode()` costs the same
on an update as on a create and no partial-patch case can slip past. Reading a field that
is absent is an evaluation error, which denies the write — which is why "every field is
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
card is gone" — so the screen listening to it had a failure to log instead of a fact to act
on, and deleting a card while another member is standing on its board is ordinary rather
than exotic.

`list` keeps the strict form. A query never matches a document that does not exist, so
nothing about query safety changes.

### Rules cannot see the rest of a batch, so the invariants are split

A `get()` inside a security rule reads **committed** state. It does not see other writes in
the same `writeBatch` or transaction. So a rule that validates a child against its parent's
*new* value fails for every write that changes both at once.

The two invariants are therefore enforced differently, chosen by whether the rule needs to
see the parent change:

- **Visibility and participants** — enforced with a `get()` on the parent. During a
  reparent the parent's visibility does not change and the new parent is not in the batch,
  so the `get()` reads correct state **inside a batch**.
- **`ancestorIds`** — validated structurally, with no `get()`: the last element must equal
  `parentId`, and a node may not be its own ancestor. A descendant's `parentId` does not
  change during a reparent, so its rewritten `ancestorIds` passes **inside a batch** too.

Reparent and delete stay atomic. The unrecoverable invariant stays enforced.

### The parent `get()` is spent only where it can matter

A batched write may make at most **twenty document access calls in total**, across every
document in it. An update rule that always reads the parent therefore caps a subtree move
at twenty distinct parents — and fails as a bare permission error, with nothing to say that
size was the cause. A project whose twenty tasks each have a subtask is an ordinary
Saturday, not scale-check territory.

So `privacyUnchanged()` gates the `get()`: a write that moves neither `parentId`,
`visibility` nor `participantIds` cannot break the invariant, and skipping the read is not
weakening the check but declining to re-prove something this write does not touch. A
reparent's *moved* node still pays it — its `parentId` changes — while its descendants and
every ordinary edit do not. The shape matters as much as the size, because a rule
evaluation caches a `get()` per path: twenty siblings under one parent cost one call
between them, and it is *distinct* parents that spend the budget. The rules test moves a
subtree past it deliberately.

The one window this opens is during a top-down visibility flip (#61): a child edited
between its parent's flip and its own is let through while temporarily mismatched, and the
flip then reaches it. The failure all of this exists to prevent is a *silent orphan*, and
producing one needs `parentId` or `visibility` to change — which is exactly the case that
still pays for the `get()`.

What this gives up is full-path verification — a wrong *grandparent* id passes the rules.
That is the recoverable class of error: `parentId` is the source of truth and `ancestorIds`
is derived from it, so a corrupt path is always recomputable, and `movedAncestorIds()`,
the function that builds it, is unit-tested.

*Rejected:* sequential top-down writes with a full `get()`-checked ancestor path. Maximum
enforcement, but it trades atomicity on every subtree operation and imposes an ordering
discipline everywhere from day one.

*Rejected:* structural rules only, with no `get()` at all. Simplest rules, and it leaves
uniform visibility enforced by the client alone — so a bug, or the REST API (#7),
reintroduces the silent orphan.

Operations that **do** change visibility, or create a parent and a child together, still
cannot be batched: the subtree visibility flip
([#61](https://github.com/Senth/home-backlog/issues/61)) and bulk subtree create (#7) must
write **top-down, one document at a time**. They fail loudly — a permission error — if they
forget, which is the right way for that constraint to be discovered.

## Rank

`rank` is a **fractional index** from day one. Drag and drop
([#5](https://github.com/Senth/home-backlog/issues/5)) is deliberately post-MVP, so `rank`
exists now purely to make it a UI change with no data migration.

A rank is ordered **within its `(parentId, status)` column** — that is what a board reorder
manipulates. Moving a card to another column recomputes its rank from that column's
neighbours in the same write as the status change.

`rankBetween`, `rankAtEnd` and `rankSequence` in `models/node.ts` wrap
`fractional-indexing` over a base-62 alphabet.

*Rejected:* rank global per parent. A card keeps its value across a column change, but
dropping it at the top of another column still has no valid rank to take, so the rewrite
happens anyway and the invariant is weaker for nothing.

*Rejected:* float ranks with renormalization. Around fifty repeated midpoint inserts at one
spot exhaust double precision, and the renormalization pass rewrites a whole column — a
batch write that fails offline, which is exactly where drag and drop gets used.

*Rejected:* hand-rolling the base-62 midpoint. It is the same algorithm
`fractional-indexing` implements, and the fiddly parts — the integer-length prefix, the
no-trailing-zero normalization, the unbounded ends — are where a hand-rolled version
breaks. `generateNKeysBetween` is also exactly what #7's bulk create needs.

Two people offline can still produce the same rank between the same neighbours. The client
sort is therefore **`(rank, id)`**, always, so a tie renders identically on every device and
the next drag breaks it permanently. No extra field, no write, and it covers ties arriving
from the REST API or a seeded fixture too.

## `dueDate` is a calendar day, not an instant

`'YYYY-MM-DD'`. "Clean the gutters by Sep 30" is the same day in every timezone, and
lexicographic order is chronological, so `orderBy` and range queries work unchanged. A
`Timestamp` would need a pinned timezone on every read and write or drift a day, and the
season *windows* in `PROJECT.md` (Sep 1 – Nov 30) would become instants.

## Writes, and what each one may touch

`data/nodes.ts` carries five writes, split by what they have to keep consistent:

- **`createNode`** returns the new id immediately — it is generated on the device, not by
  the server — alongside an `acknowledged` promise that resolves when the server has the
  write. A caller that awaits that promise before closing a sheet has built a form that
  hangs in a shed, so the failure is logged inside `createNode` too: an ignored rejection
  is an unhandled one, and that surfaces as a console error nobody owns. It also puts the
  author into `participantIds` on a private *root* card, which has no parent to inherit
  them from and which the rules refuse without them.
- **`updateNode`** takes everything *except* structure, status, rank and visibility, each
  of which belongs to one of the others.
- **`moveNode`** changes `status` and `rank` together, because a card arriving in another
  column takes a rank computed from that column's neighbours. It owns `completedAt`, which
  follows the status in both directions — and a node that was already done keeps the date
  it has, because "completed" must not quietly become "last touched".
- **`reparentNode`** rewrites `ancestorIds` for the node and its whole subtree in one
  batch, plus the moved node's `rank` — a rank is ordered within its `(parentId, status)`
  column and a new parent is a new column, so the caller passes one computed from the
  target board's neighbours. `locationId` is untouched: a node moving in the project tree
  never moves in the location tree. Moving a node into its own subtree throws before any
  write.
- **`deleteNode`** deletes the subtree and the node in one batch. A node whose parent is
  gone is unreachable from every board and every breadcrumb.

### Offline

`createNode`, `updateNode` and `moveNode` queue optimistically. That is Firestore's default
and it is what a board in a shed needs.

`reparentNode` and `deleteNode` **require a connection**, and the screens that call them
disable the action with a hint — the pattern [`home-and-members`](home-and-members.md)
already applies to creating a home and sending an invitation. Both read the subtree first,
and they read it **from the server** rather than the cache: offline the cache holds only
the boards that happen to have been opened, so a subtree delete would silently miss
descendants and orphan them, which is precisely the failure the visibility invariant exists
to prevent. Reading from the server turns that into a loud failure.

*Rejected:* allowing an offline delete when the cache shows no children. "No children in
cache" is not "no children" — a cold cache after a reload, or a node reached by URL, brings
the orphan straight back.

## The board

One board component at every depth. `PROJECT.md`: resist per-level special cases, they
multiply. `/projects` renders the root board from `rootColumns`; `/projects/[nodeId]`
renders the same component from that node's frozen `columns`.

### Layout

- **Below `compactBreakpoint` (720)** — one column at a time, with a scrollable strip of
  chips above it: each names its column and carries its card count, the current one is
  marked, and a tap switches to it. Six of eight panes are empty in a small household, and
  without the strip a board is navigated blind — an empty pane is indistinguishable from a
  broken app. The strip is also the way back after a move, and the way to Done without
  seven swipes.
- **At 720 and above** — columns side by side, the board scrolling horizontally, each
  column on its own surface. The column headers say what the strip says, so the strip is
  not rendered.
- A board **always opens on its first column**, rather than restoring the last pane anyone
  was on.

**The pane on screen is state, set only by a tap on a chip.** It is never read back from a
scroll position, and that is not a stylistic preference. It was a swipeable pager, and the
pager is what broke it: a scroll-snapping container is not something the app is the only
one moving — the browser re-snaps it when content changes and scrolls it to bring a focused
element into view. The board drifted to whichever column a card happened to land in, so
twelve cards added in a row from a FAB reading *Add to To do* went to In progress and Next
up, alternately. That is the household-fills-a-board-on-a-Saturday-morning case this
feature exists for. Swiping between columns is tracked as
[#78](https://github.com/Senth/home-backlog/issues/78) and needs a foundation where the
gesture reports *to* that state rather than the state being read *from* a scroll offset.

### The card

Title, a chevron, and a mark when `blockedBy[]` is non-empty. Due date, priority, effort and
notes wait for [#49](https://github.com/Senth/home-backlog/issues/49); a card face carrying
five metadata chips is the overwhelm this app exists to reduce.

The chevron is on every card whether or not it has children: finding out costs a query per
card, and listener breadth is this app's stated cost risk.

**Tap opens the card as a board.** That is what tap means at every depth and what it will
still mean when #49 arrives, so the gesture is not learned twice. Everything else is on an
overflow menu on the card, whose button stops the press reaching the card underneath.

### Creating a card

Title only. The add control belongs to a **column**, not to the screen: at 720 and above
each column has its own add row, and below it one FAB naming its destination in words —
*Add to To do*. Status comes from that column, so a card typed one-handed in a greenhouse
lands where the button said it would. `createNode` queues offline; the sheet closes
immediately and never waits on the acknowledgement.

A board whose own node has not arrived yet renders no board at all. `parent` is what
`createNode` receives, and a null parent is not "this board" but the **root**, so a card
added during that window would silently become a top-level project.

### The card menu

| Action | What it does |
| ------ | ------------ |
| Move to → *column* | one tap, appends at the end of that column |
| Change position… | lists the current column's cards: *At the top*, *After ‹card›* |
| Move under… | the other cards on this board, plus *Up one level* / *Top level* |
| Rename | a dialog with the title field |
| Delete | confirm, then the card and everything under it |

The menu changes *page* rather than opening a submenu: Paper's `Menu` scrolls its own
content, so a column of thirty cards is a list you scroll rather than a second overlay to
dismiss.

**Move** stays on the pane you are on and raises a snackbar naming the destination, with
**Undo**, which restores the status *and* the rank the card had — both are in hand.
Following the card would drag someone moving six cards in a row seven panes sideways;
saying nothing makes a move read as a delete, because the destination is off-screen. Only
the board's frozen columns are offered as destinations.

**Change position** is what makes ordering real. Up / down / top / bottom cannot place a
card at position three of thirty without twenty-seven taps, so the position list picks the
slot directly and `rankBetween` ranks it against its two new neighbours. The slot the card
already occupies is disabled rather than offered as a write that changes nothing.

**Move under…** is why drill-down alone was not enough. A household fills a board the day
it gets one, and nesting *new* work does nothing for work already typed; without it, the
first thing the app asks of its only user is to re-type forty cards. It lists only siblings
with the same `visibility`, never the card itself, and *Up one level* and *Top level* are
the same destination one level below the root, so they are never both offered. It has no
Undo — reversing a re-parent needs a second server read — which is
[#79](https://github.com/Senth/home-backlog/issues/79).

**Delete** warns that everything under the card goes too, in as many words, and is styled
as the destructive action the way `ConfirmDialog` already does elsewhere.

**Offline**, the split is the one the writes already draw: move, change position and rename
queue; `Move under…` and `Delete` are disabled with a hint rather than failing after the
tap.

### Breadcrumbs and navigation

*Projects › Bathroom › Tiling*, above the board, the last crumb being the current board and
each earlier one tappable. An unreadable ancestor renders as a neutral crumb rather than a
gap. The app bar names the card; the home's name is on the root board's app bar, which is
where the first crumb goes.

Navigation is a Stack inside the Projects tab — `/projects` and `/projects/[nodeId]` — so
the tab bar stays put at every depth, and browser back, the PWA back gesture, reload and a
shared link all work.

Going *up* uses `dismissTo`, not `push`: the crumbs are the stack you came down. Two things
make that work:

- The screen carries **`dangerouslySingular`** keyed on the node id. Every nested board is
  the same route *name*, and `POP_TO` matches on the name — so without an identity it
  resolves to the screen you are already on and merely swaps its params. Tapping a crumb
  then left the whole stack in place with its top re-pointed, so browser back went *deeper*
  rather than up, and every stranded screen kept its three listeners alive.
- The app-bar back arrow goes to the parent board explicitly rather than calling
  `router.back()`, which on a screen reached by reload or a shared link is a no-op that
  logs "GO_BACK was not handled by any navigator" and leaves the arrow dead.

A card that is deleted under you bounces to the parent board — remembered while the card
still existed, since a deleted card cannot say who its parent was — and the message travels
as a route param, because the screen that has to *say* it is not the screen that discovered
it. The flag is cleared as it is read, so reloading that URL later does not announce the
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
| `status.research` | Find out | Undersök |
| `status.planning` | Plan | Planera |
| `status.execution` | In progress | Pågående |
| `status.review` | Check | Granska |
| `status.done` | Done | Klart |

The deep-board simple set therefore reads *To do · In progress · Done* / *Att göra ·
Pågående · Klart* with no per-board relabel — which is why those three statuses were chosen
for it.

### Reducing overwhelm

The column strip with counts, a board that opens on its first column, a one-field add, and
a card face that carries a title rather than five metadata chips. Done grows without bound
until [#64](https://github.com/Senth/home-backlog/issues/64) archives it and
[#76](https://github.com/Senth/home-backlog/issues/76) sorts it newest-first.

### Four Paper and React Native Web traps this area hit

Kept because each one is the kind of thing the next person reintroduces:

- **A horizontal `ScrollView` in a column parent grows to fill it.** One line of breadcrumbs
  took half the screen. Both strips carry `flexGrow: 0`.
- **`Appbar.Content`'s `subtitle` renders only outside Material 3.** It is not a way to show
  the home's name on a nested board; it is a prop that does nothing.
- **A `Portal` registers with the portal host even when the modal inside it renders
  nothing.** Every card mounting a rename dialog and a confirm dialog cost two portal
  entries and two focus-trap subscriptions per card, on a Done column that grows without
  bound. They mount only while open — which is what Paper's own `Menu` does.
- **Paper's `Chip` `selected` tint alone is not a mark.** On a strip of eight it is a
  slightly different shade of the same green; filled against outlined is legible.

## Out of scope

- **Node detail** — [#49](https://github.com/Senth/home-backlog/issues/49). Notes, due
  date, priority and effort are on the document and on no screen. Rename exists only
  because a card with no way to fix a typo is a permanent mistake.
- **Per-board column configuration and relabels** —
  [#63](https://github.com/Senth/home-backlog/issues/63). The field it edits ships here, so
  #63 is a screen and not a schema change.
- **The subtree visibility flip** and the participants UI — #61. It must write **top-down,
  one document at a time**. Until then a board says nothing about whose card is whose, and
  a private card can only be created by the REST API.
- **Bulk subtree create over REST** — #7, same ordering constraint. `rankSequence` exists
  for it.
- **Locations** — [#50](https://github.com/Senth/home-backlog/issues/50),
  [#51](https://github.com/Senth/home-backlog/issues/51). The two location fields are
  written and inherited, but nothing maintains them when a *location* moves.
- **Archive** #64, **Done newest-first** #76, checklists #52, photos #53, blocked-by #66,
  drag and drop #5 — fields only, or not yet. An archive *cascade* over a subtree carries
  the same top-down constraint as the visibility flip.
- **One-tap done on the card row** — [#75](https://github.com/Senth/home-backlog/issues/75).
  **Filters** — [#62](https://github.com/Senth/home-backlog/issues/62). **Custom statuses**
  — [#69](https://github.com/Senth/home-backlog/issues/69). **Swipe between columns** —
  [#78](https://github.com/Senth/home-backlog/issues/78). **Desktop beyond side-by-side
  columns** — [#31](https://github.com/Senth/home-backlog/issues/31).
- **A full destination picker** for `Move under…` — browsing the whole tree is a second
  navigation surface with its own query-safety story.
- **A Cloud Function for node operations.** Not needed: the invariants keep reparent and
  delete client-side and offline-capable.
  [#39](https://github.com/Senth/home-backlog/issues/39) stays scoped to home deletion and
  member removal.
- **Unassigned filters.** Firestore cannot query for an empty array, so "unassigned" is
  client-side or needs a denormalized flag — #62.
