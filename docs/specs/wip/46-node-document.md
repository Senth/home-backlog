# The `Node` document

> **Temporary.** This file belongs to issue
> [#46](https://github.com/Senth/home-backlog/issues/46) and is deleted by the cleanup
> phase, which folds its durable content into `docs/specs/boards-and-nodes.md`.

## Handoff

This file is the implementation plan. Work the **Phases** section in order.

Read [`CLAUDE.md`](../../../CLAUDE.md), [`docs/PROJECT.md`](../../PROJECT.md) and
[`docs/specs/home-and-members.md`](../home-and-members.md) first — the last one is the
container this collection hangs off, and its Queries section is the model every query
here follows.

Nothing durable may live only in **Handoff** or **Phases**; the cleanup phase deletes
both.

Branch `feat/46-node-document`. One commit per phase, once that phase is green on
`yarn lint --write`, `yarn typecheck` and `yarn test`.

**After the cleanup phase** — and only then:

```bash
GIT_VANILLA=1 gh pr create --fill --body "Closes #46"
GIT_VANILLA=1 gh pr checks --watch
GIT_VANILLA=1 gh pr merge --squash --delete-branch
```

Any check failing means stop, report, and **do not merge**.

Committing, opening the PR and merging are an explicit, user-authorized exception to the
global "never commit without being asked" rule, scoped to this flow and this branch.
Nothing else is committed or pushed without asking, and nothing is ever pushed straight
to `main` — that deploys to production.

## 1. What

`homes/{homeId}/nodes` — the one document type every board, task and subtask is made of —
lands with its full field set, the security rules that keep it valid, the composite
indexes its reads need, and the query-safe board load. No screen ships.

## 2. Why

Everything in [`PROJECT.md`](../../PROJECT.md) past auth rests on this document, so the
shape lands before anything renders it and nothing needs a migration afterwards.

### A field that is absent can never be queried

Firestore does not index absent fields, so `where('archived', '==', false)` silently skips
every document written before `archived` existed. Adding a *queried* field later is a
backfill, not a schema change. That is why `archived` and `completedAt` land now even
though [#64](https://github.com/Senth/home-backlog/issues/64) and
[#54](https://github.com/Senth/home-backlog/issues/54) own their features, and why
`completedAt` in particular cannot wait — a completion date is not reconstructible after
the fact, and deriving it from `updatedAt` is wrong the moment anyone edits a finished
node.

*Rejected:* writing only the mandatory fields and defaulting the rest client-side. It
saves ~200 bytes per document and buys the absent-field trap on every optional field.

*Rejected:* writing all fields with no index tuning. Index entries, not document bytes,
are the cost — see [Storage](#storage-cost-lives-in-the-index-not-the-document).

### Privacy is uniform across a subtree

**A node's `visibility` equals its parent's. Only a root node — `parentId == null` —
sets it.** A private node's `participantIds` must also contain all of its parent's.

This is not a rule about privacy so much as a rule that makes privacy *queryable*.
Firestore has **no field-level read rules**: a document is readable or it is not, so
there is no way to expose a node's id and hide its title. And a query may contain only
**one** `array-contains` clause, so `ancestorIds array-contains X && participantIds
array-contains me` is not expressible. Without the invariant, no client query can see
another member's private descendant — which means a reparent leaves it with stale
`ancestorIds`, and a delete orphans it permanently, with no error anywhere and no way to
find it afterwards.

With the invariant, both subtree reads are provably safe *and* complete:

| Subtree of | Query | Complete because |
| --- | --- | --- |
| a **shared** node X | `ancestorIds ⊕ X && visibility == 'shared'` | a shared node's descendants are all shared, transitively |
| a **private** node X | `participantIds ⊕ me`, `ancestorIds` filtered client-side | I am a participant of every descendant of a private node I can read |

The cost is a product restriction: **a private card cannot live inside a shared
project.** It sits at the root, or under another private card.

That restriction is worth having on its own merits. A hidden child makes its parent lie —
one member sees eight subtasks and another sees seven, so every count derived from
children diverges per viewer: progress, location roll-ups, and the "all 8 subtasks are
done — move this to Review?" nudge
([#65](https://github.com/Senth/home-backlog/issues/65)). A private *project* is cleanly
absent for everyone not in it. "Celebration" as its own private project is the honest
shape of what a private card was reaching for.

*Rejected:* a skeleton document per node — structure in a readable `nodes/{id}`, content
in a restricted child. It doubles every write and leaks that a hidden card exists, where
it sits and when it is due. A phantom card on the board is worse privacy than none.

*Rejected:* a Cloud Function with the admin SDK for reparent and delete. It closes the
hole without the restriction, but a callable **cannot run offline**, and `PROJECT.md`'s
own principle is that work happens in basements, sheds and gardens. Deleting a card
without signal is ordinary.

### Rules cannot see the rest of a batch, so the invariants are split

A `get()` inside a security rule reads **committed** state. It does not see other writes
in the same `writeBatch` or transaction. So a rule that validates a child against its
parent's *new* value fails for every write that changes both at once.

The two invariants are therefore enforced differently, chosen by whether the rule needs
to see the parent change:

- **Visibility and participants** — enforced with a `get()` on the parent. During a
  reparent the parent's visibility does not change and the new parent is not in the
  batch, so the `get()` reads correct state **inside a batch**.
- **`ancestorIds`** — validated structurally, with no `get()`: the last element must equal
  `parentId`, and a node may not be its own ancestor. A descendant's `parentId` does not
  change during a reparent, so its rewritten `ancestorIds` passes **inside a batch** too.

Reparent and delete stay atomic. The unrecoverable invariant stays enforced.

What this gives up is full-path verification — a wrong *grandparent* id passes the rules.
That is the recoverable class of error: `parentId` is the source of truth and
`ancestorIds` is derived from it, so a corrupt path is always recomputable, and the
function that builds it is unit-tested.

*Rejected:* sequential top-down writes with a full `get()`-checked ancestor path. Maximum
enforcement, but it trades atomicity on every subtree operation and imposes an ordering
discipline everywhere from day one.

*Rejected:* structural rules only, with no `get()` at all. Simplest rules, and it leaves
uniform visibility enforced by the client alone — so a bug, or the REST API
([#7](https://github.com/Senth/home-backlog/issues/7)), reintroduces the silent orphan.

Operations that **do** change visibility, or create a parent and a child together, still
cannot be batched: the subtree visibility flip
([#61](https://github.com/Senth/home-backlog/issues/61)) and bulk subtree create (#7)
must write **top-down, one document at a time**. They fail loudly — a permission error —
if they forget, which is the right way for that constraint to be discovered.

### `rank` is a fractional index from day one

Drag and drop ([#5](https://github.com/Senth/home-backlog/issues/5)) is deliberately
post-MVP, so `rank` exists now purely to make it a UI change with no data migration.

A rank is ordered **within its `(parentId, status)` column** — that is what a board
reorder manipulates. Moving a card to another column recomputes its rank from that
column's neighbours in the same write as the status change.

*Rejected:* rank global per parent. A card keeps its value across a column change, but
dropping it at the top of another column still has no valid rank to take, so the rewrite
happens anyway and the invariant is weaker for nothing.

*Rejected:* float ranks with renormalization. Around fifty repeated midpoint inserts at
one spot exhaust double precision, and the renormalization pass rewrites a whole column —
a batch write that fails offline, which is exactly where drag and drop gets used.

*Rejected:* hand-rolling the base-62 midpoint. It is the same algorithm
`fractional-indexing` implements, and the fiddly parts — the integer-length prefix, the
no-trailing-zero normalization, the unbounded ends — are where a hand-rolled version
breaks. `generateNKeysBetween` is also exactly what #7's bulk create needs.

Two people offline can still produce the same rank between the same neighbours. The
client sort is therefore **`(rank, id)`**, always, so a tie renders identically on every
device and the next drag breaks it permanently. No extra field, no write, and it covers
ties arriving from the REST API or a seeded fixture too.

### `dueDate` is a calendar day, not an instant

`'YYYY-MM-DD'`. "Clean the gutters by Sep 30" is the same day in every timezone, and
lexicographic order is chronological, so `orderBy` and range queries work unchanged. A
`Timestamp` would need a pinned timezone on every read and write or drift a day, and the
season *windows* in `PROJECT.md` (Sep 1 – Nov 30) would become instants.

### Storage cost lives in the index, not the document

A document is 32 bytes plus its path plus its fields; twenty-one fields with empty
defaults come to roughly 200 bytes. An **index entry** is 32 bytes plus the full document
path — about 110 bytes here — plus the value, and every automatically indexed scalar has
two of them. One null scalar is therefore ~290 bytes of index, more than ten times what
it costs in the document.

So a field gets a single-field index only if some query filters or orders by it *alone*.
Everything else is exempted in `firestore.indexes.json`. Empty arrays already generate no
index entries, so the array fields cost nothing until they hold something.

## 3. Data & queries

### `homes/{homeId}/nodes/{nodeId}`

Every field is written on create, with the default below.

| Field | Type | Default | Notes |
| ----- | ---- | ------- | ----- |
| `title` | `string` | — | 1–200 characters |
| `status` | `Status` | `'backlog'` | `backlog` `next_up` `research` `planning` `execution` `review` `done` `blocked` |
| `rank` | `string` | `rankAtEnd(last)` | fractional index, ordered within `(parentId, status)` |
| `parentId` | `string \| null` | `null` | `null` is a root node |
| `ancestorIds` | `string[]` | `[]` | root → parent; last element equals `parentId` |
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
| `completedAt` | `Timestamp \| null` | `null` | set iff `status == 'done'` |
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

Depth is **derived** (`ancestorIds.length`), never stored, per `PROJECT.md`.

### Queries

**A board** — the children of one node, or of the root. Two listeners, merged.

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

Provably safe. The node read rule is `isMember(homeId) && visibleToMe(resource.data)`;
`isMember` is resource-independent, so it holds for every document in the collection. Q1
constrains `visibility == 'shared'`, which is the rule's first disjunct. Q2 constrains
`participantIds array-contains uid`, which is its second. No matching document can be
denied.

The two results are **merged, deduped by id, then sorted `(rank, id)`** and grouped into
columns by `status` client-side. Deduping is required, not defensive: a *shared* node I
participate in matches **both** queries. One query per board rather than one per column
keeps listener count at two regardless of how many statuses a board shows.

Costing this the way `PROJECT.md` does: roughly one extra document read per board load,
billing being per document rather than per query. It buys the free `array-contains` slot
on Q1 for `locationAncestorIds` later.

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
      where("participantIds", "array-contains", uid))
// then filter ancestorIds.includes(nodeId) client-side
```

The second `array-contains` is not expressible, so the ancestor test is client-side. Safe
by the rule's second disjunct, complete by participant inheritance, and bounded by how
many private nodes one person is in — small by construction. Served by the automatic array
index; no composite.

### `firestore.indexes.json`

Composite:

| Collection | Fields | For |
| --- | --- | --- |
| `nodes` | `archived` ASC, `parentId` ASC, `visibility` ASC, `rank` ASC | board Q1 |
| `nodes` | `archived` ASC, `parentId` ASC, `participantIds` ARRAY_CONTAINS, `rank` ASC | board Q2 |
| `nodes` | `visibility` ASC, `ancestorIds` ARRAY_CONTAINS | shared subtree |

Single-field indexing **disabled** (`fieldOverrides` with an empty `indexes` array) for
fields no query filters or orders by on their own: `title`, `notes`, `checklist`,
`photos`, `effort`, `priority`, `rank`, `archived`, `createdBy`, `updatedAt`. `rank` and
`archived` appear only inside composite indexes, which are unaffected by an exemption.
Roughly 2.9 KB of index entries saved per node.

Left automatically indexed, because a later feature filters on them alone: `status`,
`parentId`, `visibility`, `locationId`, `dueDate`, `completedAt`, `createdAt`, and the
array fields.

The emulator indexes everything on the fly and can never surface a missing index — the
same trap the `emailHash` field override documents in
[`home-and-members`](../home-and-members.md). Every query above is listed here for that
reason.

## 4. Rules & tests

`firestore.rules`, inside `match /homes/{homeId}/nodes/{nodeId}`. The existing
`visibleToMe()` and its read/create/update/delete grants stay; validation is added
alongside them. These invariants live in rules rather than in a component so the REST API
(#7) and any agent driving it inherit every one.

```
validNode(data)
  title      is string, size 1..200
  status     in the eight-value enum
  rank       is string, size > 0
  parentId   == null or is string
  ancestorIds, locationAncestorIds, participantIds, blockedBy  are lists
  visibility in ['shared', 'private']
  dueDate    == null or matches '^\\d{4}-\\d{2}-\\d{2}$'
  priority   == null or in ['low','normal','high','urgent']
  effort     == null or in ['quick','hours','evening','weekend','multi_week']
  notes      is string, size <= 10000
  checklist  size <= 200        photos size <= 50
  archived   is bool
  (status == 'done') == (completedAt != null)

structure(data, nodeId)
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
```

`request.resource.data` is the full post-update document, so `validNode()` costs the same
on update as on create and no partial-patch case can slip past.

### `tests/rules/`

The existing `homes/{homeId}/nodes` block stays. Added:

- a required field missing is refused; a title of 0 and of 201 characters is refused
- a `status`, `priority` or `effort` outside its enum is refused
- a `dueDate` of `'2026-9-1'`, `'01/09/2026'` or `'not a date'` is refused
- `notes` over 10 000, `checklist` over 200, `photos` over 50 are each refused
- `createdAt` and `createdBy` cannot be changed after create
- `status: 'done'` without `completedAt` is refused, and `completedAt` on a node that is
  not done is refused
- a root node with a non-empty `ancestorIds` is refused
- a child whose `ancestorIds` does not end in its `parentId` is refused
- a node listing its own id in `ancestorIds` is refused
- **a private child under a shared parent is refused**
- **a shared child under a private parent is refused**
- **a private child missing one of its parent's `participantIds` is refused**, and one
  that adds a participant beyond the parent's is allowed
- a `writeBatch` reparent — the moved node plus two descendants in one commit — succeeds,
  which is what proves the split in §2 holds
- board Q1 and Q2 both succeed for a member; an unconstrained `list` of `nodes` is
  **refused**, which is what makes the two-query shape necessary rather than stylistic
- the shared-subtree query succeeds; the same query without its `visibility` clause is
  refused

## 5. UI flow

**No screen ships.** `app/(app)/(tabs)/projects.tsx` is untouched; the first board is
[#47](https://github.com/Senth/home-backlog/issues/47). Proof that the queries run is the
rules suite and the unit tests, and review is `/review --code` — there is no user-visible
surface for a browser pass to walk.

*Rejected:* a throwaway debug list on the Projects tab. It would need `t()` keys and a
browser pass now, and #47 would delete all of it.

What ships behind the absent UI:

- `models/node.ts` — types, defaults, `rankAtEnd` / `rankBetween` / `rankSequence`
  wrapping `fractional-indexing`, `compareNodes`, `childAncestorIds`, `mergeNodeResults`,
  and `toNode()` coercion in the shape `data/homes.ts` already uses
- `data/nodes.ts` — the queries above, plus `createNode`, `updateNode`, `moveNode`,
  `reparentNode` and `deleteNode`
- `hooks/use-nodes.ts` — a thin wrapper subscribing both board listeners and handing
  their results to `mergeNodeResults`. The merge logic lives in the model so it is
  testable without Firestore; the hook itself holds no logic worth a test

`reparentNode` rewrites `ancestorIds` and nothing else — a node moving in the project tree
never moves in the location tree, per `PROJECT.md`. `createNode` inherits the parent's
`locationId` and `locationAncestorIds`, and its `visibility`.

### Offline

`createNode`, `updateNode` and `moveNode` queue optimistically. That is Firestore's
default and it is what a board in a shed needs.

`reparentNode` and `deleteNode` **require a connection**, and the screens that eventually
call them disable the action with a hint — the pattern
[`home-and-members`](../home-and-members.md) already applies to creating a home and
sending an invitation. Both read the subtree first, and offline that reads the *cache*,
which holds only boards actually opened. An offline subtree delete would silently miss
descendants and orphan them, which is precisely the failure the visibility invariant
exists to prevent.

*Rejected:* allowing an offline delete when the cache shows no children. "No children in
cache" is not "no children" — a cold cache after a reload, or a node reached by URL,
brings the orphan straight back.

## 6. Strings

**None.** No screen ships, so no user-facing string exists. `status.*`, `priority.*` and
`effort.*` labels belong to the issue that first renders them (#47, #49): choosing `sv-SE`
wording for a column header nobody has laid out yet means guessing, and leaves dead keys
in both locale files meanwhile.

## 7. What this does NOT change

- `firestore.rules` for `homes`, `invites`, `locations` and `recurring`
- `app/`, `components/`, `hooks/use-*` other than the new `use-nodes`, `theme/`, `i18n/`
- the home model, `HomeProvider`, or how the active home is resolved
- `storage.rules` — `photos[].path` is typed, but nothing uploads yet (#53)
- `.emulator-seed/` — the fixture is generated by the app, never hand-written, and there
  is no app surface yet to generate nodes through. #47 refreshes it in its cleanup phase

## 8. Out of scope

- **Every screen.** Projects board and card creation
  [#47](https://github.com/Senth/home-backlog/issues/47); drill-down and breadcrumbs
  [#48](https://github.com/Senth/home-backlog/issues/48); node detail
  [#49](https://github.com/Senth/home-backlog/issues/49)
- **Board column configuration.** `columns` is only ever read with the document it sits
  on, never queried, so adding it later needs no backfill and no index — the migration
  argument that justifies `archived` and `completedAt` does not apply. Where the *root*
  board's column set lives is an open question for #47, which will have a screen in front
  of it. [#63](https://github.com/Senth/home-backlog/issues/63) owns relabelling
- **The subtree visibility flip** and the participants UI —
  [#61](https://github.com/Senth/home-backlog/issues/61). It must write **top-down, one
  document at a time**, for the reason in §2
- **Bulk subtree create over REST** — [#7](https://github.com/Senth/home-backlog/issues/7),
  same ordering constraint. `rankSequence` exists for it
- **Locations** — [#50](https://github.com/Senth/home-backlog/issues/50),
  [#51](https://github.com/Senth/home-backlog/issues/51). The two location fields are
  written and inherited, but nothing maintains them when a *location* moves
- **Archive** [#64](https://github.com/Senth/home-backlog/issues/64), checklists
  [#52](https://github.com/Senth/home-backlog/issues/52), photos
  [#53](https://github.com/Senth/home-backlog/issues/53), blocked-by
  [#66](https://github.com/Senth/home-backlog/issues/66), drag and drop
  [#5](https://github.com/Senth/home-backlog/issues/5) — fields only. An archive *cascade*
  over a subtree carries the same top-down constraint as the visibility flip
- **A Cloud Function for node operations.** Not needed: the invariants keep reparent and
  delete client-side and offline-capable. [#39](https://github.com/Senth/home-backlog/issues/39)
  stays scoped to home deletion and member removal
- **Unassigned filters.** Firestore cannot query for an empty array, so "unassigned" is
  client-side or needs a denormalized flag — [#62](https://github.com/Senth/home-backlog/issues/62)

## 9. Phases

Each ends green on `yarn lint --write`, `yarn typecheck` and `yarn test`, and is one
commit.

**Phase 1 — the model.** `yarn add fractional-indexing` (v4 is ESM-only and ships
`src/index.d.ts`; add it to `transformIgnorePatterns` in `package.json` if jest complains).
`models/node.ts` with the types, defaults, rank wrappers, `compareNodes`,
`childAncestorIds`, `mergeNodeResults` and `toNode()`. `models/node.test.ts` covering the
rank ordering invariant (`a < rankBetween(a, b) < b`), the `(rank, id)` tiebreak, the
dedupe of a node present in both query results, ancestor derivation for a root and a
child, and `toNode()` against a document missing every optional field.

**Phase 2 — rules.** `validNode()`, `structure()`, `inherits()` and `immutable()` in
`firestore.rules`, plus every case in §4 in `tests/rules/firestore.test.ts`. Run with
`yarn test:rules`.

**Phase 3 — indexes and the data layer.** The three composite indexes and the
`fieldOverrides` exemptions in `firestore.indexes.json`; `data/nodes.ts` with the queries
and the five write functions, each carrying the comment explaining why its query is
provably safe, in the style of `data/homes.ts`.

**Phase 4 — the hook.** `hooks/use-nodes.ts`, subscribing both board listeners and
unsubscribing on parent change so drilling down never accumulates listeners.

**Phase 5 — review.** `/review --code` until PASS. `blocking` findings are never
deferrable; a `should-fix` may be deferred only with a stated reason. `idea` findings go
to the user, who decides which become issues. The session that wrote the code does not
sign it off.

**Phase 6 — cleanup, then PR.**

- Write **`docs/specs/boards-and-nodes.md`** — a genuinely new area with its own data
  model and, shortly, its own screens. It folds in everything durable from this file:
  the field table, the query shapes and their safety proofs, the indexing rationale, the
  rules invariants, and every *Rejected* in §2. Present tense, as a description of the
  app.
- Cross-link it from [`home-and-members.md`](../home-and-members.md) where that spec
  names nodes, and add the row to [`INDEX.md`](../INDEX.md), removing
  `boards-and-nodes` from its **Planned areas** list.
- Delete `docs/specs/wip/46-node-document.md`. Git history keeps it.
- `.emulator-seed/` is **not** refreshed — see §7.
- Then the PR commands in **Handoff**.
