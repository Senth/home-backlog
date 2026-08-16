# Participants and private nodes — #61

## Handoff

*(wip only — the cleanup phase deletes this section and **Phases**.)*

This file is the implementation plan. Work the [Phases](#9-phases) in order, top to
bottom. Nothing durable may live only in **Handoff** or **Phases** — both are deleted.

Read first: [`CLAUDE.md`](../../../CLAUDE.md), [`docs/PROJECT.md`](../../PROJECT.md), and
[`docs/specs/boards-and-nodes.md`](../boards-and-nodes.md) — especially *Privacy is uniform
across a subtree*, *Queries*, *Rules*, and *Writes, and what each one may touch*. This
feature changes that area and nothing else;
[`home-and-members`](../home-and-members.md) is read-only background for the member roster.

Branch `feat/61-participants-and-private-nodes`. One commit per phase, once that phase is
green on `yarn lint --write`, `yarn typecheck` and `yarn test`.

**After the cleanup phase — and only then:**

```bash
GIT_VANILLA=1 gh pr create --fill --body "Closes #61"
GIT_VANILLA=1 gh pr checks --watch
GIT_VANILLA=1 gh pr merge --squash --delete-branch
```

Any check failing means stop, report, and **do not merge**.

Committing, opening the PR and merging are an explicit, user-authorized exception to the
global "never commit without being asked" rule. The exception is scoped to this flow and to
this branch. Nothing else may be committed or pushed without asking, and nothing is ever
pushed straight to `main` — that deploys to production.

---

## 1. What

A household can say **whose project a thing is**, **who is doing a particular card**, and
**that a project is nobody else's business** — and a board stops showing you everyone's
personal projects by default.

## 2. Why

Three questions get confused with each other, and the document only had a field for one of
them.

> "I want us to have a shared house, but I want to add my personal projects, that don't
> have to be private, to the list. However it does not make sense that my spouse sees them
> by default, but should still be able to see them."
>
> "It's also different from assigned to. Because if we work on a project together we can
> assign task to each other, but that would mean that we should see each other's task by
> default."

So there are three, and they are settled here as three:

| Question | Field | Scope | Read by a rule? |
| --- | --- | --- | --- |
| Whose project is this? | `participantIds` | root only | only when private |
| Who is doing this card? | `assigneeIds` | this node | never |
| Is this anyone else's business? | `visibility` | root only | yes |

### Participants and assignees are not the same list

`participantIds` was already on the document and already load-bearing — it is the ACL the
read rule consults for a private node, and it is what board query Q2 constrains. It could
not also become "who is doing this card" without either dragging assignment into the
security model or making "my tasks" return every card in every project you are involved in,
which in a two-person household is close to everything.

So **`assigneeIds` is a new field**, per node, inherited by nothing and read by no rule.
That split has a second payoff: an API key that may write `assigneeIds` cannot revoke
anybody's access, where one that may write `participantIds` can.

*Rejected:* one field for both. It is what the issue's own comments describe as the
confusion to be fixed, and it makes assignment a permission change.

*Rejected:* `participantIds` keeps meaning "my tasks", as
[`PROJECT.md`](../../PROJECT.md) §Household originally said. That line predates the split
and is corrected by this feature; `assigneeIds` is what
[#62](https://github.com/Senth/home-backlog/issues/62) reads.

### Participants only mean something because of the filter

On a **shared** node `participantIds` is read by no rule at all: the read grant is
`visibility == 'shared' || uid in participantIds`, and the first disjunct alone lets every
member in. Setting participants on a shared project therefore changes no permission, and it
cannot lock its own author out.

Which means that without something that *reads* it, the participants control is a control
with no observable effect — you set it, and nothing anywhere is different. So the
**default-hide filter moves into this feature** from
[#62](https://github.com/Senth/home-backlog/issues/62):

> A board hides a card whose `participantIds` is non-empty and does not contain me, unless
> *Show everyone's projects* is on.

That is the motivating sentence implemented literally — hidden by default, never denied,
always one toggle away. It costs no query, no index and no listener: the two board
listeners already merge client-side in `mergeNodeResults`, so this is a predicate over a
list the screen already holds.

#62 keeps *my tasks*, *unassigned* and *what is in progress anywhere*.

*Rejected:* shipping participants with no filter and waiting for #62. A field whose only
effect is to shorten the assignee list is a field nobody will understand the point of, and
the household would meet it before meeting the reason for it.

*Rejected:* enforcing the hiding in the rules. It is a display preference, not a
permission — "should still be able to see them" is the requirement, and a rule cannot
express "hidden but readable".

### Root-only, twice, for the same reason

`visibility` is root-only because the invariant demands it. `participantIds` is made
root-only to match: both answer a question about *a project*, not about a step inside one,
and a household that learns the rule once has learned it for both.

The practical gain is that neither ever needs a greyed-out inherited row on a descendant —
no dimmed control, no `aria-disabled` trap, nothing to explain about where a value came
from. A descendant instead carries **one sentence and the action that unblocks it**, in the
same place and the same shape for both.

*Rejected:* participants editable at every depth, inherited and greyed below. It needs the
ancestor named and linked on every card to not be a dead end, and — if the inherited value
were *stored* — editing participants on a thirty-card project becomes a second top-down
subtree cascade, with the same half-failure and offline problems as the visibility flip,
inside the same feature.

*Rejected:* participants per node with no inheritance at all. The filter predicate then
bites unpredictably on drill-down boards, hiding individual steps from people who can see
the project they are in.

### Assigning somebody means involving them

The assignee checkboxes offer the **effective participants** — the root's
`participantIds`, or every member of the home when that is empty, which is the common case
and has no friction at all.

Not a stylistic restriction. With the default-hide filter shipping here and *my tasks* not
shipping until #62, assigning Nadia to a step inside a project she is not a participant of
would hand her work that is **hidden from her board and reachable from nowhere**. Adding her
to the project is what makes the task findable. So the way to give somebody one step is to
put them in the project, and the hint under the assignee control says so and takes you
there.

The reverse — somebody assigned who has *since* been removed from the project — is a real
state and is deliberately **shown rather than hidden**, as a named sentence with a clear
action rather than a stray checked box. It is information, not a bug, and drawing it as an
orphaned checkbox is what would make it read as one.

### Private is not "mine alone"

`participantIds` on a private node *is* the access list, and the shipped rules already allow
it to hold several people. A private project is therefore **the people on it**, not one
person: two members planning something for a third in the same household have no other way
to express it, and `boards-and-nodes.md`'s own "Celebration as its own private project"
example assumes exactly that.

The one thing that cannot happen is a member writing themselves out: `allow update` requires
`visibleToMe(request.resource.data)`, so a private document whose participants do not
include the writer is denied on create and update alike. There is no lockout path to defend
against — only a bare permission error to avoid, by writing the actor in.

*Rejected:* private means one person, convert to shared to involve anyone. Simpler to say,
and it removes the only expression the surprise-planning case has.

### The flip is the dangerous part, and the danger is the half-finished one

Uniform visibility means every descendant physically carries the same `visibility` value —
board Q1 filters on it directly, so it cannot be derived. Making a project private is
therefore *n* writes, and they **cannot be one batch**: a rule's `get()` reads committed
state, so a child written to the new visibility while its parent still holds the old one
fails `inheritsFrom`. Top-down, one document at a time, in both directions.

A flip that fails partway is the failure that matters, and it is worse than it looks.
`subtreeOf()` today picks *one* query by the node's own visibility — so a project left
private with fourteen still-shared descendants is a project whose later deletion runs
`privateSubtreeQuery` and **never sees them**. They survive the delete with a dead
`parentId`, unreachable from every board and every breadcrumb: precisely the orphan the
whole invariant exists to prevent. It bites in both directions.

Two changes make it survivable:

1. **`subtreeOf()` unions both subtree queries** instead of choosing one. Each is
   individually provably safe, so the union is; it costs one extra one-shot server read on
   reparent, delete and flip. A mixed subtree then still deletes whole and still reparents
   whole, so an abandoned flip degrades — some cards keep the old visibility — but can never
   orphan.
2. **The flip is idempotent and resumable.** It reads the subtree from the server, writes in
   depth order, and skips any document already at the target, so retrying finishes the job
   rather than repeating it.

*Rejected:* a Cloud Function with the admin SDK. It bypasses rules, so all *n* writes go in
one atomic batch and no half-state exists — and `boards-and-nodes.md` rejected Cloud
Functions for node operations because they cannot run offline, which does not bind here
since the flip is online-only anyway. Rejected for what it costs instead: the project's
first Cloud Function, a deploy pipeline, and the uniform-visibility invariant no longer
enforced by the rules on the one path most likely to break it.

*Rejected:* a `flipPending` marker field so an interrupted flip can be found later. Another
field on every document, and the union above already removes the consequence that made
finding it urgent.

### Three controls that cannot mean anything in a one-member home

Ingrid is alone in her house and one of four people at the cabin. In the house, participants
(nobody to involve), assignees (only her) and privacy (nothing to hide from) are pure
clutter on the screen she uses to write down what the chimney sweep said, at 200% text.

So all three are **hidden while the home has one member**, and appear when a second joins.
The one exception: a node that is *already* private always shows the visibility control, so
a home that drops back to one member can still undo it rather than being stuck with a
setting it cannot reach.

### The card face has to carry the answer

"Is this mine, or is he asking me?" is answered on the detail screen, and the phone-only
member never opens the detail screen. So assignees are drawn on the **card face** as small
avatars when set, and a private card carries a `Hidden` mark beside its priority and effort
chips. Both only when set, the same rule the due chip already follows.

Neither costs a read: `memberProfiles` is already on `activeHome`.

## 3. Data & queries

### The new field

| Field | Type | Default | Notes |
| ----- | ---- | ------- | ----- |
| `assigneeIds` | `string[]` | `[]` | who is doing *this* node. No inheritance. Read by no rule. |

Added to `Node`, to `NodeData`, to `NewNodeInput` (optional), written by `newNodeData()` on
every create, and coerced by `toNode()` with `strings(data.assigneeIds)` so a document
predating it reads as `[]`.

**It needs no backfill**, and that is a real difference from `archived` rather than an
oversight. The absent-field trap bites a field a query must match *negatively*:
`where('archived', '==', false)` skips every document written before `archived` existed. An
`array-contains` clause matches neither an absent field nor an empty array — and a document
written before this feature has no assignees — so
[#62](https://github.com/Senth/home-backlog/issues/62)'s *my tasks* returns the same rows
either way. This exception is stated in the rules, not assumed.

### Where each field lives

| | `participantIds` | `assigneeIds` | `visibility` |
| --- | --- | --- | --- |
| set on | root (`parentId == null`) | any node | root |
| stored on descendants | `[]` when shared; the root's copy when private, which the rules require | its own | the root's value, on every one |
| inherited | by the rules, private only | never | by the rules, always |

`newNodeData()` already does exactly this and needs no change: a child of a private parent
starts with that parent's `participantIds`, a child of a shared parent starts with `[]`.

### Derived, in `models/node.ts`, unit-tested

```ts
rootIdOf(node)                 // node.ancestorIds[0] ?? node.id
effectiveParticipants(root)    // root.participantIds
assignableMembers(root, members)
  // root.participantIds.length > 0 ? those members : all members
staleAssignees(node, root)     // assigneeIds not in the assignable set
hiddenByParticipants(node, uid)
  // node.participantIds.length > 0 && !node.participantIds.includes(uid)
flipPlan(subtree, target)      // documents to write, in depth order, already-correct ones dropped
```

The root is fetched with `useAncestors(homeId, node.ancestorIds.slice(0, 1))` — the hook the
breadcrumbs already use, already memoized per session and per uid, so a detail screen adds
**no read** on a board it has already drawn. A node that is itself a root skips it entirely.

### The filter

Applied in the board screen over the merged list, never in a query:

```ts
nodes.filter((node) => showEveryone || !hiddenByParticipants(node, uid))
```

The predicate is uniform at every depth and *bites* only where participants exist, which is
roots. A shared descendant carries `[]` and is never hidden; a private descendant carries
the root's participants, which include me or I could not have read it.

The toggle is board-level UI state, defaulting to off, not persisted. A board always opens
in the hiding state, the same way it always opens on its first column.

### No query changes at all

All four shapes are unchanged, and every read stays **provably safe** rather than merely
rule-safe:

| Query | Constrains | Change |
| --- | --- | --- |
| board Q1 | `visibility == 'shared'` | none |
| board Q2 | `participantIds array-contains uid` | none |
| shared subtree | `visibility == 'shared'` | none |
| private subtree | `visibility == 'private'` + `participantIds array-contains uid` | none |

`subtreeOf()` changes *which* it calls, not what they are: both, unioned and deduped by id,
rather than one chosen by the node's own visibility. Each half is provably safe on its own,
so the union is.

### Indexes

No change to `firestore.indexes.json`. `assigneeIds` joins `participantIds` and `blockedBy`
as an automatically indexed array field — empty arrays generate no index entries, so it
costs nothing until somebody is assigned, and #62 filters on it alone.

## 4. Rules & tests

### `firestore.rules`

One change, in `validNode()`:

```
&& (!('assigneeIds' in data) || data.assigneeIds is list)
```

Present-only validation, and the reason is written beside it: requiring the field outright
would make `request.resource.data` — the full post-update document — lack it for every node
written before this feature, denying **every** update to them, including the `childCount`
bump that adding a step to an old project performs. There is no admin tooling in this repo
to unstick them, so it deadlocks. New documents always carry it; old ones gain it the first
time anything writes it.

`privacyUnchanged()` is deliberately **not** extended with `assigneeIds`. It is not privacy,
so an assignment stays a write that skips the parent `get()`.

Nothing else changes. Private roots with several participants, the lockout refusal, and the
top-down ordering constraint are all already enforced by the shipped rules — this feature is
the first caller that exercises them.

### `tests/rules/firestore.test.ts`

| Case | Expect |
| --- | --- |
| private root with two participants, read by each | allow |
| the same root read by a third member | deny |
| private node written with the writer absent from `participantIds` | deny, on create and on update |
| removing yourself from a private node's `participantIds` | deny |
| a child written to the new visibility while its parent still holds the old | deny |
| the same child written after its parent has committed | allow |
| update to a document with **no** `assigneeIds` field | allow |
| `assigneeIds` written as a non-list | deny |
| participants set on a *shared* node to a list excluding the writer | allow — shared grants the read, nobody is locked out |
| an assignment on a deep node, parent untouched | allow, and spends no parent `get()` |

### `models/node.test.ts`

`assignableMembers` with participants empty and set · `staleAssignees` including a member
who has left the home · `hiddenByParticipants` for empty, containing and excluding ·
`flipPlan` ordering by depth, both directions, and dropping already-correct documents so a
resume is idempotent.

## 5. UI flow

### The visibility control — root only

A `ChoiceField`-shaped two-choice control, matching priority and effort, so it never has to
say "only I" about a project two people share:

```
Who can see this project?
  ( Everyone in the home )  ( Only the people I choose )
```

Choosing *Only the people I choose* opens the confirm dialog. Choosing *Everyone in the
home* flips back the same way, with its own wording.

### The flip

1. **Offline the control is disabled with a hint**, the pattern `Move under…` and `Delete`
   already use. It is *n* sequential server-checked writes; queuing it optimistically would
   show a private project that is not private yet.
2. **Confirm**, naming the people and counting the work in words —
   `AppDialog`, the component the delete confirmation already uses.
3. **`flipVisibility(homeId, node, target, uid, onProgress)`** in `data/nodes.ts`:
   - reads the subtree from the **server** through the unioned `subtreeOf()`;
   - target participants are `[uid, ...node.participantIds]` deduped when going private, and
     `[]` on descendants when going shared — the root keeps its list, which becomes "whose
     project" again;
   - writes `flipPlan()` in depth order, `await`ing each, skipping documents already correct;
   - reports `{ done, total }` after each write and on failure.
   Each write changes `visibility`, so `privacyUnchanged()` is false and one parent `get()`
   is spent per document. These are single-document writes, not a batch, so the
   twenty-document-access budget does not apply.
4. **A modal progress dialog that cannot be dismissed while writing.** Letting somebody walk
   away mid-flip is how a mixed subtree gets abandoned.
5. **On failure** the dialog becomes the count and a *Try again*, which re-reads and
   finishes. Walking away leaves cards at the old visibility — degraded and honest, never
   orphaned, because of the unioned `subtreeOf()`.

### The detail screen, below the four existing fields

**On a root, in a home with two or more members:**

```
Who's in on this?          ← "Who can see this?" when private
  [x] Marcus   [ ] Nadia

Who's doing it?
  [x] Marcus

Who can see this project?
  ( Everyone in the home )  ( Only the people I choose )
```

**On a descendant:** no participants control and no visibility control — one sentence each
instead, and only when it has something to say.

```
Who's doing it?
  [x] Marcus
  Only people in Garage are shown.
  → Change who's in on Garage

  Only a whole project can be kept to yourself, not a step inside one.
  → Move Order tiles to the top level
```

The first line appears only when the root has participants set. *Change who's in on…*
navigates to the root's detail screen. *Move …to the top level* calls `reparentNode` to the
root board — the same call `Move under… › Top level` in `CardMenu` already makes.

A **stale assignee** is drawn under the checkboxes as a sentence with a clear action, never
as a checked box outside its own list. A member who has left the home entirely renders
through the existing `members.unknown` — *Someone*.

**In a one-member home** none of it renders, except that a node which is already private
still shows the visibility control.

Both people controls are built from `membersOf(activeHome)` — no listener, no read.

### The card face

`BoardCard` gains, both only when set:

- a row of small `PersonAvatar`s for `assigneeIds`, above the existing chip row;
- a `MetaChip` reading *Hidden* with an eye-off icon, beside priority, effort and due.

`MetaChip` stays the carrier for the mark: it is deliberately not a control, which is what
keeps a screen reader from announcing every private card as "dimmed".

### The board

A *Show everyone's projects* switch. It lives in the board's app-bar overflow rather than on
the board surface — it is rarely touched, and a board is already carrying a column strip.

### Offline

Every write here except the flip queues optimistically: participants, assignees and the
filter toggle all go through `updateNode` or local state. The flip alone requires a
connection, for the reason above.

## 6. Strings

New `t()` keys, in `i18n/locales/en-US.json` and `sv-SE.json` in the same change.

Question-shaped and plain, the precedent that produced *Att göra*, *Klart senast* and
*Tidsåtgång*. **Rejected:** *Deltagare* and *Tilldelad* — the first collides with the
existing *Medlemmar* for a different set of people in the same home, the second is
HR-register Swedish for what is meant to read as a question between two people who live
together. "Assigned to Nadia" is Nadia's stated quit line rendered as UI.

| Key | `en-US` | `sv-SE` |
| --- | --- | --- |
| `detail.participants` | Who's in on this? | Vilka är med? |
| `detail.participantsPrivate` | Who can see this? | Vilka ser det här? |
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
| `board.showEveryone` | Show everyone's projects | Visa allas projekt |
| `visibility.confirmPrivateTitle` | Keep this to yourself? | Hålla det här för dig själv? |
| `visibility.confirmPrivateBody` | Only you will be able to see {{title}} and its {{count}} steps. {{names}} will no longer see any of it. | Bara du kommer att se {{title}} och dess {{count}} steg. {{names}} kommer inte att se något av det. |
| `visibility.confirmSharedTitle` | Show this to everyone? | Visa det här för alla? |
| `visibility.confirmSharedBody` | Everyone in the home will be able to see {{title}} and its {{count}} steps. | Alla i hemmet kommer att kunna se {{title}} och dess {{count}} steg. |
| `visibility.confirmAction` | Change it | Ändra |
| `visibility.progress` | Moving {{done}} of {{total}} | Flyttar {{done}} av {{total}} |
| `visibility.failed` | {{done}} of {{total}} moved. Try again to finish. | {{done}} av {{total}} flyttade. Försök igen för att bli klar. |
| `visibility.retry` | Try again | Försök igen |
| `visibility.offlineHint` | Needs a connection | Behöver en anslutning |

`confirmPrivateBody` uses i18next plurals on `count` in both locales. `names` is a joined
list built with `Intl.ListFormat` where available, falling back to a comma join — the same
*tried, not feature-detected* discipline `models/due-date.ts` documents, since the whole
sentence sits inside a dialog.

`PROJECT.md` §Household is corrected in the cleanup phase: `participantIds` gives the
default-hide filter, and *my tasks* reads `assigneeIds`.

## 7. What this does NOT change

- **Any query shape, any index, any listener count.** The four queries are byte-identical;
  the filter is a client-side predicate over a list the screen already holds.
- **The uniform-visibility invariant**, or the product restriction that follows from it: a
  private card still cannot live inside a shared project.
- **`newNodeData()`'s inheritance.** It already gives a child of a private parent that
  parent's participants and a child of a shared parent none.
- **`privacyUnchanged()`**, so an ordinary edit still skips the parent `get()`.
- **`columns`, `rank`, `childCount`, `doneCount`**, or anything about board-ness.
- **The read rule.** `visibleToMe` is untouched; this feature is the first UI that exercises
  what it already permitted.

## 8. Out of scope

- **My tasks, unassigned, and what is in progress anywhere** —
  [#62](https://github.com/Senth/home-backlog/issues/62). Narrowed by this feature, which
  takes the default-hide half. *My tasks* reads `assigneeIds`; the owner's reading of it —
  assigned to me, plus unassigned work in a project I participate in — is #62's starting
  point, not settled here. *Unassigned* stays client-side either way: Firestore cannot query
  for an empty array.
- **A search-and-add member picker above four members** —
  [#88](https://github.com/Senth/home-backlog/issues/88). Checkboxes serve every household
  that exists today.
- **What happens to a removed member's private nodes** —
  [#39](https://github.com/Senth/home-backlog/issues/39). `members.removeBody` already warns
  about it and this feature does not change the cascade.
- **Which of the two people-fields an API key may write** —
  [#7](https://github.com/Senth/home-backlog/issues/7). `participantIds` is an ACL on a
  private node, so a key that writes it can revoke a member's read; `assigneeIds` is read by
  no rule and is harmless. `SKILL.md` says so when it is written, along with the top-down
  ordering constraint the flip obeys — a bulk writer that ignores it gets a bare permission
  error with nothing to say why.
- **Notifying somebody that they have been assigned.** Nothing in the app notifies yet, and
  Nadia's notifications are off. The card face is the notification.
- **A private card inside a shared project.** Rejected in
  [`boards-and-nodes.md`](../boards-and-nodes.md): no field-level read rules, one
  `array-contains` per query, and a hidden child makes every count derived from children
  diverge per viewer.
- **Persisting the *Show everyone's projects* toggle.** A board always opens in the hiding
  state, the same way it always opens on its first column.

## 9. Phases

*(wip only — deleted by cleanup.)*

Each ends green on `yarn lint --write`, `yarn typecheck` and `yarn test`.

**Phase 1 — models, rules, rule tests.**
`assigneeIds` on `Node` / `NodeData` / `NewNodeInput` / `newNodeData` / `toNode`. The six
derived functions in `models/node.ts` with unit tests. The one `validNode()` clause, with
its reason written beside it. Every `tests/rules/` case in the table above.

**Phase 2 — the data layer.**
`subtreeOf()` unions both subtree queries and dedupes. `flipVisibility()` with server read,
depth-ordered sequential writes, idempotent resume and a progress callback. `NodeChanges`
gains `assigneeIds` (it already permits `participantIds`). Unit tests for `flipPlan`
ordering and the skip predicate.

**Phase 3 — the detail-screen controls.**
Participants and assignees, both from `membersOf(activeHome)`. Root-only rendering, the
`useAncestors` root lookup, the narrowed-list hint, the stale-assignee row, the non-root
privacy sentence with its move action. All strings in both locales.

**Phase 4 — the visibility control and the flip UI.**
The two-choice control, the confirm dialog with names and counts, the non-dismissible
progress dialog, the failure state with *Try again*, and the offline disable. Strings.

**Phase 5 — the board.**
Assignee avatars and the *Hidden* chip on `BoardCard`. The default-hide filter and the
*Show everyone's projects* toggle in the board app bar. Strings.

**Phase 6 — solo homes and the fixture.**
Hide all three controls while the home has one member, with the already-private exception.
Refresh `.emulator-seed/` **through the app** and `yarn emulators:export`: a shared project
with participants set, a private project with two participants, an assigned card, and a
stale assignee — so every future review sees all four.

**Phase 7 — `/review` until PASS.**
`code-review` first, its fixes applied and green, then `browser-review` against the clean
change, then the fix loop, capped at two rounds. Smoke-test the primary path before opening
a browser agent. `blocking` findings are never deferrable; a `should-fix` may be deferred
only with a stated reason. The session that wrote the code does not sign it off.

**Phase 8 — cleanup, then the PR.**
Fold this file into [`boards-and-nodes.md`](../boards-and-nodes.md) by **rewriting** the
affected sections — *Privacy is uniform across a subtree*, *Queries*, *Rules*, *Writes*,
*The board*, *Node detail*, *Out of scope* — never appending a chapter. Keep every *why* and
every rejected alternative above. Correct `PROJECT.md` §Household. Update the
`boards-and-nodes` row in [`INDEX.md`](../INDEX.md). Delete this file. Then commit, open the
PR and merge as the Handoff says.
