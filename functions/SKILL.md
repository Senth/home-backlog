---
name: home-backlog-api
description: Read and write a Home Backlog board over REST — nested kanban nodes where a project, a task and a subtask are the same thing at different depths. Use when asked to research, break down, file or re-prioritise home-improvement work for a household, or when a prompt mentions Home Backlog, hb.senth.org, or an API key beginning hb_. Covers bearer auth, the node verbs, and the atomic bulk create that writes a whole subtree in one undoable call.
api-version: 1.3.0
---

# Home Backlog API

Home Backlog is a home-improvement backlog built from nested kanban boards. A project, a
task and a subtask are the same kind of thing, a *node*, at different depths, and any node
with children can be opened as a board.

This API exists so your own agent can do the research and the breaking-down, and write the
result in. The app deliberately contains no LLM.

## Staying current

This file states the contract version it was written against, as `api-version` in the
frontmatter above. Every API response carries an `X-Api-Version` header, which is the
version the deployment is actually running.

While the two agree, this copy is current and there is nothing to fetch. When they differ,
this copy is stale:

```
GET https://hb.senth.org/api/v1/skill.md
```

Follow what that returns and ignore this file. The served copy is stamped by the deployment
serving it, so its `api-version` is never a claim about somebody else's version.

One answer never carries the header. The hosting platform rejects a body that is not valid
JSON before this API sees it, and replies with a plain `400` and an HTML body rather than
the envelope below. A missing header there says nothing about the version.

## Authentication

Send your key as a bearer token:

```
Authorization: Bearer hb_<uid>.<keyId>.<secret>
```

Every home you write into records that your key wrote there, and every node you create is
marked as written by an automation. Both are visible to the whole household. That is the
deal. You get broad access without a permission dance, and the people whose home it is can
see what you did.

Anything wrong with the token, whether missing, malformed, revoked or the wrong secret, is
the same `401`. It does not tell you which.

## Errors

```json
{
  "error": {
    "code": "status_not_in_columns",
    "message": "This board shows backlog, execution, done.",
    "details": [
      { "index": 3, "field": "status", "code": "status_not_in_columns", "message": "..." }
    ]
  }
}
```

`code` is stable and machine-readable. `message` is English prose for a human reading your
logs. `details` appears when more than one thing is wrong, and carries `index` for a bulk
payload. Messages are not translated, because the app never shows them.

| Status | Means |
| --- | --- |
| `400` | The request is wrong. Fix it and resend; it will not become right. |
| `401` | The key is missing, malformed or revoked. |
| `404` | No such home, node, location or label — or a node you are not allowed to see. Deliberately the same answer. |
| `409` | You asked for something that needs confirming (`has_children`) or does not fit (`subtree_too_large`). |
| `412` | `If-Match` did not agree. Read the node or place again. |
| `413` | The body is over 1 MB. |
| `500` | Our fault. Retry is reasonable. |

Nothing is ever half-written. A request that fails writes nothing at all.

## The shape of the data

A node is one card. It has a `parentId` (`null` at the top level) and an `ancestorIds`
path derived from it. Its `columns` field is the column set of the board *its children*
form. Every status, at every depth, set when the node is created and never changed after. A
board created by an older version of the app may carry a narrower set.

A node's `status` must be one of its parent's `columns`. The API is stricter than the
database here on purpose. A card in a column its board does not draw can be moved out and
never back, and you cannot see the board you are writing to.

The four statuses are `backlog`, `next_up`, `execution`, `done`, which read as *To do ·
Next up · In progress · Done*.

### Privacy

A node is `shared` (everyone in the home) or `private` (only its `participantIds`).
Visibility is uniform down a subtree. Every child has its parent's visibility, and a
private child carries all of its parent's participants. A private card therefore cannot live
inside a shared project. It sits at the top level, or under another private card.

You may create a private top-level node, and it gets your key's owner as its only
participant. You may not change `visibility` or `participantIds` on anything that already
exists. A bearer token in an env file must not be able to change who can see a household's
work. That belongs to a person, in the app.

## Verbs

### `GET /v1/homes`

Every home your key's owner is a member of, with its members' uids and display names, which
is what you need to fill `assigneeIds`.

### `GET /v1/homes/{homeId}/nodes?parentId={nodeId}`

