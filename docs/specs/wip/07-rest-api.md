# REST API, API keys and SKILL.md

# Handoff

**This file is the implementation plan.** Work the [Phases](#9-phases) section in order,
top to bottom.

Read first, in this order: [`CLAUDE.md`](../../../CLAUDE.md),
[`docs/PROJECT.md`](../../PROJECT.md) — especially *AI / API* and *Household,
participants & privacy* — then [`boards-and-nodes`](../boards-and-nodes.md) and
[`home-and-members`](../home-and-members.md). This spec assumes all four and does not
repeat them.

Nothing durable may live only in **Handoff** or **Phases**: the cleanup phase deletes both
sections and folds the rest into `docs/specs/`. If you decide something during
implementation that a future reader needs, write it into sections 1–8, not here.

Branch `feat/7-rest-api`. One commit per phase, once that phase is green on
`yarn lint --write`, `yarn typecheck` and `yarn test`.

**After the cleanup phase** — and only then:

```bash
GIT_VANILLA=1 gh pr create --fill --body "Closes #7"
GIT_VANILLA=1 gh pr checks --watch
GIT_VANILLA=1 gh pr merge --squash --delete-branch
```

Any check failing means stop, report, and **do not merge**.

Committing, opening the PR and merging are an explicit, user-authorized exception to the
global "never commit without being asked" rule. The exception is scoped to this flow and to
this branch. Nothing is ever pushed straight to `main` — that deploys to production.

---

## 1. What

A REST API on Cloud Functions at `https://<app origin>/api/v1`, authenticated by per-user
API keys, carrying the node verbs and a served `SKILL.md`, so a household member's own AI
agent can populate and drive a board without touching the UI.

## 2. Why

`PROJECT.md` puts the API in MVP and calls it a first-class surface: the app deliberately
contains **no LLM**, and instead inverts the usual design — research and task breakdown
happen in the user's own agent, which writes the results in. That removes per-user
inference cost and any liability for generated advice about wiring or gas. An API that
arrives late would mean the app grows a shape agents cannot express.

### Keys are per user, not per home

The issue body and `PROJECT.md` both said "scoped to a home". That is wrong and is
corrected by this feature.

A person is in several homes — the house, the cabin, a parent's place. Per-home keys mean
one credential per home, an agent reconfigured every time a home is added, and a key that
silently stops covering work when a project moves. A key is therefore **the user**: it
reaches every home its owner is a member of, and gains access to a new home the moment
they join one.

*The cost is real and is paid deliberately:* Marcus is a member of Ingrid's cabin, so
Marcus's agent can write into the cabin, and Ingrid — who will never own a key — has no
way to revoke it. Two things answer that, and neither is optional: every node an agent
writes is **marked**, and every home lists the **automations that have written into it**.
Ingrid cannot revoke Marcus's key, but she can see it exists, see which of her cards it
wrote, and ask him. That is the same shape as membership itself, which she also cannot
unilaterally undo.

*Rejected:* per-home keys. See above.
*Rejected:* a key that must be granted per home by that home's owner. It makes the common
case — one person, their own homes, their own agent — a multi-step permission dance, to
guard against a person the household already trusts with full membership.

Read-only versus read-write scopes are [#92](https://github.com/Senth/home-backlog/issues/92).

### The function writes with the Admin SDK, and mirrors every invariant in TypeScript

The alternative was for the function to *impersonate* the user — mint a custom token,
exchange it for an ID token, and talk to the Firestore REST API so that `firestore.rules`
applies verbatim. That was rejected, for one decisive reason: **a bulk subtree create then
cannot be atomic.** A rule's `get()` reads committed state, so a child written before its
parent commits fails `inheritsFrom` — which is exactly why `flipVisibility` writes
top-down, one document at a time. Over a network, top-down means a timeout mid-flight
leaves half a tree, and half a tree is not untidy but *corrupt*: a child whose parent is
missing carries `ancestorIds` pointing at nothing, is unreachable from every board and
every breadcrumb, and is the silent-orphan failure that `boards-and-nodes` is built around
preventing.

The Admin SDK bypasses rules, so a whole subtree commits in **one atomic batch** — up to
the 500-document commit cap, and with no 20-document-access budget, because that budget is
a rules limit and no rules are evaluated.

What that costs is that the invariants are no longer enforced on this path by the rules
that state them. So they are **re-implemented in `functions/src/validate.ts`** — the field
set and its bounds, `structure`, `inherits`, the uniform-visibility invariant, the
`status`-within-`columns` rule, and membership — with unit tests covering the same cases as
`tests/rules/firestore.test.ts`. Two implementations of one truth can drift; that risk is
accepted and mitigated by the tests being written from the same list.

*Rejected:* Admin SDK with no mirrored validation. The rules still guard every client path,
so it would work until one handler wrote a private child under a shared parent — and then
fail silently and permanently.

Note that `boards-and-nodes` rejected a Cloud Function for the visibility flip partly
because it would be "the project's first Cloud Function, a deploy pipeline". This feature
*is* that first function and brings that pipeline, so that half of the objection is spent.
The other half — the invariant no longer enforced by rules on the path most likely to break
it — stands, and the flip stays a client-side operation. See
[§7](#7-what-this-does-not-change).

### The function is its own ESM package, and shares no code with the app

`functions/` is a plain sibling npm package, not a yarn workspace — the root is an Expo app
whose Metro config, `@/` alias and jest preset all assume they own the tree. Two
consequences are worth stating, because both were arrived at the expensive way:

**It is ESM.** `fractional-indexing` — the library that generates `rank` — ships as ESM
only, and a CommonJS function cannot `require` it at all. Re-implementing it was rejected:
`generateKeyBetween` *validates* the key it is given, so a hand-rolled rank of the wrong
shape does not sort badly, it makes the **client's** next reorder throw. The price of ESM
is the `.js` extension on every relative import, and one trap: an ES module's imports are
evaluated before its own body, so `setGlobalOptions` in `index.ts` runs *after* every
re-exported function is already defined and they deploy to `us-central1`. Every function
therefore names `region` explicitly. It fails as a working deployment in the wrong place
rather than as an error, which is why it is written down.

**Nothing is compiled across the boundary.** Sharing `models/api-key.ts` was tried: under a
hybrid module kind TypeScript picks a file's format from the nearest `package.json`, and the
repo root's has no `"type"`, so a shared file emits as CommonJS into an ESM package and Node
cannot named-import it. The seam turned out to be real anyway — the app never parses,
formats or hashes a token. It is handed the finished string once by `createApiKey`, shows
it, and forgets it; the `tail` it renders afterwards is stored. So the token format lives
wholly in `functions/src/api-key.ts`, next to the only code that verifies it, and
`models/api-key.ts` keeps the one rule a *screen* enforces: a key is named before its secret
is revealed. `maxKeyNameLength` is stated on both sides, which is a duplicated bound rather
than a duplicated implementation.

The mirrored *node* vocabulary in `functions/src/node.ts` is a different matter and is a
deliberate copy — see below.

### Validate everything, then commit atomically

A bulk request is validated in full before anything is written. Validation is pure
TypeScript with no I/O, so it is separable from the write:

```
validate all N nodes  →  any failures?  400, per-index errors, nothing written
                      →  all valid?     one atomic batch, all or nothing
```

The caller gets precise per-index errors it can fix and resend, and a half-written tree
never exists.

*Rejected:* partial success — writing what validates and reporting failed indexes. It only
helps if failures are unpredictable at validation time, and they are not: a too-long title,
an unknown status, a `parentRef` that is in neither the payload nor the database are all
decidable before writing. What it buys instead is the orphan.

After validation the only remaining failure is the commit itself, which fails whole and
writes nothing.

### The server assigns node ids; the payload uses local refs

Nodes in a bulk payload reference each other by a caller-chosen `ref` string, valid only
within the request. The response returns a `ref` → id map.

*Rejected:* caller-supplied document ids. It gives a beautiful replay story — repeat the
request, the ids already exist, return them — but agents generate `"1"`, `"2"`, `"3"`.
Those collide with the next run in the same home; they make the replay test ("all ids
already exist") misfire, since "all exist" then means "someone else used them"; monotonic
ids concentrate writes into one Firestore index range; and some strings are not legal
document ids at all. Enforcing an auto-id shape (`^[A-Za-z0-9_-]{20}$`) would have fixed
all four, at the price of a rule every agent author has to satisfy before writing anything.
Server ids move that burden to the server, where it belongs.

Replay protection is therefore explicit: an optional **`Idempotency-Key`** header, recorded
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
confirmation each — for a single mistaken run.

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
`assigneeIds` is deliberately unrestricted — `boards-and-nodes` already notes that keeping
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
more thing for every agent author to get right, for a case the `409` already surfaces.

### Location fields are refused, not ignored

`locationId` and `locationAncestorIds` in a request body return `400
locations_unavailable`. The `locations` collection has no verbs and, today, no screens
([#50](https://github.com/Senth/home-backlog/issues/50),
[#51](https://github.com/Senth/home-backlog/issues/51)), so nothing can hand an agent a
valid location id — and `locationAncestorIds` is a denormalized path that is unverifiable
from outside. An invented one makes "everything in the Basement" return the wrong set
permanently, with no screen anywhere showing a discrepancy.

*Rejected:* accepting and silently ignoring them. The agent then believes it filed work it
did not file.

`SKILL.md` states that agent-created work is unfiled until the location verbs ship.

### A status outside the parent's frozen columns is refused

`400 status_not_in_columns`, naming the allowed set. The column set is frozen by depth at
creation, and a card in a column the board does not show has a **one-way exit**: the move
sheet only offers frozen destinations, so it can be moved out of an appended column and
never back. The rules permit any of the seven statuses because
[#63](https://github.com/Senth/home-backlog/issues/63) will edit column sets; the API is
stricter than the rules on purpose, because an agent has no eyes on the board it is
writing to.

### An agent-written node says so

Nodes gain `createdVia: 'app' | 'api'`, written at creation and immutable. The **node
detail screen** carries one plain line for `'api'`; the card face carries nothing.

Marcus curates everything and needs to know which of forty cards a machine wrote. Ingrid
needs to understand eleven cabin cards that appeared at 03:00 without meeting the word
"API". One line in her own register — *Tillagd av en automation* — does both.

*Rejected:* a chip on the card face. It marks every card on the boards that are already
fullest, which is the clutter `PROJECT.md`'s overwhelm principle exists to prevent.

### Homes list the automations that have written into them

`homes/{homeId}/apiClients/{keyId}` is upserted by the function the first time a key
touches that home, and read-only for every member. The manage screen shows *"Marcus ·
research agent · 3 h ago"*.

It is derived from writes rather than from grants, because there are no grants: a key
reaches every home its owner is in, so "who could write here" is just "every member". What
a household actually wants to know is what **has** written here.

Revoking a key deletes those rows through an `onDocumentDeleted` trigger. A row for a key
that no longer exists is worse than no row: it tells Ingrid something has access when
nothing does.

### `SKILL.md` is served by the deployment

`GET /api/v1/skill.md` returns the shipped contract as `text/markdown`, and every response
carries `X-Api-Version`. An agent fetches the contract it is actually talking to instead of
a copy vendored months ago, and can detect drift from the header alone.

The field table in it marks every field **shown in the app** or **stored, no screen yet** —
`checklist` ([#52](https://github.com/Senth/home-backlog/issues/52)) and `blockedBy`
([#66](https://github.com/Senth/home-backlog/issues/66)) accept writes today and render
nowhere, and an agent that populates them deserves to know that before it does.

## 3. Data & queries

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

The token is **`hb_<uid>.<keyId>.<secret>`**, where `<secret>` is 32 random bytes
base64url-encoded. The `hb_` prefix is what secret scanners key on. Separators are dots
because base64url's alphabet includes `_` and `-` but never `.`, and a Firebase uid is
alphanumeric — so the three parts split unambiguously.

Carrying the uid is what makes verification a **direct `get()`** on
`users/{uid}/apiKeys/{keyId}` — one document read, no query, no index, and no
collection-group lookup on a hot path. A uid is not a secret: it is already visible to
every member of a shared home through `participantIds` and `memberProfiles`. Knowing one
grants nothing without the secret, which is compared against `secretHash` in constant time.

SHA-256 is sufficient here and bcrypt is not needed: the secret is 256 bits of server-side
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

### `homes/{homeId}/nodes/{nodeId}` gains one field

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `createdVia` | `'app' \| 'api'` | `'app'` | written at creation, immutable |

**No backfill, and that is not an oversight.** The absent-field trap in `boards-and-nodes`
bites a field a query must match *negatively*; `createdVia` is never queried, only read
with the document it sits on and displayed — the same argument that let `columns` arrive
late. `toNode` reads an absent value as `'app'`, which is true of every node written before
this feature.

### Queries

**The app** fires two new ones, both trivially safe:

| Screen | Query | Why it is safe |
| --- | --- | --- |
| Automations | `users/{me}/apiKeys` ordered by `createdAt` | path-scoped to my own uid; no document another user owns can match |
| `/homes/[homeId]` manage | `homes/{homeId}/apiClients` ordered by `lastUsedAt` desc | every document in the collection is readable by every member, so no matching document can be denied |

**The function** runs under the Admin SDK, so query safety does not constrain it — but its
queries mirror the client's so that behaviour matches:

- `GET /v1/homes` → `homes` where `members.<uid> in ['owner','member']`, exactly
  `myHomesQuery` in `data/homes.ts`.
- `GET /v1/homes/{h}/nodes?parentId=` → `nodes` where `archived == false && parentId == X`
  ordered by `rank`, **then filtered in code** to what the key's owner may see
  (`visibility == 'shared' || uid in participantIds`). The client has to split this into
  two queries because Firestore denies whole queries; the function does not, and must
  therefore apply the predicate itself. Getting this wrong leaks another member's private
  project through the API — it is the first thing to test.

### Indexes

`firestore.indexes.json` gains:

- `fieldOverrides` disabling indexing for `nodes.createdVia`, and for `apiKeys.name`,
  `apiKeys.secretHash`, `apiKeys.tail` — none is ever queried, and index entries are where
  storage cost lives.
- a collection-group single-field index on `apiClients.keyId`, for the delete trigger. It
  is the only index this feature adds — token verification is a direct `get()`.

## 4. Rules & tests

### `firestore.rules`

```
match /users/{uid} {
  match /apiKeys/{keyId} {
    // Minted by the callable function, which uses the Admin SDK and is not
    // subject to these rules. A client may see its own keys and revoke them,
    // and may never write one — a client-written key would let a member forge
    // a hash they know the secret for.
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

`validNode` gains one clause, and its shape matters:

```
&& (!('createdVia' in data) || data.createdVia == 'app')
```

**Present-only, and `'app'`-only.** Present-only for the same reason as `assigneeIds`:
`request.resource.data` is the full post-update document, so requiring the field outright
would deny *every* update to every node written before this feature — including the
`childCount` bump that adding a step to an old project performs — and there is no admin
tooling in this repo to unstick them. `'app'`-only because the function bypasses rules, so
`'api'` never needs to pass through here, and a member who could write it would be able to
forge the mark that Ingrid relies on.

`immutable()` gains `next.get('createdVia', null) == current.get('createdVia', null)`, so
an old node can never gain the field and a new one can never change it.

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
as the rules tests — field bounds, `structure`, `inherits`, uniform visibility, status
within the parent's `columns`, and the private-node participant superset rule. These are
plain unit tests with no emulator; they are the only thing standing between a handler bug
and a silent orphan.

## 5. UI flow

Three surfaces change. None of them is on a path Ingrid walks daily.

### `AccountMenu` gains a row

An **Automations** `Menu.Item` (`leadingIcon="robot-outline"`) above the existing
`Divider`; sign out stays last. The component was built "with room for more rows rather
than a sign-out drawer" — this is the row it was left room for, and the divider is what
keeps a destructive action from sitting adjacent to a routine one.

### `app/(app)/automations.tsx` — the key list

Outside the tabs, like `/homes/[homeId]`, so it gets a back arrow rather than a tab.

- A short intro line saying what a key is for, then a Paper `List.Section` of keys:
  `List.Item` with the name as title, and `Last used {{when}}` / `Never used` as
  description, using `models/relative-time.ts`. `tail` renders after the name as `····3f9c`
  so four keys are distinguishable.
- Each row has a trailing icon button that opens a destructive `ConfirmDialog`.
- A **New API key** `Button` opens a create dialog: a `TextInput` for the name, whose
  action is disabled until the name is non-empty. The name is required *before* the secret
  is revealed, because a key named later is a key never named.
- On success, a second dialog shows the token once, with a copy button and a `Snackbar`
  confirmation. It says plainly that this is the only time it is shown. Dismissing it is
  the only way out — there is no "show again".
- Empty state: one line, no illustration, matching `/homes`.

**Offline:** creating a key calls a function and revoking must reach the server, so both
are disabled with a hint when offline — the same pattern `home-and-members` uses for
creating a home and sending an invitation. Queuing a revoke optimistically would show a key
as gone while it kept working, which is a lie on the one screen where it matters.

Styling per `CLAUDE.md`: Paper components first, `space` / `radius` / `size` tokens for
everything else, no numeric literals in style props, no colour literals — destructive
colouring comes from `ConfirmDialog`'s `destructive` prop, which already owns it.

### `/homes/[homeId]` manage — automations with access

A read-only `List.Section` **above** the Danger zone: owner name, key name, relative last
use. Empty state is one line. No action of any kind on these rows — the key belongs to
another user, and the screen must not suggest otherwise.

### Node detail — the provenance line

When `createdVia === 'api'`, one `bodySmall` line in `onSurfaceVariant` beneath the title:
*Added by an automation*. Nothing on the card face, nothing on the board.

## 6. Strings

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

The Swedish is written as Swedish, not transliterated: *återkalla*, never *revoka*. Ingrid
meets `account.automations` and possibly `manageHome.automations.title`; every English
loanword past that point is inside a screen she has no reason to open.

**API error messages are English only and are not translated.** They are read by agents and
by developers, never rendered in the app.

## 7. What this does NOT change

- **`data/nodes.ts` and every client write path.** The app keeps writing through the rules,
  offline-first, exactly as `boards-and-nodes` describes.
- **The board's two-query merge.** Q1/Q2 and the client-side merge are untouched, as are
  the four node indexes.
- **`flipVisibility`.** It stays client-side, top-down and resumable. The API cannot flip.
- **Node read rules.** Nothing is widened; the API reads with the Admin SDK and applies the
  visibility predicate in code.
- **`locations` and `recurring`.** No verbs, no rule changes, no schema changes.
- **Offline behaviour anywhere in the app.** The API is online-only by nature and the two
  new screens are the only places that say so.

## 8. Out of scope

- **Location and recurring verbs** — [#50](https://github.com/Senth/home-backlog/issues/50),
  [#51](https://github.com/Senth/home-backlog/issues/51),
  [#57](https://github.com/Senth/home-backlog/issues/57),
  [#58](https://github.com/Senth/home-backlog/issues/58). Those collections have no data
  model in use yet; the API gains their verbs with them.
- **Read-only versus read-write key scopes** —
  [#92](https://github.com/Senth/home-backlog/issues/92).
- **Season-neutral `SKILL.md` examples** —
  [#93](https://github.com/Senth/home-backlog/issues/93). Filed separately but **applied
  while writing `SKILL.md` here**: worked examples become an agent's prior for what home
  maintenance is, so nothing in it is gutters-before-the-frost.
- **An MCP wrapper.** A cheap later addition over this same surface, per `PROJECT.md`.
- **Rate limiting.** Payload limits only: at most 500 nodes per bulk call — the Firestore
  commit cap regardless — and a request body size limit. Per-key rate limiting needs state
  shared across function instances, which is another Firestore write on every request, for
  a threat that is one person's own runaway script against their own free tier.
- **Creating a home, inviting, or accepting an invitation over the API.** Already recorded
  as human-only in `home-and-members`; a key cannot bootstrap the first home.
- **Custom statuses.** [#69](https://github.com/Senth/home-backlog/issues/69). The seven
  are the vocabulary.
- **Webhooks, push, or any outbound notification.** Agents poll.
- **App Check on the API surface.** [#4](https://github.com/Senth/home-backlog/issues/4) is
  about the web client; a bearer key is the API's authentication.

## 9. Phases

Each ends green on `yarn lint --write`, `yarn typecheck` and `yarn test`, and is one
commit.

**Phase 1 — Cloud Functions bootstrap.**
`functions/` as its own TypeScript package (its own `package.json`, `tsconfig.json`,
`node_modules`; the root is yarn, so keep it a plain sibling package rather than fighting a
workspace into an Expo app). Firebase Functions v2, region `europe-west1` — the same region
as the Firestore database. `firebase.json`: a `functions` block, a `/api/**` rewrite
**before** the `**` catch-all, and a functions emulator port beside the existing four.
`GET /api/v1/health` returning the version. Add `functions` to the deploy target in
`.github/workflows/deploy.yml`, and record in `OPERATIONS.md` the IAM roles the deploy
service account needs for functions and the Firestore TTL policy on `apiKeys/*/runs`.

**Phase 2 — API keys.**
`models/api-key.ts` (token format, parsing, hashing — with unit tests), the callable
`createApiKey`, the `onDocumentDeleted` cleanup trigger, the `users/{uid}/apiKeys` and
`homes/{homeId}/apiClients` rules, and the `tests/rules/` cases for both.

**Phase 3 — Validation and authentication middleware.**
`functions/src/validate.ts` mirroring the rules, with its unit tests. Key verification:
resolve the token, compare the hash in constant time, load membership, throttle
`lastUsedAt`, upsert `apiClients`. Error envelope and status codes.

**Phase 4 — Read verbs.**
`GET /v1/homes`, `GET /v1/homes/{h}/nodes`, `GET /v1/homes/{h}/nodes/{id}`, with the
visibility predicate applied in code and a test that a member's private project is invisible
to another member's key.

**Phase 5 — Write verbs.**
`POST`, `PATCH` (field merge, optional version precondition, `status` recomputing `rank`,
`parentId` rewriting the subtree and both parents' counters), `DELETE` with the
`?cascade=true` guard. The `createdVia` field: model, `toNode`, rules clause, index
override, rules tests.

**Phase 6 — Bulk subtree create.**
`POST /v1/homes/{h}/nodes:bulk` — ref resolution, whole-payload validation with per-index
errors, one atomic batch, `rankSequence` in array order per column, counters computed by
the endpoint and refused in the body, and the `Idempotency-Key` replay through
`apiKeys/{keyId}/runs`.

**Phase 7 — The screens.**
`app/(app)/automations.tsx`, the `AccountMenu` row, the automations section on
`/homes/[homeId]`, the provenance line on node detail, and every string in both locales.

**Phase 8 — Review.**
`/review` until PASS. `code-review` first, its fixes applied and green, then
`browser-review` against the clean change, then the fix loop, capped at two rounds. The
skill smoke-tests the primary path itself before opening a browser agent. `blocking`
findings are never deferrable; a `should-fix` may be deferred only with a stated reason.
`idea` findings go to the user, who decides which become issues. This feature has
user-visible surface, so the browser pass is not optional.

**Phase 9 — Cleanup.**

- Write `SKILL.md` and serve it from `GET /api/v1/skill.md` with `X-Api-Version` on every
  response, including the field table marking each field *shown in the app* or *stored, no
  screen yet*, and applying [#93](https://github.com/Senth/home-backlog/issues/93).
- **Create the area spec `docs/specs/rest-api.md`** from sections 1–8 of this file. This is
  a genuinely new area with its own data model and screens, so it is a new file rather than
  a rewrite of an existing one. Cross-link it from `boards-and-nodes` (the `createdVia`
  field and the API's stricter status rule) and from `home-and-members` (the automations
  list on the manage screen), and rewrite the affected passages there rather than appending.
- **Correct `docs/PROJECT.md`**: the *AI / API* section says "hashed API keys scoped to a
  home" and must say per user, with the reasoning from [§2](#2-why).
- Add the row to `docs/specs/INDEX.md` and remove `rest-api` from its *Planned areas* list.
- Delete `docs/specs/wip/07-rest-api.md`.
- **Refresh `.emulator-seed/`** through the app: at least one API key, one `apiClients` row,
  and one node created over the API so the provenance line and both new lists have
  something to show. Generated with `yarn emulators:export`, never hand-written.
- `yarn todo`, then the PR commands in [Handoff](#handoff).
