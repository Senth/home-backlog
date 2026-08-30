# Location tree: create, nest, rename and move locations

## Handoff

- This file is the implementation plan; `/continue-work` works the **Phases** in order,
  reviews, and ships.
- Read `CLAUDE.md`, `docs/DESIGN.md`, `docs/PROJECT.md`, and the section maps named in
  the sections below (`boards-and-nodes.md` for the node fields this feature maintains,
  `rest-api.md` for the verb contract this mirrors) before starting.
- Nothing durable may live only in **Handoff**, **Surface brief**, **Acceptance** or
  **Phases**. `/ship` deletes all four.
- The run stops at a draft PR. The merge is the user's.

## 1. What

The `locations` collection becomes a real second tree: places are created, nested,
renamed, moved and deleted on the Locations tab and over the REST API, and a Cloud
Function keeps every anchored node's `locationId` / `locationAncestorIds` true when a
location moves or is deleted. Anchoring *work* to places is
[#51](https://github.com/Senth/home-backlog/issues/51) and is not here.

## 2. Why

Core scope item 2, first half ([#50](https://github.com/Senth/home-backlog/issues/50)):
a second, independent hierarchy of places, the app's differentiator #2. The two node
fields (`locationId`, `locationAncestorIds`) already exist and are already written and
inherited (`boards-and-nodes.md` § Data), but nothing maintains them when a *location*
moves — the gap `boards-and-nodes.md` § Out of scope has been logging since the node
document shipped.

- **The maintenance is this issue's, not #51's.** Deferred, the denormalization would
  ship as a lie the day #51 lets anyone anchor anything. Doing it here keeps the tree
  and the truth about it in one change. *Client-side* maintenance was the alternative
  and is rejected: a `locationAncestorIds array-contains` query can match a private
  node the mover cannot read, which denies the whole query — so the only rule-respecting
  writer is the Admin SDK, in a trigger. The functions emulator already runs in the dev
  stack (port 8064; `on-api-key-deleted.ts` is the precedent for a non-HTTP trigger).
- **REST verbs are this issue's too.** Kasper's quit condition: something possible in
  the UI must be expressible over REST. Verbs deferred to a later issue would ship a
  screen his agent cannot drive. `locationId` on *nodes* stays refused
  (`400 locations_unavailable`) until #51 gives filing semantics, and `rest-api.md` and
  `SKILL.md` are corrected in the same change, so an agent can build the tree knowing
  filing work in it is still refused.
- **Blank start.** No seeded room templates, per `PROJECT.md` § Locations; starter
  templates are #68's, once there is real usage to learn from.
- **Tab screen, not a drawer.** The issue's "sidebar/drawer" wording predates the tab
  layout; the app has no drawer anywhere and every top-level screen is a bottom tab at
  every width. A desktop drawer is navigation-wide work touching Projects, Maintenance
  and Overview too, and gets its own issue.

## 3. Data & queries

### `homes/{homeId}/locations/{locationId}`

| Field | Type | Notes |
| ----- | ---- | ---- |
| `title` | `string` | 1–200 characters |
| `parentId` | `string \| null` | `null` is a root place |
| `ancestorIds` | `string[]` | root → parent; last element equals `parentId`; never contains the document's own id — the same `structure()` shape nodes validate |
| `rank` | `string` | fractional index (`fractional-indexing`, the node package), ordered among siblings; creation order to begin with, manual reorder is [#182](https://github.com/Senth/home-backlog/issues/182) |
| `createdAt` | `timestamp` | immutable |
| `createdBy` | `string` | immutable |
| `updatedAt` | `timestamp` | |

Every field is required on create. This is a new collection with no legacy documents,
so the present-only escape hatches the node rules need for `assigneeIds` and
`createdVia` are not needed here.

Deliberately absent:

- **No `childCount`.** The tree screen holds every location in one listener and derives
  children client-side; a stored count would be one more counter to keep in step for
  nothing the screen needs.
- **No `visibility` / `participantIds` / `archived`.** A location is household
  furniture: member-only, uniform, the grant `recurring` already has.

### Queries

- **The tree screen: one listener, the whole collection for the home.**
  `query(locationsRef(homeId))`, sorted client-side by `(parentId, rank)`.
  Provably safe: the read rule is `isMember(homeId)` alone, resource-independent, so it
  holds for every document the query can match. Bounded: locations count in tens per
  home — listener breadth, the risk `CLAUDE.md` names, is a function of matching
  documents, and this collection is a small fraction of the ~4k-node scale check. No
  composite index; `firestore.indexes.json` is untouched.
- **Move and delete read the subtree from the server first** — one
  `getDocsFromServer` over the same whole-collection query, filtered client-side by
  `ancestorIds` containing the moved id. Complete, because locations have no visibility
  to hide anything; safe for the same resource-independent reason. From the server,
  never the cache, for the reason `reparentNode` / `deleteNode` give: the offline cache
  holds only the boards that happened to be opened, and "no children in cache" is not
  "no children". Offline, move and delete fail loudly; create and rename queue.
- **Writes**: create is one `set` (no parent counters exist); rename is one `update`;
  move is one batch rewriting the moved document's `parentId` / `ancestorIds` / `rank`
  and every descendant's `ancestorIds` (`movedAncestorIds` already exists in
  `models/node.ts`); delete is one batch removing the subtree, with no counters to
  repair. The cycle refusal (`parent.id === node.id ||
  parent.ancestorIds.includes(node.id)`) throws before any write, exactly as
  `reparentNode` does.

### The node-maintenance function

A Firestore trigger on `homes/{homeId}/locations/{locationId}`:

- **Create** — nothing to maintain.
- **Update where `ancestorIds` changed** — every node whose `locationAncestorIds`
  contains the moved id gets its prefix rewritten: the elements up to and including the
  moved id become `[...moved.newAncestorIds, movedId]`; the elements after it are kept.
  One Admin-SDK query, `where('locationAncestorIds', 'array-contains', movedId)`. Rules
  do not apply to it, which is the point: the same query from a client could match a
  private node and be denied whole.
- **Update where only `title` changed** — no-op. A rename must not pay for a subtree
  read.
- **Delete** — every node whose `locationAncestorIds` contains the deleted id is
  **unfiled**: `locationId: null`, `locationAncestorIds: []`. A node's own location is
  the last element of its path, so one `array-contains` query catches both nodes filed
  *at* the deleted location and nodes filed anywhere under it. Unfiled, not re-homed:
  re-homing silently moves somebody's work, and deleting a root has no parent to
  re-home to. "Unfiled" is the state agent-created work is already documented to be in
  (`rest-api.md`).
- **Convergence.** A cascade delete fires the trigger once per deleted document; each
  firing is idempotent (unfiled is unfiled) and they all end in the same place. A move
  with descendants fires per document; each rewrite replaces the prefix up to its own
  id, and the firings agree.
- The function writes `locationId`, `locationAncestorIds` and `updatedAt`, and nothing
  else; `createdBy` / `createdVia` are untouched, so the app-written mark stays true.
- `locationAncestorIds` ends with the node's own `locationId` — the property that lets
  the board's shared query (Q1) roll a location up through one `array-contains`
  (`boards-and-nodes.md` § Queries). The rewrites above preserve it.
- Offline: a queued location move lands late, the trigger fires then, and the nodes
  catch up when it does. Consistent, not immediate.

### REST API

The node verbs, mirrored one endpoint set over:
`GET` / `POST /api/v1/homes/:homeId/locations`, `PATCH` / `DELETE
/api/v1/homes/:homeId/locations/:locationId`.

- **POST** create: `{ title, parentId?, rank? }` — `rank` defaults to end the way node
  creation does; `ancestorIds` is derived server-side from `parentId`, never trusted
  from the body (the same reason bulk create resolves caller-chosen refs itself).
- **PATCH** owns rename *and* move — `rest-api.md`'s "PATCH owns moves and reparents".
  `{ title?, parentId? }`. Moving a location under its own descendant is a named
  `400 cycle`, the client-side refusal restated where the server can say it.
- **DELETE** cascades, but has to be asked: `409 has_children` naming the location and
  the descendant counts, then `?cascade=true` deletes the subtree. The cascade is an
  Admin-SDK delete, so the trigger unfilms anchored nodes on that path too — one
  contract for both writers.
- Validation is mirrored from the rules in `functions/src/validate.ts`, the pattern
  `rest-api.md` § Validation already establishes. `body.ts` keeps refusing
  `locationId` / `locationAncestorIds` **on nodes** with `400 locations_unavailable` —
  lifting that is #51's.
- The same change corrects `rest-api.md`'s "The `locations` collection has no verbs"
  copy and `SKILL.md`'s "unfiled until the location verbs ship": places can now be
  created, listed and managed, and filing work in them is still refused. Both documents
  must say so, or an agent that builds the tree then files work will read the refusal
  as breakage.

## 4. Rules & tests

Replace the bare `match /locations/{locationId} { allow read, write: if isMember(homeId);
}`:

- `get`, `list`: `isMember(homeId)`.
- `create`: `isMember(homeId) && validLocation(request.resource.data)`.
- `update`: `isMember(homeId) && validLocation(request.resource.data) &&
  immutable(request.resource.data, resource.data)` over `createdAt` / `createdBy`.
- `delete`: `isMember(homeId)`.
- `validLocation(data)`: title string 1–200; `parentId` null or string; `ancestorIds` a
  list passing the same `structure()` check nodes use (root ⇒ empty, else last element
  equals `parentId`, and the document's own id is not in it); `rank` a non-empty
  string; `createdAt` / `createdBy` / `updatedAt` present. **No `get()` anywhere** —
  locations carry no inheritance invariant beyond structure, so a batched subtree move
  never approaches the twenty-document-access budget the node reparent's parent `get()`
  spends.

`tests/rules/` — extend the existing `homes/{homeId}/locations and /recurring` block
(the member-only cases stay) with: a valid create passes; a create missing any field is
denied; an over-long or empty title is denied; `ancestorIds` containing the document's
own id is denied; a root with a non-empty `ancestorIds` is denied; `ancestorIds` whose
last element is not `parentId` is denied; a rename passes; a reparent passes; changing
`createdAt` or `createdBy` is denied; a member's delete passes and a non-member's is
denied.

Functions tests for the trigger: a move rewrites the prefix of an anchored node's path
and keeps the tail; a node filed directly at the moved location is rewritten; a rename
writes nothing; a delete unfilms; a cascade's per-document firings converge.

## 5. Surface brief

- Job:      Ingrid puts "Ute › Trädgård › Äppelträden" into the app, before any work
            exists to file there
- Primary:  add a location. Exactly one primary action
- Read:     1st the tree of place names · 2nd where the next place goes (Add under) ·
            3rd the destructive ask, named in full
- Not like: a settings list, a form, a file manager with ids and counts
- Remove / quiet / sharpen:  quiet the chevron-and-indent chrome ·
            sharpen the row's add-under affordance ·
            remove every descendant count — the delete says "everything under it",
            never a number

## 6. UI flow

The Locations tab (`app/(app)/(tabs)/locations.tsx`) stops being a `PlaceholderScreen`:

- A tree of rows, one `List.Item` per location, indented by depth. A chevron toggles
  children; expansion is client-side session state, default expanded, not persisted
  (revisit with #182). Tokens from `theme/tokens.ts`; `react-native-paper` components;
  no colour literals outside `theme/`, no numeric literals in style props.
- The **FAB** ("Add location", width-capped per the boards FAB rule) creates a root
  place. A row's overflow `Menu` carries: **Add under…**, **Rename**, **Move under…**,
  **Delete**. Delete lives only in this menu — never a swipe, never a long-press
  (Ingrid at 200% text with one thumb).
- **Add** and **Rename** open a dialog (`AppDialog` + `TextInput`, the
  `TitleDialog` pattern); the name is required and trimmed.
- **Move under…** opens a destination picker mirroring `CardMenu`'s: **Top level** plus
  every location, with the moved location's own subtree rendered **disabled** — the
  refusal is visible before it is committed, and the write-time throw stays as backstop.
- **Delete** opens a destructive `ConfirmDialog`: title "Delete {{name}}?", body naming
  the location and saying "and everything under it". No counts. The cascade is
  unconditional once confirmed.
- **Offline**: create and rename queue optimistically — the `acknowledged`-promise
  pattern `createNode` uses, nothing user-facing awaiting it. Move under… and Delete
  are disabled with the offline hint the card menu already shows.
- **Empty state**: replaces "No locations yet." with one line saying what places are
  for and one create button — the homes screen's empty-state-onboarding pattern. The
  e2e ready key `screen.locations.empty` in `e2e/support/app.ts` moves with it.
- **Large text**: the indent step caps with depth so a four-level row at 200% still
  shows its whole name; the name wraps rather than ellipsizes; chevron and menu keep
  fixed width. Stated here because it is a rule, not a polish pass.

## 7. Strings

New `t()` keys, `en-US.json` and `sv-SE.json` in the same change. The noun is
"Locations" / "Platser"; never "sublocation", "hierarchy" or "node" in a user string.

| Key | en-US | sv-SE |
| --- | ----- | ----- |
| `locations.add` | Add location | Lägg till plats |
| `locations.addUnder` | Add under… | Lägg till under… |
| `locations.moveUnder` | Move under… | Flytta under… |
| `locations.moveUnderTop` | Top level | Högsta nivå |
| `locations.rename` | Rename | Byt namn |
| `locations.renameTitle` | Rename location | Byt namn på plats |
| `locations.nameLabel` | Name | Namn |
| `locations.delete` | Delete | Ta bort |
| `locations.deleteTitle` | Delete {{name}}? | Ta bort {{name}}? |
| `locations.deleteBody` | {{name}}, and everything under it, will be deleted. This cannot be undone. | {{name}} och allt under den tas bort. Det går inte att ångra. |
| `locations.emptyTitle` | Add the places around your home | Lägg till platserna runt ditt hem |
| `locations.emptyBody` | The garden, the basement, the cabin — build the tree now, file work in it later. | Trädgården, källaren, stugan — bygg trädet nu, lägg in arbetet i det senare. |

Offline hints reuse the existing board keys where the wording fits; new keys only where
"location" has to be said. The existing `tab.locations` ("Locations" / "Platser") and
the `screen.locations` namespace stay.

## 8. Acceptance

1. [test] Add location at the top level creates a root place, Add under… from a row
   nests a place under that row, and both are in the tree after a reload.
2. [test] Move under… re-homes a place and its whole subtree: after a reload the moved
   place and its descendants hang from the new parent.
3. [test] The destination picker offers Top level and renders the moved place's own
   subtree as disabled; choosing a place inside it writes nothing.
4. [test] Deleting a place that has children asks first, naming the place; cancelling
   writes nothing; confirming removes the place and every place under it and nothing
   else, and the tree is still correct after a reload.
5. [test] A rename shows on the row immediately and survives a reload.
6. [test] With the network cut, Add location still adds the place (queued), Move
   under… and Delete are disabled with an offline hint, and both work again once the
   connection returns.
7. [test] A location move rewrites the paths of anchored nodes: with a node planted at
   a descendant of the moved place (planted through the emulator's superuser path), the
   node's `locationAncestorIds` carries the new path after the move, and a cascade
   delete leaves that node unfiled with `locationId` null.
8. [test] Over REST: POST creates a location, PATCH renames and re-parents, DELETE
   without cascade returns `409 has_children` and with `?cascade=true` deletes the
   subtree, and a node write carrying `locationId` still returns
   `400 locations_unavailable`.
9. [eye]  The tree reads as places, not records: no ids, no counts, no jargon anywhere
   on the screen.
10. [eye] At 200% text in Swedish, a four-level row shows its whole name; the structure
   yields before the name does.

## 9. What this does NOT change

- The `nodes` schema: both location fields exist, and their write paths
  (`newNodeData`'s inheritance, `reparentNode` leaving `locationId` untouched) are
  untouched.
- Overview: Q3 and Q5 keep their `array-contains` slot free; no overview query changes
  — the place filter is #51's.
- The `recurring` rules block: the same member-only grant as before, untouched.
- Board UI, cards, drag: nothing on the projects side moves.

## 10. Out of scope

- **Anchoring nodes to places, and roll-up views** —
  [#51](https://github.com/Senth/home-backlog/issues/51). It lifts
  `locations_unavailable` on node writes, designs Overview's place filter, and grows
  the delete dialog's wording to say what happens to filed work.
- **Sibling reorder** — [#182](https://github.com/Senth/home-backlog/issues/182). Rank
  is fractional from day one, so it is a pure UI change later.
- **Bulk location create over REST** —
  [#181](https://github.com/Senth/home-backlog/issues/181).
- **Starter location templates** —
  [#68](https://github.com/Senth/home-backlog/issues/68). Blank start, per
  `PROJECT.md`.
- **A drawer/sidebar on wide screens** — navigation-wide work with its own issue to be
  filed when taken up; the tree ships on the Locations tab.
- **Persisting expansion state** — revisit with #182.

## 11. Phases

Phase 1  `models/locations.ts` (shape, validation, move helpers) + the
         `firestore.rules` locations block + `tests/rules/` cases
Phase 2  the node-maintenance trigger in `functions/` + its tests (move rewrite,
         delete unfile, rename no-op, cascade convergence)
Phase 3  REST location verbs + mirrored validation + `SKILL.md` and `rest-api.md` copy
Phase 4  `data/locations.ts` queries and writes + the tree hook, with jest coverage
Phase 5  the Locations tab tree UI + dialogs + strings (en-US + sv-SE) + the e2e
         ready-key update
Phase 6  e2e specs for the [test] acceptance claims

Every phase ends green on `yarn lint --write`, `yarn invariants`, `yarn typecheck` and
`yarn test`.