One board: the non-archived children of `nodeId`, in `rank` order. Omit `parentId` for the
top-level board. Cards you are not allowed to see are not there.

### `GET /v1/homes/{homeId}/nodes/{nodeId}`

One node. The response carries an `ETag`. Send it back as `If-Match` on a later write to be
told, rather than silently overwrite, if somebody edited the card in between.

### `POST /v1/homes/{homeId}/nodes`

One node. `title` is required; everything else is optional.

```json
{ "title": "Replace the bathroom extractor fan", "status": "next_up", "priority": "high" }
```

Returns `201` and the created node. The API computes `rank` for you, at the end of its column.

### `PATCH /v1/homes/{homeId}/nodes/{nodeId}`

One update verb, and it owns moving as well as editing:

- send `status` and the card changes column. The API recomputes its `rank` for the new
  column, and `completedAt` follows `done` in both directions.
- send `parentId` and the card moves, taking its whole subtree with it. The API rewrites
  `ancestorIds` all the way down and fixes both parents' counters.

You do not need to know which of those you are doing. Send the fields you want changed.

### `DELETE /v1/homes/{homeId}/nodes/{nodeId}`

A node with children answers `409 has_children` and tells you how many. Repeat with
`?cascade=true` to delete the subtree. That is deliberate. The destructive act has to be
spelled out rather than stumbled into, and the first answer tells you how much you were about
to remove.

### `POST /v1/homes/{homeId}/nodes:bulk`

This is the endpoint the API exists for. One run, one new subtree, one atomic commit.

Nodes reference each other by a `ref` you choose, valid only inside the request. Exactly one
node has no `parentRef`, and that one is the new root. The optional top-level `parentId`
attaches that root under a node that already exists.

```json
{
  "nodes": [
    { "ref": "root", "title": "Replace the bathroom extractor fan", "status": "next_up",
      "effort": "evening",
      "notes": "The current one is loud and barely clears the mirror." },
    { "ref": "spec",  "parentRef": "root", "title": "Measure the duct and the opening" },
    { "ref": "buy",   "parentRef": "root", "title": "Order a quieter fan",
      "blockedBy": [] },
    { "ref": "fit",   "parentRef": "root", "title": "Fit it and test the run-on timer" },
    { "ref": "specA", "parentRef": "spec", "title": "Check whether it vents to the soffit" }
  ]
}
```

```json
{
  "rootId": "twQ7kQTHVfBinUgwXHfs",
  "ids": {
    "root": "twQ7kQTHVfBinUgwXHfs",
    "spec": "wJg9A41tevu4ydzlnZvz",
    "buy":  "yWZwxblsNX8GiZZzOtA6",
    "fit":  "IpCatgl1o38rDHSWcTGQ",
    "specA":"cTzirPkapJN5lTFNh74I"
  }
}
```

Siblings land in the order you list them, per column. At most 498 nodes per call, because
it commits as one batch. Send the rest as a second run under the same root.

One call is one new root, and that is what makes your run undoable. The person whose home it
is deletes one card, once, and everything you wrote goes with it.

**Retrying safely.** Send an `Idempotency-Key` header, any string of up to 200 characters of
letters, digits, `-`, `_`, `.` or `:`. A repeat of the same key returns the same `ids` with
`Idempotency-Replayed: true` and writes nothing. The API remembers runs for 24 hours.

**Errors are per index.** The API validates the whole payload before writing anything, and
you get every failure at once:

```json
{ "error": { "code": "title_required", "message": "3 nodes in this payload are not valid. Nothing was written.",
  "details": [ { "index": 1, "field": "title", "code": "title_required", "message": "A node needs a title." } ] } }
```

### `GET /v1/homes/{homeId}/locations`

Every place in the home — rooms, floors, the garden — in `rank` order. Locations have no
privacy: every member sees every place.

### `POST /v1/homes/{homeId}/locations`

One place. `title` is required; `parentId` nests it under another place and `rank` places it
among its siblings (omit both for a top-level place at the end).

```json
{ "title": "Garden", "parentId": "wJg9A41tevu4ydzlnZvz" }
```

Returns `201` and the created location, with its `ETag` in the response headers — there is
no single-place read verb, so that is where you first get one. Its path is derived from
`parentId` — send `ancestorIds` and it is refused, like every computed field. A whole tree
of places in one call is `POST /v1/homes/{homeId}/locations:bulk` below.

