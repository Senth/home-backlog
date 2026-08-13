# Boards and nodes

Every board, project, task and subtask in the app is the same document: a **node**, in
`homes/{homeId}/nodes`, hanging off the home that [`home-and-members`](home-and-members.md)
describes. A project, a task and a subtask differ only in depth, and any node with children
can be opened as a board.

This spec covers that document — its full field set, the invariants `firestore.rules`
enforces on it, the queries that load a board and a subtree, the indexes those queries
need, and the writes that create, edit, move and delete one.

The screens that render it come later: the projects board and card creation
([#47](https://github.com/Senth/home-backlog/issues/47)), drill-down and breadcrumbs
([#48](https://github.com/Senth/home-backlog/issues/48)), node detail
([#49](https://github.com/Senth/home-backlog/issues/49)). The document lands first,
whole, because everything in [`PROJECT.md`](../PROJECT.md) past auth rests on it and
nothing should need a migration afterwards.

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
| `status` | `Status` | `'backlog'` | `backlog` `next_up` `research` `planning` `execution` `review` `done` `blocked` |
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

*Rejected:* writing only the mandatory fields and defaulting the rest client-side. It
saves ~200 bytes per document and buys the absent-field trap on every optional field.

*Rejected:* writing all fields with no index tuning. Index entries, not document bytes,
are the cost — see [the index](#storage-cost-lives-in-the-index-not-the-document).

### Board column configuration is not here

`columns` is only ever read with the document it sits on and never queried, so adding it
later needs no backfill and no index — the migration argument above does not apply to it.
Where the *root* board's column set lives is an open question for #47, which will have a
screen in front of it; [#63](https://github.com/Senth/home-backlog/issues/63) owns
relabelling.

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
parent's participants — so the rules are the backstop rather than the first line.

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
`useNodes`.

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
keeps the listener count at two regardless of how many statuses a board shows, and both
listeners are torn down whenever the board changes, so drilling down never accumulates a
pair per level.

Costed the way `PROJECT.md` costs things: roughly one extra document read per board load,
billing being per document rather than per query. It buys the free `array-contains` slot on
Q1 for `locationAncestorIds` later.

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

A document is 32 bytes plus its path plus its fields; twenty-one fields with empty defaults
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

Single-field indexing is **disabled** for `title`, `notes`, `checklist`, `photos`,
`effort`, `priority`, `rank`, `archived`, `createdBy` and `updatedAt`. `rank` and `archived`
appear only inside composite indexes, which an exemption does not affect. Left
automatically indexed, because a later feature filters on them alone: `status`, `parentId`,
`visibility`, `locationId`, `dueDate`, `completedAt`, `createdAt`, and the array fields.

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
  status     in the eight-value enum
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

`request.resource.data` is the full post-update document, so `validNode()` costs the same
on an update as on a create and no partial-patch case can slip past. Reading a field that
is absent is an evaluation error, which denies the write — which is why "every field is
written on create" is enforced rather than hoped for. `createdAt` and `updatedAt` are
required for the same reason `immutable()` exists: a document created without them could
never be updated again.

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

## Out of scope

- **Every screen.** Projects board and card creation #47; drill-down and breadcrumbs #48;
  node detail #49. No user-facing string exists yet either: `status.*`, `priority.*` and
  `effort.*` labels belong to the issue that first renders them, because choosing `sv-SE`
  wording for a column header nobody has laid out yet means guessing, and leaves dead keys
  in both locale files meanwhile.
- **The subtree visibility flip** and the participants UI — #61. It must write **top-down,
  one document at a time**.
- **Bulk subtree create over REST** — #7, same ordering constraint. `rankSequence` exists
  for it.
- **Locations** — [#50](https://github.com/Senth/home-backlog/issues/50),
  [#51](https://github.com/Senth/home-backlog/issues/51). The two location fields are
  written and inherited, but nothing maintains them when a *location* moves.
- **Archive** #64, checklists #52, photos #53, blocked-by #66, drag and drop #5 — fields
  only. An archive *cascade* over a subtree carries the same top-down constraint as the
  visibility flip.
- **A Cloud Function for node operations.** Not needed: the invariants keep reparent and
  delete client-side and offline-capable.
  [#39](https://github.com/Senth/home-backlog/issues/39) stays scoped to home deletion and
  member removal.
- **Unassigned filters.** Firestore cannot query for an empty array, so "unassigned" is
  client-side or needs a denormalized flag —
  [#62](https://github.com/Senth/home-backlog/issues/62).
