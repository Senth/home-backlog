# REST API, API keys and SKILL.md

A REST API on Cloud Functions at `https://<app origin>/api/v1`, authenticated by per-user
API keys, carrying the node verbs and a served `SKILL.md`, so a household member's own AI
agent can populate and drive a board without touching the UI.

Assumes [`boards-and-nodes`](boards-and-nodes.md) and
[`home-and-members`](home-and-members.md), and does not repeat them.

## Why

`PROJECT.md` puts the API in the core scope and treats it as part of the product rather
than an add-on. The app deliberately contains no LLM, and inverts the usual design: research and
task breakdown happen in the user's own agent, which writes the results in. That removes
per-user inference cost and any liability for generated advice about wiring or gas. An API
that arrives late would mean the app grows a shape agents cannot express.

### Keys are per user, not per home

`PROJECT.md` once said "scoped to a home". That was wrong.

A person is in several homes: the house, the cabin, a parent's place. Per-home keys mean
one credential per home, an agent reconfigured every time a home is added, and a key that
silently stops covering work when a project moves. A key is therefore the user. It
reaches every home its owner is a member of, and gains access to a new home the moment
they join one.

*The cost is real and is paid deliberately.* Marcus is a member of Ingrid's cabin, so
Marcus's agent can write into the cabin, and Ingrid, who will never own a key, has no
way to revoke it. Two things answer that, and neither is optional: every node an agent
writes is marked, and every home lists the automations that have written into it.
Ingrid cannot revoke Marcus's key, but she can see it exists, see which of her cards it
wrote, and ask him. That is the same shape as membership itself, which she also cannot
unilaterally undo.

*Rejected:* per-home keys. See above.
*Rejected:* a key that must be granted per home by that home's owner. It makes the common
case, one person with their own homes and their own agent, a multi-step permission dance,
to guard against a person the household already trusts with full membership.