### `PATCH /v1/homes/{homeId}/locations/{locationId}`

One update verb, like the node one: send `title` to rename, `parentId` to move the place and
everything under it. Moving a place inside its own subtree is `400 cycle`. The response
carries an `ETag`, and `If-Match` guards the write exactly as it does for nodes.

### `DELETE /v1/homes/{homeId}/locations/{locationId}`

A place with children answers `409 has_children` and tells you how many. Repeat with
`?cascade=true` to delete the subtree. Work anchored to a deleted place is unfiled — its
`locationId` becomes `null`.

### `POST /v1/homes/{homeId}/locations:bulk`

One run, one new place tree, one atomic commit — the node bulk create above, mirrored for
places. This is the endpoint for writing a thirty-node location tree as one call rather
than thirty.

Entries reference each other by a `ref` you choose, valid only inside the request. Exactly
one entry has no `parentRef`, and that one is the new root. The optional top-level
`parentId` attaches that root under a place that already exists. There is no `rank` inside
a payload: siblings land in the order you list them, and the root lands at the end of its
existing siblings.

```json
{
  "locations": [
    { "ref": "garden", "title": "Garden" },
    { "ref": "shed",   "parentRef": "garden", "title": "The shed" },
    { "ref": "bench",  "parentRef": "shed", "title": "The workbench" }
  ]
}
```

```json
{
  "rootId": "twQ7kQTHVfBinUgwXHfs",
  "ids": {
    "garden": "twQ7kQTHVfBinUgwXHfs",
    "shed":   "wJg9A41tevu4ydzlnZvz",
    "bench":  "yWZwxblsNX8GiZZzOtA6"
  }
}
```

At most 499 places per call, because it commits as one batch. Send the rest as a second
run under the same root. One call is one new root, so one delete of the place you named
takes everything the run wrote back with it.

**Retrying safely.** Send an `Idempotency-Key` header, exactly as for nodes: a repeat of
the same key returns the same `ids` with `Idempotency-Replayed: true` and writes nothing,
and runs are remembered for 24 hours.

**Errors are per index.** The whole payload is validated before anything is written, and
you get every failure at once in the same envelope the node bulk create returns.

### `GET /v1/homes/{homeId}/labels`

Every label definition the home has, in board order — `rank`, then id — each row carrying
its `etag`. A label definition is a `title`, a `color`, an `icon` and a `rank`; cards carry
label **ids** from this list, never the definitions themselves.

### `GET /v1/homes/{homeId}/labels/{labelId}`

One label. The response carries an `ETag` header, and the row carries the same value as its
`etag` field. An id no definition answers to is `404 label_not_found`.

### `POST /v1/homes/{homeId}/labels`

One definition. `title`, `icon` and `color` are required — a vocabulary of unnamed or
uncolored entries is not a vocabulary — and `rank` is optional, defaulting to the end of the
set. Omitting a required field is a `400` naming it: `title_required`, `unknown_icon` or
`invalid_color`.

```json
{ "title": "Water damage", "icon": "water", "color": "blue" }
```

Returns `201` and the created label, with its `ETag` in the response headers.

`color` is one of `red`, `orange`, `amber`, `lime`, `green`, `teal`, `cyan`, `blue`,
`indigo`, `purple`, `pink`, `stone`, or a `#rgb` / `#rrggbb` hex — anything else is
`400 invalid_color`. `icon` must be a MaterialCommunityIcons glyph name the app's own picker
offers, such as `wrench`; a hallucinated one is `400 unknown_icon`.

A home holds at most **300** label definitions, and a create past that is
`409 label_limit_reached`. A title another definition already carries — compared trimmed and
case-insensitively, so " Kitchen " is "kitchen" — is `409 duplicate_label`.

### `PATCH /v1/homes/{homeId}/labels/{labelId}`

Send `title`, `icon` and/or `color`; only the fields you send change, each as its own
update. `rank` is not a field here — reordering stays a person's drag handle in the app, and
sending it is `400 unknown_field`. `If-Match` guards the write exactly as it does for nodes
and places, and a rename onto a taken title is `409 duplicate_label` — a rename never
collides with itself.

### `DELETE /v1/homes/{homeId}/labels/{labelId}`

