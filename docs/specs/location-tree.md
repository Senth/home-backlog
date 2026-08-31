# Location tree

The second hierarchy. [Nodes](boards-and-nodes.md) answer *what* — the project tree of
boards, projects and tasks (`parentId` / `ancestorIds`). Locations answer *where* — the
places around the home (`locationId` / `locationAncestorIds`). A node moving in one
tree never moves in the other. Locations are the differentiator the overview's future
place filter ([#51](https://github.com/Senth/home-backlog/issues/51)) will roll up
through, and until that lands, anchoring work to a place is refused everywhere: the
REST body still answers `400 locations_unavailable`, and nothing in the UI offers it.

## Why the maintenance lives in a trigger

Both node fields exist and are already written and inherited
([boards-and-nodes § Data](boards-and-nodes.md#data)) — the gap this feature closed is
that nothing kept them true when a *location* moved. Deferred, the denormalization
would have shipped as a lie the day #51 let anyone anchor anything, so the tree and the
truth about it landed in one change.

*Client-side* maintenance was the alternative and is rejected: a
`locationAncestorIds array-contains` query from a client can match a private node the
mover cannot read, and one deniable document denies the whole query. The only
rule-respecting writer is the Admin SDK, so the maintenance is a Firestore trigger,
which rules do not apply to. The functions emulator already runs in the dev stack;
`on-api-key-deleted.ts` is the precedent for a non-HTTP trigger.

The REST verbs are part of the feature for the same reason the trigger is: something
possible in the UI must be expressible over REST, or an agent can build the tree but
not maintain it.

## Data

### `homes/{homeId}/locations/{locationId}`

| Field | Type | Notes |
| ----- | ---- | ----- |
| `title` | `string` | 1–200 characters |
| `parentId` | `string \| null` | `null` is a root place |
| `ancestorIds` | `string[]` | root → parent; last element equals `parentId`; never contains the document's own id — the same `structure()` shape nodes validate |
| `rank` | `string` | fractional index (`fractional-indexing`), ordered among siblings; creation order to begin with, manual reorder is [#182](https://github.com/Senth/home-backlog/issues/182) |
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
  `locationsRef(homeId)`, sorted client-side by `(parentId, rank)`. Provably safe: the
  read rule is `isMember(homeId)` alone, resource-independent, so it holds for every
  document the query can match. Bounded: locations count in tens per home — listener
  breadth, the risk [CLAUDE.md](../../CLAUDE.md) names, is a function of matching
  documents, and this collection is a small fraction of the ~4k-node scale check. No
  composite index; `firestore.indexes.json` is untouched.
- **Move and delete read the subtree from the server first** — one
  `getDocsFromServer` over the same whole-collection query, filtered client-side by
  `ancestorIds` containing the moved id. Complete, because locations have no visibility
  to hide anything; safe for the same resource-independent reason. From the server,
  never the cache, for the reason `reparentNode` / `deleteNode` give: the offline cache
  holds only the boards that happened to be opened, and "no children in cache" is not
  "no children".

### Writes

- **Create** is one `set` (no parent counters exist); **rename** is one `update`.
- **Move** is one batch rewriting the moved document's `parentId` / `ancestorIds` /
  `rank` and every descendant's `ancestorIds` (`movedAncestorIds` already exists in
  `models/node.ts`). **Delete** is one batch removing the subtree, with no counters to
  repair.
- The cycle refusal (`parent.id === node.id || parent.ancestorIds.includes(node.id)`)
  throws before any read or write, on the client, in the REST handler and in the
  picker, which renders the moved place's own subtree disabled — the refusal is visible
  before it is committed, and the write-time throw stays as backstop.
- **Offline**: create and rename queue optimistically — the `acknowledged`-promise
  pattern `createNode` uses, nothing user-facing awaiting it. Move and delete fail
  loudly; offline they are disabled with the offline hint the card menu shows.

## The node-maintenance function

A Firestore trigger on `homes/{homeId}/locations/{locationId}`
(`functions/src/on-location-written.ts`):

- **Create** — nothing to maintain.
- **Update where `ancestorIds` changed** — every node whose `locationAncestorIds`
  contains the moved id gets its prefix rewritten: the elements up to and including the
  moved id become `[...moved.newAncestorIds, movedId]`; the elements after it are kept.
  One Admin-SDK query, `where('locationAncestorIds', 'array-contains', movedId)`.
- **Update where only `title` changed** — no-op. A rename must not pay for a subtree
  read.
- **Delete** — every node whose `locationAncestorIds` contains the deleted id is
  **unfiled**: `locationId: null`, `locationAncestorIds: []`. A node's own location is
  the last element of its path, so one `array-contains` query catches both nodes filed
  *at* the deleted location and nodes filed anywhere under it. Unfiled, not re-homed:
  re-homing silently moves somebody's work, and deleting a root has no parent to
  re-home to. "Unfiled" is the state agent-created work is documented to be in
  ([rest-api](rest-api.md)).
- **Convergence.** A cascade delete fires the trigger once per deleted document; each
  firing is idempotent (unfiled is unfiled) and they all end in the same place. A move
  with descendants fires per document; each rewrite replaces the prefix up to its own
  id, and the firings agree.
- The function writes `locationId`, `locationAncestorIds` and `updatedAt`, and nothing
  else; `createdBy` / `createdVia` are untouched, so the app-written mark stays true.
- `locationAncestorIds` ends with the node's own `locationId` — the property that lets
  the board's shared query (Q1) roll a location up through one `array-contains`
  ([boards-and-nodes § Queries](boards-and-nodes.md#queries)). The rewrites preserve
  it.
- Offline: a queued location move lands late, the trigger fires then, and the nodes
  catch up when it does. Consistent, not immediate.

## REST

The verbs live in the [rest-api](rest-api.md) contract like every other endpoint:
`GET` / `POST /api/v1/homes/:homeId/locations`, `PATCH` / `DELETE
/api/v1/homes/:homeId/locations/:locationId`, with the same `ETag` / `If-Match`
concurrency, the same mirrored validation, and `PATCH` owning rename *and* move. What
is location-specific:

- **POST** derives `ancestorIds` server-side from `parentId`, never trusted from the
  body (the same reason bulk create resolves caller-chosen refs itself); `rank`
  defaults to end the way node creation does.
- **PATCH** moving a location under its own descendant is a named `400 cycle`, the
  client-side refusal restated where the server can say it.
- **DELETE** cascades, but has to be asked: `409 has_children` naming the location,
  then `?cascade=true` deletes the subtree. The cascade is an Admin-SDK delete, so the
  trigger unfilms anchored nodes on that path too — one contract for both writers.

`locationId` on **node** bodies stays refused with `400 locations_unavailable`; lifting
that is #51's, and `rest-api.md` and `SKILL.md` say so, so an agent that builds the
tree does not read the refusal as breakage.

## Rules

`get`, `list`, `delete`: `isMember(homeId)`. `create` and `update` add
`validLocation(request.resource.data)` — update also `immutable()` over `createdAt` /
`createdBy`.

`validLocation(data)`: title string 1–200; `parentId` null or string; `ancestorIds` a
list passing the same `structure()` check nodes use (root ⇒ empty, else last element
equals `parentId`, and the document's own id is not in it); `rank` a non-empty string;
`createdAt` / `createdBy` / `updatedAt` present. **No `get()` anywhere** — locations
carry no inheritance invariant beyond structure, so a batched subtree move never
approaches the twenty-document-access budget the node reparent's parent `get()` spends.

## The Locations tab

A tree of rows, one `List.Item` per location, indented by depth. A chevron toggles
children; expansion is client-side session state, default expanded, not persisted
(revisit with #182). Tokens from `theme/tokens.ts`; no numeric literal in a style prop,
no colour literal outside `theme/`.

- The **FAB** ("Add location", width-capped per the boards FAB rule) creates a root
  place. A row's overflow `Menu` carries **Add under…**, **Rename**, **Move under…**,
  **Delete**. Delete lives only in this menu — never a swipe, never a long-press
  (Ingrid at 200% text with one thumb).
- **Add** and **Rename** open a dialog (`AppDialog` + `TextInput`, the `TitleDialog`
  pattern); the name is required and trimmed.
- **Move under…** opens a destination picker mirroring `CardMenu`'s: **Top level** plus
  every location, with the moved location's own subtree rendered **disabled**.
- **Delete** opens a destructive `ConfirmDialog`: title "Delete {{name}}?", body naming
  the location and saying "and everything under it". No counts — the delete says
  "everything under it", never a number. The cascade is unconditional once confirmed.
- **Empty state**: one line saying what places are for and one create button — the
  homes screen's empty-state-onboarding pattern. Blank start: no seeded room templates,
  per `PROJECT.md` § Locations; starter templates are [#68](https://github.com/Senth/home-backlog/issues/68)'s.
- **Large text**: the indent step caps with depth so a four-level row at 200% still
  shows its whole name; the name wraps rather than ellipsizes; chevron and menu keep
  fixed width. Structure yields before the name does.

## Strings

The noun is "Locations" / "Platser"; never "sublocation", "hierarchy" or "node" in a
user string. Offline hints reuse the existing board keys where the wording fits.

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

`locations.actions` is the row menu's accessible label; the add/rename dialog confirms
with the shared `board.add` ("Add"). The `screen.locations` namespace carries the
screen's ready keys (`emptyTitle`, `loadFailed`).

## Out of scope

- **Anchoring nodes to places, and roll-up views** —
  [#51](https://github.com/Senth/home-backlog/issues/51). It lifts
  `locations_unavailable` on node writes, designs Overview's place filter, and grows
  the delete dialog's wording to say what happens to filed work.
- **Sibling reorder** — [#182](https://github.com/Senth/home-backlog/issues/182). Rank
  is fractional from day one, so it is a pure UI change later; expansion state
  persistence is revisited with it.
- **Bulk location create over REST** —
  [#181](https://github.com/Senth/home-backlog/issues/181).
- **Starter location templates** —
  [#68](https://github.com/Senth/home-backlog/issues/68).
- **A drawer/sidebar on wide screens** — navigation-wide work with its own issue to be
  filed when taken up; the tree ships on the Locations tab.