Read-only versus read-write scopes are [#92](https://github.com/Senth/home-backlog/issues/92).

### The function writes with the Admin SDK, and mirrors every invariant in TypeScript

The alternative was for the function to *impersonate* the user: mint a custom token,
exchange it for an ID token, and talk to the Firestore REST API so that `firestore.rules`
applies verbatim. That was rejected for one decisive reason. **A bulk subtree create then
cannot be atomic.** A rule's `get()` reads committed state, so a child written before its
parent commits fails `inheritsFrom`, which is exactly why `flipVisibility` writes top-down,
one document at a time. Over a network, top-down means a timeout mid-flight leaves half a
tree, and half a tree is not untidy but *corrupt*. A child whose parent is missing carries
`ancestorIds` pointing at nothing, is unreachable from every board and every breadcrumb,
and is the silent-orphan failure that `boards-and-nodes` is built around preventing.

The Admin SDK bypasses rules, so a whole subtree commits in one atomic batch, up to the
500-document commit cap, and with no 20-document-access budget, because that budget is a
rules limit and no rules are evaluated.

What that costs is that the invariants are no longer enforced on this path by the rules
that state them. So they are re-implemented in `functions/src/validate.ts`: the field
set and its bounds, `structure`, `inherits`, the uniform-visibility invariant, the
`status`-within-`columns` rule, and membership. Unit tests cover the same cases as
`tests/rules/firestore.test.ts`. Two implementations of one truth can drift; that risk is
accepted and mitigated by the tests being written from the same list.

*Rejected:* Admin SDK with no mirrored validation. The rules still guard every client path,
so it would work until one handler wrote a private child under a shared parent, and then
fail silently and permanently.

`boards-and-nodes` rejected a Cloud Function for the visibility flip partly because it would
be "the project's first Cloud Function, a deploy pipeline". This *is* that function and it
brings that pipeline, so that half of the objection is spent. The other half stands: the
invariant is no longer enforced by rules on the path most likely to break it. So the flip
stays a client-side operation. See [below](#what-this-does-not-change).

### The function is its own ESM package, and shares no code with the app

`functions/` is a plain sibling npm package, not a yarn workspace. The root is an Expo app
whose Metro config, `@/` alias and jest preset all assume they own the tree. Two
consequences are worth stating, because both were arrived at the expensive way.

**It is ESM.** `fractional-indexing`, the library that generates `rank`, ships as ESM
only, and a CommonJS function cannot `require` it at all. Re-implementing it was rejected.
`generateKeyBetween` *validates* the key it is given, so a hand-rolled rank of the wrong
shape does not sort badly, it makes the client's next reorder throw. The price of ESM is
the `.js` extension on every relative import, and one trap. An ES module's imports are
evaluated before its own body, so `setGlobalOptions` in `index.ts` runs *after* every
re-exported function is already defined and they deploy to `us-central1`. Every function
therefore names `region` explicitly. It fails as a working deployment in the wrong place
rather than as an error, which is why it is written down.

**Nothing is compiled across the boundary.** Sharing `models/api-key.ts` was tried. Under a
hybrid module kind TypeScript picks a file's format from the nearest `package.json`, and the
repo root's has no `"type"`, so a shared file emits as CommonJS into an ESM package and Node
cannot named-import it. The seam turned out to be real anyway. The app never parses,
formats or hashes a token. It is handed the finished string once by `createApiKey`, shows
it, and forgets it; the `tail` it renders afterwards is stored. So the token format lives
wholly in `functions/src/api-key.ts`, next to the only code that verifies it, and
`models/api-key.ts` keeps the one rule a *screen* enforces: a key is named before its secret
is revealed. `maxKeyNameLength` is stated on both sides, which is a duplicated bound rather
than a duplicated implementation.

The mirrored *node* vocabulary in `functions/src/node.ts` is a different matter and is a
deliberate copy. See below.

### Validate everything, then commit atomically

A bulk request is validated in full before anything is written. Validation is pure
TypeScript with no I/O, so it is separable from the write:

```
validate all N nodes  →  any failures?  400, per-index errors, nothing written
                      →  all valid?     one atomic batch, all or nothing
```

The caller gets precise per-index errors it can fix and resend, and a half-written tree
never exists.

*Rejected:* partial success, writing what validates and reporting failed indexes. It only
helps if failures are unpredictable at validation time, and they are not. A too-long title,
an unknown status, a `parentRef` that is in neither the payload nor the database are all
decidable before writing. What it buys instead is the orphan.

After validation the only remaining failure is the commit itself, which fails whole and
writes nothing.

There are two passes, not one, and the difference shows. Reading the payload (is this a
node-shaped object, does it have a `ref`, does it name a field this endpoint writes) happens
before planning it (does its `parentRef` resolve, is its title within bounds, is its status
in the board's columns). Each pass reports all of its own failures at once, so a payload
that is malformed *and* invalid takes two round trips. Merging them would mean planning a
tree out of nodes that could not be read, which is where an orphan would come from.

The cap is `500 − 2` nodes rather than 500. One write in the batch is the attach parent's
counters and one is the replay record, and both ride along deliberately. A replay record
written separately could fail on its own, and an agent that retried would then write the
whole subtree a second time.

### The server assigns node ids; the payload uses local refs

Nodes in a bulk payload reference each other by a caller-chosen `ref` string, valid only
within the request. The response returns a `ref` → id map.

*Rejected:* caller-supplied document ids. It gives a beautiful replay story, repeat the
request and the ids already exist so you return them, but agents generate `"1"`, `"2"`,
`"3"`. Those collide with the next run in the same home; they make the replay test ("all
ids already exist") misfire, since "all exist" then means "someone else used them";
monotonic ids concentrate writes into one Firestore index range; and some strings are not
legal document ids at all. Enforcing an auto-id shape (`^[A-Za-z0-9_-]{20}$`) would have
fixed all four, at the price of a rule every agent author has to satisfy before writing
anything. Server ids move that burden to the server, where it belongs.

Replay protection is therefore explicit: an optional `Idempotency-Key` header, recorded
at `users/{uid}/apiKeys/{keyId}/runs/{key}` with the resulting map and replayed on a
repeat. It lives in API-land, under the key that made the run, so the node document stays
exactly what `boards-and-nodes` describes and revoking a key takes its run history with it.

*Rejected:* the idempotency key as a field on the created root node. No extra collection
and no TTL, but it puts an API concern into the schema that every screen, the rules and the
spec's field table then carry forever.

### One bulk call is one new root

A bulk payload contains exactly one node without a `parentRef`. It may attach under an
existing node by naming that node's id as the request's `parentId`, but it is always one
new subtree.

That is what makes an agent run undoable: one run, one root, one delete, one confirmation
dialog. A forest payload would leave Marcus deleting each root by hand, online-only, one
confirmation each, for a single mistaken run.

### A key does almost everything its owner does

| Operation | Key | Why |
| --- | --- | --- |
| Read nodes it may see | yes | |
| Create, update | yes | the point of the feature |
| Move (`status`, `rank`) and reparent | yes | via `PATCH`, see below |
| Assign anyone (`assigneeIds`) | yes | no rule reads it, so it is not a permission change |
| Create a private root | yes | with `participantIds` = the key's owner |
| Change `visibility` on an existing node | **no** | the flip is the most dangerous write in the app |
| Change `participantIds` on an existing node | **no** | on a private node it *is* the access list, and editing it is the same top-down resumable write as the flip |
| Delete | yes, guarded | see below |
| Write location fields | **no** | see below |

The `visibility` and `participantIds` restrictions are the same restriction stated twice:
a bearer token in an env file must not be able to change who can see a household's work.
`assigneeIds` is deliberately unrestricted. `boards-and-nodes` already notes that keeping
assignment out of `participantIds` is what makes an API key able to assign without being
able to revoke.

### `PATCH` owns moves and reparents

There is one update verb. Sending `status` makes the server recompute `rank` at the end of
the target column; sending `parentId` makes it rewrite `ancestorIds` for the whole subtree
and fix both parents' counters. The client's split into `updateNode` / `moveNode` /
`reparentNode` exists because three different screens call them, which is a UI concern. An
agent should not have to know which of three calls its edit needs.

*Rejected:* mirroring the client's five writes as `:move` and `:reparent` endpoints. Easier
to trace against `data/nodes.ts`, harder to use, and the mapping is exactly the thing
`SKILL.md` would then have to explain.

### Delete cascades, but has to be asked for

`DELETE` on a node with children returns `409 has_children`, naming the child and
descendant counts. Repeating it with `?cascade=true` deletes the subtree.

This is the API's confirmation dialog. The app makes a destructive delete deliberate with a
`ConfirmDialog`; over REST the equivalent is that the destructive act must be spelled out
in the request rather than stumbled into, and the first response tells the agent exactly
how much it was about to remove.

*Rejected:* refusing to delete roots outright. An agent that writes a wrong tree could then
never clean up after itself, and every mistake would become Marcus's manual work.
*Rejected:* requiring the caller to echo an expected descendant count. Strongest guard, one
more thing for every agent author to get right, for a case the `409` already reports.

### Location fields on nodes are refused, not ignored

`locationId` and `locationAncestorIds` in a **node** request body return `400
locations_unavailable`. Filing work in a place is
[#51](https://github.com/Senth/home-backlog/issues/51)'s and has no semantics yet, so
nothing can check a location id a caller names, and `locationAncestorIds` is a
denormalized path that is unverifiable from outside. An invented one makes "everything in
the Basement" return the wrong set permanently, with no screen anywhere showing a
discrepancy.

*Rejected:* accepting and silently ignoring them. The agent then believes it filed work it
did not file.

The `locations` collection itself gained verbs with
[#50](https://github.com/Senth/home-backlog/issues/50) — `GET` and `POST` on
`/homes/:homeId/locations`, `PATCH` and `DELETE` on
`/homes/:homeId/locations/:locationId` — mirroring the node verbs one endpoint set over.
`ancestorIds` is derived server-side from `parentId`, never trusted from a body; `PATCH`
owns rename and move, with `400 cycle` for a move inside the moved place's own subtree; and
`DELETE` answers `409 has_children` before `?cascade=true` deletes the subtree in one batch,
so the node-maintenance trigger unfilms every anchored node on that path too. Work created
over the API stays unfiled until #51, and `SKILL.md` says so.

### A status outside the parent's frozen columns is refused

`400 status_not_in_columns`, naming the allowed set. The column set is frozen at creation,
and a card in a column the board does not show has a one-way exit. The move sheet only
offers frozen destinations, so it can be moved out of an appended column and never back.
The rules permit any of the four statuses because
[#63](https://github.com/Senth/home-backlog/issues/63) will edit column sets; the API is
stricter than the rules on purpose, because an agent has no eyes on the board it is
writing to.

### An agent-written node says so

Nodes gain `createdVia: 'app' | 'api'`, written at creation and immutable. The node
detail screen carries one plain line for `'api'`; the card face carries nothing.

Marcus curates everything and needs to know which of forty cards a machine wrote. Ingrid
needs to understand eleven cabin cards that appeared at 03:00 without meeting the word
"API". One line in her own register, *Tillagd av en automation*, does both.

*Rejected:* a chip on the card face. It marks every card on the boards that are already
fullest, which is the clutter `PROJECT.md`'s overwhelm principle exists to prevent.

### Homes list the automations that have written into them

`homes/{homeId}/apiClients/{keyId}` is upserted by the function the first time a key
writes into that home, and read-only for every member. The manage screen shows *"Marcus ·
research agent · 3 h ago"*.

A read records nothing. The list answers "what has written here", and a key that only ever
reads has written nothing. A row for it would say an automation touched a household's work
when it only looked at it.

The upsert is awaited, unlike the `lastUsedAt` touch on the key itself. That one starts
before the handler does its work and has the whole request to finish in; this one runs after
the commit, and a Cloud Run instance is CPU-throttled the moment a response returns, so a
promise left running there may never complete. The household would then read "No automation
has written here" about a home an agent writes into every night.

It is derived from writes rather than from grants, because there are no grants. A key
reaches every home its owner is in, so "who could write here" is just "every member". What
a household actually wants to know is what has written here.

Revoking a key deletes those rows through an `onDocumentDeleted` trigger. A row for a key
that no longer exists is worse than no row. It tells Ingrid something has access when
nothing does.

### A request body is an allow-list, and an unknown field is a refusal

Most of a node document is the server's: `ancestorIds` is derived from `parentId`, `columns`
is frozen at creation, `rank` is computed from the target column's neighbours, the
counters move with `increment()`, and `completedAt` follows `status`. A caller that could set
any of them could write a document that is internally consistent field by field and wrong as
a whole. So the two write verbs each carry a list of the fields they accept, and anything
else is a `400 unknown_field` naming the field and the ones that would have worked.

*Rejected:* dropping unknown fields silently. Same argument as the location fields. The
agent then believes it wrote something it did not write.

Four fields get their own code rather than `unknown_field`, because each is a different
answer: `locationId` and `locationAncestorIds` are `locations_unavailable`, `visibility` on
an update is `visibility_immutable`, and `participantIds` is `participants_immutable`, with
a different message on a create, where the answer is not "never" but "a private root gets its
creator, and anyone else is added in the app".

**`archived` is not writable either**, and that is the one entry on the list that is about
timing rather than authority. It constrains every board query, so an archived node leaves
every screen, and nothing in the app writes or reads the field yet: no archive list, no
unarchive control, nothing that shows an archived card at all. A key that could set it could
put a household's work somewhere only another API call could reach. It also moves no
counters, so a project whose only step was archived would keep its steps glyph and open an
empty board, which is what "a card is a board only once it has steps" exists to prevent. It
becomes writable when there is a screen that can undo it.

### The body limit is enforced by the app, and one error is not the app's to give

`onRequest` wraps the Express app in the Functions framework's own Express app, which
parses the request body before anything here runs. Two consequences, both found by driving
the deployment rather than by reading it:

- The `limit` passed to `express.json()` enforces nothing, because the framework has already
  buffered and parsed the payload and marks it done. The 1 MB ceiling is therefore a
  middleware of the API's own, measuring `rawBody`, what the framework actually buffered,
  which a caller cannot misreport the way it can misreport `Content-Length`.
- A body that is not valid JSON is rejected out there, with the framework's plain HTML
  `400` and no `X-Api-Version`. Nothing mounted inside runs for it. `SKILL.md` states that
  exception rather than promising a header the deployment cannot deliver.

*Rejected:* stamping `X-Api-Version` from a Hosting `headers` rule on `/api/**`. It would
cover the framework's own error page, at the price of the version being written where
`functions/src/version.ts` cannot keep it in step. A header that lies is worse than a header
that is occasionally absent.

### Optimistic concurrency is `ETag` and `If-Match`

Every single-node response carries `ETag: "<updatedAt as ISO 8601>"`, and the location
verbs carry the same contract: `POST /homes/:homeId/locations` and `PATCH
/homes/:homeId/locations/:locationId` return the created or written place with its
`ETag`. `PATCH` and `DELETE` honour `If-Match` against it, on nodes and locations alike,
returning `412 version_mismatch` when it does not agree and applying no precondition at
all when the header is absent. It is the whole of the concurrency control. An agent that
read a card, thought about it and comes back to write finds out that somebody edited it
in between instead of silently overwriting them.

Read verbs send the header too. Without that the only way to obtain one would be to write
first, which is the wrong way round.

### A subtree operation is one batch or it is refused

A reparent and a cascading delete each commit as a single batch, because a node whose parent
is gone is unreachable from every board and every breadcrumb. Firestore holds 500 writes per
commit, so a subtree that will not fit is `409 subtree_too_large` naming the count, rather
than a half-written tree. The app has no such limit only because it is not atomic there
either. `flipVisibility` is deliberately resumable instead.

### A stored rank the library refuses is stepped over, not fatal

`generateKeyBetween` validates the key it is handed and throws on one it did not produce.
Appending to a column therefore walks back to the last *usable* rank, and starts over if a
column has none. Unhandled, a single malformed rank from a fixture, a hand-edited document
or a future bug makes every create in that column a 500 and the column permanently
unwritable over the API, with nothing an agent could act on. The worst case of stepping over
it is a card in the wrong place in its column, which the next reorder fixes.

### `SKILL.md` is served by the deployment

`GET /api/v1/skill.md` returns the shipped contract as `text/markdown`, and every response
carries `X-Api-Version`. An agent fetches the contract it is actually talking to instead of
a copy vendored months ago, and can detect drift from the header alone.

The field table in it marks every field as either shown in the app or stored with no screen
yet. `checklist` ([#52](https://github.com/Senth/home-backlog/issues/52)) accepts writes
today and renders nowhere, and an agent that populates it deserves to know that before it
does. `blockedBy` ([#66](https://github.com/Senth/home-backlog/issues/66)) renders in the
app as *Waiting*: the app derives the state from the blockers' statuses. Nothing
auto-clears it — a done blocker stops holding cards, and reopening one re-blocks them.
Writing a private node's id into a shared card's list leaves the other members a row they
cannot read and can remove.

### The contract is a skill, and a vendored copy is the normal case

`SKILL.md` opens with YAML frontmatter — `name`, `description`, `api-version` — so the file
is installable as an agent skill rather than only readable as documentation. The
`description` is the only part a harness loads before the skill is invoked, so it names the
product, the URL and the `hb_` key prefix: the three things a prompt is likely to contain
when this file is the right one to open.

The body is complete on its own. An agent that installed it a month ago, or is running with
no network reachable from its sandbox, still knows the verbs, the error envelope and the
frozen-column rule. Staleness is handled by a *Staying current* section instead: compare the
frontmatter's `api-version` against `X-Api-Version` on any response, and re-fetch only when
they differ. In step, which is nearly always, that costs one header comparison and no
request at all.

`skill.ts` rewrites the `api-version` line from `version.ts` as it serves the file, so the
served copy states the version of the deployment serving it and cannot claim otherwise.
Check 11 in [`check-invariants.sh`](../../scripts/check-invariants.sh) holds the checked-in
copy to the same value, because that is the copy people read on GitHub and the copy the next
reader vendors.

*Rejected:* serving a thin `SKILL.md` whose body is an instruction to fetch the real one.
It reads as the fix for staleness and is worse at everything else. The fetch is a tool call
the agent may not have, may be refused, or may answer through a summarizer that paraphrases
the contract — and when it fails there is no contract left to fall back on, only an agent
guessing at verb names against a live household's data. A fat copy degrades to *slightly
out of date*; a stub degrades to *nothing*. The real defence against staleness is that the
contract only grows: a version bump means a new field or a new status code, which an older
copy does not use and is not broken by.

## Data and queries

### `users/{uid}/apiKeys/{keyId}`

New top-level `users` collection. It holds nothing but keys today; member display names and
photos stay in `memberProfiles` on the home, where the rules read them.

| Field | Type | Notes |
| --- | --- | --- |
| `name` | `string` | 1–60 chars, given by the user, required before the secret is revealed |
| `secretHash` | `string` | 64 hex chars, SHA-256 of the secret. The secret itself is never stored |
| `tail` | `string` | last 4 chars of the token, so a list of four keys is distinguishable |
| `createdAt` | `Timestamp` | |
| `lastUsedAt` | `Timestamp \| null` | written by the API, throttled to at most once a minute |

The token is `hb_<uid>.<keyId>.<secret>`, where `<secret>` is 32 random bytes
base64url-encoded. The `hb_` prefix is what secret scanners key on. Separators are dots
because base64url's alphabet includes `_` and `-` but never `.`, and a Firebase uid is
alphanumeric, so the three parts split unambiguously.

Carrying the uid is what makes verification a direct `get()` on
`users/{uid}/apiKeys/{keyId}`: one document read, no query, no index, and no
collection-group lookup on a hot path. A uid is not a secret. It is already visible to
every member of a shared home through `participantIds` and `memberProfiles`. Knowing one
grants nothing without the secret, which is compared against `secretHash` in constant time.

SHA-256 is sufficient here and bcrypt is not needed. The secret is 256 bits of server-side
randomness, not a human-chosen password, so there is no dictionary to run.

### `users/{uid}/apiKeys/{keyId}/runs/{idempotencyKey}`

| Field | Type | Notes |
| --- | --- | --- |
| `ids` | `map<string, string>` | `ref` → node id |
| `rootId` | `string` | |
| `createdAt` | `Timestamp` | |
| `expiresAt` | `Timestamp` | `createdAt + 24 h`; a Firestore TTL policy removes the document |

The TTL policy is configured per collection group and is an `OPERATIONS.md` step, not
something `firebase deploy` carries.

### `homes/{homeId}/apiClients/{keyId}`

| Field | Type | Notes |
| --- | --- | --- |
| `keyId` | `string` | duplicated from the document id so the delete trigger can query it |
| `ownerUid` | `string` | |
| `ownerName` | `string` | denormalized: the manage screen already has `memberProfiles`, but a key's owner may have left |
| `name` | `string` | the key's name |
| `lastUsedAt` | `Timestamp` | |

### `homes/{homeId}/nodes/{nodeId}` carries one extra field

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `createdVia` | `'app' \| 'api'` | `'app'` | written at creation, immutable |

**No backfill, and that is not an oversight.** The absent-field trap in `boards-and-nodes`
bites a field a query must match *negatively*; `createdVia` is never queried, only read
with the document it sits on and displayed. That is the same argument that let `columns`
arrive late. `toNode` reads an absent value as `'app'`, which is true of every node written
before the API existed.

### `participantIds` on a create

Since [#102](https://github.com/Senth/home-backlog/issues/102), `[]` is no longer a legal
root: the rules refuse a shared root with nobody on it. `POST /nodes` accepts
`participantIds` for exactly that reason — a body that omits it on a shared root takes
every current member, not `[]`, and a body that sends `participantIds: [me]` narrows it at
creation instead of in a second `PATCH` the caller cannot make anyway. A private root is
unaffected: it always takes the key's owner, alone.

The Admin SDK bypasses `firestore.rules` entirely, so `createNode` and the promotion arm of
`PATCH` (below) each refuse an explicit empty list on a shared root themselves,
`400 participants_required` — the one guard standing between an agent-written root and one
nobody can see.

A shared root is the *only* place the field is honoured, so a body naming one anywhere else
is refused rather than parsed and dropped — `400 participants_immutable`, the same contract
`visibility_mismatch` has one field over. On a child, because it takes its parent's list by
the inheritance rule; on a private root, because it takes its creator.

`POST /nodes:bulk` runs the same two guards, re-pointed at the offending node's index the way
every other bulk refusal is: only the payload's root may name participants, and only when it
becomes a real root — a payload attached under an existing parent has no root in it, so every
node in it inherits. Under a shared parent that means `[]`, like any other shared descendant;
under a private one, every node carries the parent's list, which is what makes "I am a
participant of every descendant I can read" true. A shared root that names none takes
every current member, for the same reason `POST /nodes` does, and with a sharper consequence
if it did not: `rootHasParticipants()` sits on `allow update` as well as `allow create`, so a
bulk-written root holding `[]` would be frozen against every later write from every client —
including the `childCount` bump that adding a step performs.

A named uid that is not a member of the home is `400 participants_invalid`, which names the
strangers rather than the whole list. A uid that is not a member is a typo or a stale id, and
storing it means a participant list naming somebody who can never see the project — a row on
the details screen that no member can untick and no member matches.

`PATCH /nodes/:id` still refuses `participantIds` by name, `participants_immutable`, for the
reason it always has: on a private node it is the access list, and it is a top-down
resumable write rather than a single one. Reparenting a shared step to `parentId: null`
carries the old root's participants along, the same asymmetry `reparentNode` fixes in the
app — a promotion into a root the #102 backfill has not reached still fails, which is the
same failure every other update to that root already gets.

### Queries

The app fires two new ones, both trivially safe:

| Screen | Query | Why it is safe |
| --- | --- | --- |
| Automations | `users/{me}/apiKeys` ordered by `createdAt` | path-scoped to my own uid; no document another user owns can match |
| `/homes/[homeId]` manage | `homes/{homeId}/apiClients` ordered by `lastUsedAt` desc | every document in the collection is readable by every member, so no matching document can be denied |

The function runs under the Admin SDK, so query safety does not constrain it, but its
queries mirror the client's so that behaviour matches:

- `GET /v1/homes` → `homes` where `members.<uid> in ['owner','member']`, exactly
  `myHomesQuery` in `data/homes.ts`.
- `GET /v1/homes/{h}/nodes?parentId=` → `nodes` where `archived == false && parentId == X`
  ordered by `rank`, then filtered in code to what the key's owner may see
  (`visibility == 'shared' || uid in participantIds`). The client has to split this into
  two queries because Firestore denies whole queries; the function does not, and must
  therefore apply the predicate itself. Getting this wrong leaks another member's private
  project through the API. It is the first thing to test.

### Indexes

`firestore.indexes.json` carries:

- `fieldOverrides` disabling indexing for `nodes.createdVia`, and for `apiKeys.name`,
  `apiKeys.secretHash`, `apiKeys.tail`. None is ever queried, and index entries are where
  storage cost lives.
- a collection-group single-field index on `apiClients.keyId`, for the delete trigger. It
  is the only index this area adds; token verification is a direct `get()`.

## Rules and tests

### `firestore.rules`

```
match /users/{uid} {
  match /apiKeys/{keyId} {
    // Minted by the callable function, which uses the Admin SDK and is not
    // subject to these rules. A client may see its own keys and revoke them,
    // and may never write one, because a client-written key would let a member
    // forge a hash they know the secret for.
    allow get, list: if signedIn() && uid == request.auth.uid;
    allow delete:    if signedIn() && uid == request.auth.uid;
    allow create, update: if false;

    // Replay bookkeeping. No client has any business reading it.
    match /runs/{runId} { allow read, write: if false; }
  }
}

match /homes/{homeId}/apiClients/{keyId} {
  allow get, list: if isMember(homeId);
  allow write: if false;          // the function only
}
```

The `createdVia` clause is on `allow create`, not inside `validNode`:

```
function createdInApp(data) {
  return !('createdVia' in data) || data.createdVia == 'app';
}
```

Putting it in `validNode` is the obvious placement and is wrong. `request.resource.data` is
the full post-update document, so an `'app'`-only test there would deny every *update* to a
node the API wrote, and curating what an agent wrote is the entire point of marking it. On a
create there is no such document, so the same expression means what it looks like it means.

It is present-only, for the same reason as `assigneeIds`. Requiring the field outright would
deny every update to every node written before the field existed, including the `childCount`
bump that adding a step to an old project performs, and there is no admin tooling in this
repo to unstick them. It is `'app'`-only, because the function bypasses rules so `'api'`
never needs to pass through here, and a member who could write it could forge the mark
Ingrid relies on.

`immutable()` gains `next.get('createdVia', null) == current.get('createdVia', null)`, which
carries the rest: an old node can never gain the field, a marked one can never lose it, and
neither can flip.

### `tests/rules/firestore.test.ts`

New cases, at minimum:

- a user reads and deletes their own `apiKeys` document; another user cannot read, list or
  delete it
- a user cannot create or update an `apiKeys` document, including one under their own uid
- nobody can read a `runs` document, including the key's owner
- a member reads `apiClients` for their home; a non-member cannot
- no client can write `apiClients`, member or owner
- a node create with `createdVia: 'app'` passes; `createdVia: 'api'` from a client is
  refused; a node with no `createdVia` still passes
- an update that changes `createdVia` is refused, in both directions, including adding it
  to a node that lacks it

### Function tests

`functions/src/validate.test.ts` covers the mirrored invariants against the same case list
as the rules tests: field bounds, `structure`, `inherits`, uniform visibility, status
within the parent's `columns`, and the private-node participant superset rule. These are
plain unit tests with no emulator; they are the only thing standing between a handler bug
and a silent orphan.

## UI flow

Three screens. None of them is on a path Ingrid walks daily.

### `AccountMenu` carries an Automations row

An Automations `Menu.Item` (`leadingIcon="robot-outline"`) above the `Divider`; sign out
stays last. The component was built "with room for more rows rather than a sign-out
drawer". This is the row it was left room for, and the divider is what keeps a destructive
action from sitting adjacent to a routine one.

### `app/(app)/automations.tsx`, the key list

Outside the tabs, like `/homes/[homeId]`, so it gets a back arrow rather than a tab.

- A short intro line saying what a key is for, then a Paper `List.Section` of keys:
  `List.Item` with the name as title, and `Last used {{when}}` / `Never used` as
  description, using `models/relative-time.ts`. `tail` renders after the name as `····3f9c`
  so four keys are distinguishable.
- Each row has a trailing icon button that opens a destructive `ConfirmDialog`.
- A *New API key* `Button` opens a create dialog: a `TextInput` for the name, whose
  action is disabled until the name is non-empty. The name is required *before* the secret
  is revealed, because a key named later is a key never named.
- On success, a second dialog shows the token once, with a copy button and a `Snackbar`
  confirmation. It says plainly that this is the only time it is shown. Dismissing it is
  the only way out; there is no "show again".
- Empty state: one line, no illustration, matching `/homes`.

**Offline.** Creating a key calls a function and revoking must reach the server, so both
are disabled with a hint when offline, the same pattern `home-and-members` uses for
creating a home and sending an invitation. Queuing a revoke optimistically would show a key
as gone while it kept working, which is a lie on the one screen where it matters.

The app-wide offline bar says something different here, and has to. Everywhere else it
promises *changes are saved and will sync when you reconnect*, which is true, because
Firestore serves the cache and queues the write. On this screen nothing queues, so the bar
would be contradicting the screen's own disabled button three centimetres below it, and
somebody who read only the bar would walk away believing a key they tried to create was
waiting to be sent. `OfflineBar` therefore keeps a list of online-only routes and says
*nothing on this screen can be saved until you reconnect* on them. Adding an online-only
screen means adding it to that list.

Styling per `CLAUDE.md`: Paper components first, `space` / `radius` / `size` tokens for
everything else, no numeric literals in style props, no colour literals. Destructive
colouring comes from `ConfirmDialog`'s `destructive` prop, which already owns it.

### `/homes/[homeId]` manage: automations with access

A read-only `List.Section` above the Danger zone: owner name, key name, relative last
use. Empty state is one line. No action of any kind on these rows. The key belongs to
another user, and the screen must not suggest otherwise.

### Node detail: the provenance line

When `createdVia === 'api'`, one `bodySmall` line in `onSurfaceVariant` beneath the title:
*Added by an automation*. Nothing on the card face, nothing on the board.

## Strings

New keys in `i18n/locales/en-US.json` and `sv-SE.json`, in the same change.

| Key | `en-US` | `sv-SE` |
| --- | --- | --- |
| `account.automations` | Automations | Automationer |
| `automations.title` | Automations | Automationer |
| `automations.intro` | An API key lets a program you run add and change work in your homes. | En API-nyckel låter ett program du kör lägga till och ändra arbete i dina hem. |
| `automations.empty` | Nothing is connected yet. | Inget är anslutet än. |
| `automations.create` | New API key | Ny API-nyckel |
| `automations.nameLabel` | What is it for? | Vad ska den användas till? |
| `automations.nameHint` | For example: research agent | Till exempel: researchagent |
| `automations.nameRequired` | Give it a name first. | Ge den ett namn först. |
| `automations.nameTooLong` | Names can be at most 60 characters. | Namn får vara högst 60 tecken. |
| `automations.lastUsed` | Last used {{when}} | Senast använd {{when}} |
| `automations.neverUsed` | Never used | Aldrig använd |
| `automations.secret.title` | Copy the key now | Kopiera nyckeln nu |
| `automations.secret.body` | This is the only time it is shown. If you lose it, revoke it and make a new one. | Det här är enda gången den visas. Om du tappar bort den, återkalla den och skapa en ny. |
| `automations.copy` | Copy | Kopiera |
| `automations.copied` | Copied | Kopierad |
| `automations.revoke.action` | Revoke | Återkalla |
| `automations.revoke.title` | Revoke {{name}}? | Återkalla {{name}}? |
| `automations.revoke.body` | The program using this key stops working immediately. | Programmet som använder nyckeln slutar fungera direkt. |
| `automations.offlineHint` | You need a connection to create or revoke a key. | Du behöver anslutning för att skapa eller återkalla en nyckel. |
| `manageHome.automations.title` | Automations with access | Automationer med åtkomst |
| `manageHome.automations.empty` | No automation has written here. | Ingen automation har skrivit här. |
| `detail.createdViaApi` | Added by an automation | Tillagd av en automation |
| `automations.createAction` | Create | Skapa |
| `automations.revoke.for` | Revoke {{name}} | Återkalla {{name}} |
| `common.done` | Done | Klar |
| `status.offlineNoQueue` | Offline — nothing on this screen can be saved until you reconnect. | Offline — inget på den här skärmen kan sparas förrän du är uppkopplad igen. |

The Swedish is written as Swedish, not transliterated: *återkalla*, never *revoka*. Ingrid
meets `account.automations` and possibly `manageHome.automations.title`; every English
loanword past that point is inside a screen she has no reason to open.

**API error messages are English only and are not translated.** They are read by agents and
by developers, never rendered in the app.

## What this does not change

- **`data/nodes.ts` and every client write path.** The app keeps writing through the rules,
  offline-first, exactly as `boards-and-nodes` describes.
- **The board's two-query merge.** Q1/Q2 and the client-side merge are untouched, as are
  the four node indexes.
- **`flipVisibility`.** It stays client-side, top-down and resumable. The API cannot flip.
- **Node read rules.** Nothing is widened; the API reads with the Admin SDK and applies the
  visibility predicate in code.
- **`recurring`.** No verbs, no rule changes, no schema changes. (`locations` left this
  list when [#50](https://github.com/Senth/home-backlog/issues/50) gave it verbs.)
- **Offline behaviour anywhere in the app.** The API is online-only by nature and the two
  new screens are the only places that say so.

## Out of scope

- **Recurring verbs.** [#57](https://github.com/Senth/home-backlog/issues/57),
  [#58](https://github.com/Senth/home-backlog/issues/58). The collection has no data
  model in use yet; the API gains its verbs with it. Location verbs shipped with
  [#50](https://github.com/Senth/home-backlog/issues/50).
- **Read-only versus read-write key scopes.**
  [#92](https://github.com/Senth/home-backlog/issues/92).
- **Season-neutral `SKILL.md` examples.**
  [#93](https://github.com/Senth/home-backlog/issues/93). Filed separately but applied
  while writing `SKILL.md` here: worked examples become an agent's prior for what home
  maintenance is, so nothing in it is gutters-before-the-frost.
- **An MCP wrapper.** A cheap later addition over the same API, per `PROJECT.md`.
- **Rate limiting.** Payload limits only: at most 500 nodes per bulk call, the Firestore
  commit cap regardless, and a request body size limit. Per-key rate limiting needs state
  shared across function instances, which is another Firestore write on every request, for
  a threat that is one person's own runaway script against their own free tier.
- **Creating a home, inviting, or accepting an invitation over the API.** Already recorded
  as human-only in `home-and-members`; a key cannot bootstrap the first home.
- **Custom statuses.** [#69](https://github.com/Senth/home-backlog/issues/69). The four
  are the vocabulary.
- **Webhooks, push, or any outbound notification.** Agents poll.
- **App Check on the API.** [#4](https://github.com/Senth/home-backlog/issues/4) is
  about the web client; a bearer key is the API's authentication.