Deletes the definition only. Cards keep the id: they render the label as nothing and stay
fully updatable, and that is a designed-for state, not a broken reference. `If-Match` guards
the write as everywhere else.

## Fields

Fields you may send are marked ✅. The API computes the rest, and sending one is a
`400 unknown_field` rather than something quietly ignored. You should never believe you
filed work you did not file.

| Field | Write | Where it shows up |
| --- | --- | --- |
| `title` | ✅ | Shown in the app as the card face. |
| `status` | ✅ | Shown in the app. Which column the card is in. |
| `notes` | ✅ | Shown in the app, on the detail screen. Up to 10 000 characters. |
| `dueDate` | ✅ | Shown in the app. `YYYY-MM-DD`, a calendar day rather than an instant. |
| `priority` | ✅ | Shown in the app. `low`, `normal`, `high`, `urgent`, or `null`. |
| `effort` | ✅ | Shown in the app. `quick`, `hours`, `evening`, `weekend`, `multi_week`, or `null`. |
| `assigneeIds` | ✅ | Shown in the app. Who is doing this card. Uids from `GET /v1/homes`. |
| `parentId` | ✅ | Structure. On `POST` it places the node; on `PATCH` it moves the subtree. |
| `locationId` | ✅ | Filing work in a place (#246): the id of one of the home's places, which the **Locations** verbs above list and create. On `POST` an omitted `locationId` inherits the parent's place and `null` unfiles; on `PATCH` only what you send is written, `null` unfiles. A place that does not exist answers `404 location_not_found`. Rendered in the app as the place's leaf name on the card footer and the detail screen. |
| `visibility` | ✅ on create, at the top level only | Shown in the app. `shared` or `private`. |
| `blockedBy` | ✅ | Rendered in the app as *Waiting*: the app derives the state from the blockers' statuses, and nothing auto-clears it — a done blocker stops holding cards, and reopening one re-blocks them. Writing a private node's id into a shared card's list leaves the other members a row they cannot read and can remove. |
| `labelIds` | ✅ | The card's labels, as ids of the home's label definitions — at most **6**. Rendered as colored dots beside the card. The definitions behind the ids are the **Labels** verbs above: list them there, and create one before you write its id onto a card. A card naming a gone id renders as nothing and stays updatable. |
| `checklist` | ✅ | **Stored, no screen yet.** Up to 200 items. Nothing renders it today. |
| `locationAncestorIds` | ❌ | Derived from the place `locationId` names, so sending it is refused rather than ignored. |
| `participantIds` | ❌ | Shown in the app. Whose project this is. Set by a person. |
| `archived` | ❌ | Hides a card from every board. Nothing in the app can bring one back yet, so nothing here may hide one. |
| `rank`, `columns`, `ancestorIds`, `childCount`, `doneCount`, `completedAt` | ❌ | Computed. |
| `createdAt`, `createdBy`, `updatedAt`, `createdVia` | ❌ | Computed. |
| `photos` | ❌ | Uploaded by a person, from a device. |

Everything marked **stored, no screen yet** accepts writes and renders nowhere. Populate it if
it helps you, but do not expect a person to see it.

## What this API cannot do yet

- **Filing work in a place, in bulk.** The node verbs take `locationId` (#246), but the
  bulk node create does not: a payload naming one is refused rather than ignored, since
  the planner does not resolve places. File each node with a follow-up `PATCH`.
- **Recurring maintenance.** No verbs yet.
- **Changing `visibility` or `participantIds`** on anything that exists. A person does that.
- **Creating a home, inviting, accepting an invitation.** Human-only.
- **Custom statuses.** The four are the vocabulary.
- **Notifications of any kind.** There are no webhooks. Poll.

## Practical notes

- **Read before you write.** Fetch the top-level board first. A household usually already has
  a project your work belongs under, and attaching to it beats creating a ninth root.
- **Prefer one bulk call to twenty single ones.** It is atomic, it is one undo, and it is one
  row in the household's automations list rather than a stream.
- **Write plainly.** Whoever lives there reads your titles, on a phone, possibly at large
  text. "Order a quieter fan" beats "Procurement: acoustic specification".
- **Do not give safety advice you would not sign.** Gas, mains electricity and structural
  work are jobs to book somebody for. Say that instead of describing the procedure.
