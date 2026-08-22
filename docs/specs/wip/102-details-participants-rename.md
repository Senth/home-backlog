# Details page: content pass, participants that mean what they say, and inline rename

Issue [#102](https://github.com/Senth/home-backlog/issues/102).
Area specs this folds into: [`boards-and-nodes.md`](../boards-and-nodes.md),
[`home-and-members.md`](../home-and-members.md), [`rest-api.md`](../rest-api.md).

## Handoff

- This file is the implementation plan. `/implement` works the **Phases** in order.
- Read `CLAUDE.md` and the three area specs cross-linked above first.
- Nothing durable may live only in **Handoff**, **Acceptance** or **Phases** — `/ship`
  deletes all three and folds the rest into the area specs.
- After the last phase: `/review` in a fresh session, then `/ship` on a PASS.
- **The migration in Phase 1 runs against production before this merges.** Pushing to
  `main` deploys, and Phase 1 narrows `firestore.rules`. See
  [`OPERATIONS.md` § One-off migrations](../../OPERATIONS.md#one-off-migrations).

## 1. What

A shared project is born with the whole household on it, so the participant checkboxes
say something true; the detail screen stops explaining itself in four grey sentences and
offers one disclosure instead; a step's detail screen loses the promote-to-project action;
and the card you are reading, or standing inside as a board, can finally be renamed.

## 2. Why

### Participants: stored, not implied

`participantIds: []` means "everyone in the home" today. Nothing on screen says so, so a
household member opens a project, sees their own name unticked under *Who's in on this?*,
and concludes the project is not theirs — the single most-reported confusion on this
screen. The list is drawn from the same data whether it means *everyone* or *these two*.

Storing the real list makes the display honest with no fiction: you are ticked because you
are in on it. It also makes a question answerable that the implicit form cannot express —
**what happens when somebody new joins.** With `[]`, a new member is silently in on every
project that predates them, with no way to have joined a household without joining all of
its work. With a stored list, that becomes a decision the inviter makes, once, with the
consequence in front of them.

**Rejected: drawing an empty list as all-ticked.** The cheap version of the same fix. It
puts a lie on screen — the first untick then has to write *everyone except this person*,
inverting `PeopleField.toggle` for one case, and the row's `aria-checked` says a thing the
stored document does not. It also leaves the new-member question unanswered, which is the
half of the problem that has no other fix.

**Rejected: materialising every node, not just roots.** Participants are a question about a
*project*, which `boards-and-nodes.md` § "Three questions about people, three fields"
settles: a stored inherited value turns every participant edit into a top-down cascade over
the subtree, the same *n*-write machinery as a visibility flip, and would make
`hiddenByParticipants` start biting on individual steps. Shared descendants keep `[]`.

**Rejected: leaving `[]` as a legacy value.** Two regimes reading the same field, forever:
old roots meaning *everyone including future members*, new ones meaning *exactly these*. One
backfill removes the branch instead of enshrining it.

### The four removals

Every one of these renders on a screen somebody opens to write down what the chimney sweep
said, at 200 % text, one-handed:

- **"Move *[title]* to the top level"** restructures the family board from a screen you land
  on by accident. `CardMenu › Move under… › Top level` is the same call from a place where
  the destinations are visible, and it stays.
- **"Only a whole project can be kept to yourself, not a step inside one."** explains an
  absence. The disclosure explains it once, where somebody is looking for an explanation.
- **"Only people in *[project]* are shown."** is redundant with a list that is visibly
  shorter than the household.
- **"Who's doing it?"** with one person to pick from is not a choice.

The last one is the only removal that takes a *control* with it, and
`components/node/PeopleSection.tsx:186` is the sole place in the app that writes
`assigneeIds` — the REST API is the only other writer anywhere. So it hides only when
nobody is on the card: the moment anyone is assigned, including a stale assignee dropped
from the project after the fact, the control returns and they can be taken off.
`docs/PROJECT.md:126` makes *unassigned* the state that feeds the planned "my tasks"
filter, so an empty assignee list is never drawn as anything but empty.

### The disclosure

Named after what is inside it — *Who can see what?* — because the person who needs it is
the person who was confused, and a label that asks about their intentions ("Looking for
something else?") gives them no reason to open it. In Swedish that phrasing reads as a
shop's search box.

### Rename

`TitleDialog` exists and is reachable from exactly one place: a board card's `⋮`. The card
you are *standing inside* as a board has its own `⋮` one level up, and the card whose
details you are reading has none at all. An overflow item on both app bars, not a pencil:
at 200 % text the app-bar corner is the one a thumb uses to leave the screen, and an
accidental rename on a shared project is a household's "I tapped something and cannot find
my way back".

## 3. Data & queries

No new field on `nodes`. `participantIds` changes only in what is *stored* in it.

| Node | `participantIds` before | after |
| --- | --- | --- |
| Shared root | `[]` (meaning everyone) | every current member's uid |
| Shared root, narrowed | the chosen uids | unchanged |
| Private root | creator, plus whoever was added | unchanged |
| Shared descendant | `[]` | `[]` — unchanged |
| Private descendant | the root's list | unchanged |

`hiddenByParticipants` is untouched: `[]` and `[…me…]` both return `false` for a member, so
filtering is **identical on the day the backfill runs** and diverges only when somebody new
joins.

### Promotion carries the old project's participants

`data/nodes.ts:611` already handles the **demotion** arm: a shared root that becomes a step
has its `participantIds` cleared to `[]`, because the hide filter is uniform at every depth
and a step nobody could clear would stay hidden for good. The **promotion** arm was never
written, because `[]` was a legal root. It is not legal any more, so without this a
promoted step writes an empty root and the rules reject the move outright.

On a reparent to `parentId == null`:

| Node | Carries today | Takes on promotion |
| --- | --- | --- |
| Shared step | `[]` | the **old root's** `participantIds` |
| Private step | the old root's list, by the inheritance rule | unchanged — already correct |

`visibility` needs no copying at all: uniform visibility is an invariant, so a step already
carries its root's value and keeps it across the move. The only field that moves is
`participantIds`, and only for a shared step.

The guard lives inside `reparentNode`, beside the demotion arm it mirrors, rather than in
each caller — the same reasoning that put the demotion arm there. It costs one `getNode` of
`rootIdOf(node)`, on a path that already reads the subtree and already requires a
connection. A shared node's root is shared, so it is readable by every member and the read
cannot be denied.

`functions/src/writes.ts:396` carries the identical asymmetry and takes the identical fix,
so a `PATCH` that sets `parentId: null` promotes the same way the app does.

A stale root still holding `[]` — one the backfill has not reached — makes the promotion
fail. That is not a new failure mode: under the new rule *every* update to such a root is
already denied, which is what `OPERATIONS.md` § One-off migrations exists to prevent and
why the migration re-runs after the deploy.

One new field on an **invite** document (`homes/{homeId}/invites/{emailHash}`):

- `addToAllProjects: boolean` — written by the owner who creates the invite, read by the
  invitee on accept. It has to live here rather than being applied by the inviter: invites
  are keyed by email hash and the invitee **has no uid until they accept**, so there is
  nothing to write into a participant list at invite time.

### Queries

`acceptInvite` gains one, fired once, only when the flag is set and only after the
membership write has landed:

```
homes/{homeId}/nodes
  where archived == false
  where parentId == null
  where visibility == 'shared'
```

Provably safe: every shared node is readable by every member (`visibleToMe` returns true on
`visibility == 'shared'`), and the actor is a member by the time it runs. It cannot return
a deniable document, so it cannot be rejected wholesale. Private roots are excluded by the
`visibility` clause — joining a household is not joining its private work.

Each root is then updated individually with the new uid appended. Failures are reported and
the operation is re-runnable; a partial run leaves the invitee a member with a thinner board,
which somebody can finish by hand on the details screen.

No new index. `firestore.indexes.json` already carries
`nodes (archived, parentId, visibility, rank)`, whose equality prefix serves this exactly.

## 4. Rules & tests

`firestore.rules`, in the `nodes` match block, on **create and update**:

```
function rootHasParticipants(data) {
  return data.parentId != null || data.participantIds.size() > 0;
}
```

Uniform across both visibilities — a private root already carries its creator, so the
constraint only bites on shared roots. This is a **narrowing** rule: a stored root still
holding `[]` has every update to it denied afterwards, including the `childCount` bump that
adding a step performs. Hence the ordering in Phase 1.

`invites`: `addToAllProjects` must be a bool when present, alongside the existing `role`
and `emailHash` checks.

`tests/rules/` gains, in the same change:

- a shared root created with `participantIds: []` is **denied**;
- a shared root created with a non-empty list is allowed;
- an update that empties a shared root's list is **denied**;
- a shared *descendant* with `[]` is still allowed, on create and on update;
- a private root is unaffected (it always carries its creator);
- an invite with `addToAllProjects: "yes"` is denied; with `true` or absent, allowed;
- a member may append their own uid to a shared root's `participantIds` on accept.

## 5. UI flow

### `PeopleField`

One addition, reusing the existing `lockedUid` / `lockedHint` mechanism rather than growing
a new one: **the last remaining ticked participant on a root cannot be unticked.** A write
of `[]` would be refused by the rules, and a checkbox that silently refuses is the failure
this component's own doc comment exists about.

- private root → `lockedUid = uid`, hint `detail.participantsYouStay` (unchanged);
- shared root with exactly one participant → `lockedUid` = that uid, hint
  `detail.participantsLast`.

### `PeopleSection`

- Renders nothing until `root !== null`. Today `assignableMembers(null, members)` returns
  the whole household while the root's listener resolves, so on a narrowed project the
  assignee control appears for one tick and then vanishes under a thumb already reaching
  for it.
- *Who's doing it?* renders when `assignable.length > 1 **or** node.assigneeIds.length > 0`.
  The second clause is what keeps every assignment removable.
- The stale-assignee sentence and its *Remove [name]* action are unchanged, and now always
  sit under a visible list rather than alone.
- `moveToTop`, the `boardOnce`/`reparentNode` import pair it needs, and the
  `privateOnlyProjects` / `privateMoveUp` block are deleted outright.
- `assigneesNarrowed` and the always-visible `assigneesChange` button are deleted from the
  section body. The *action* moves into the disclosure.

### The disclosure

`List.Accordion`, below the people controls and above `StepsSection`, rendered only where
the people controls themselves render (`members.length > 1`). Inside, two sections separated
by `Divider`, each with a `titleMedium` header, then the *Change who's in on [project]*
`Action` — the same left-aligned text button the section uses today, pointing at
`detailsHref(rootIdOf(node))`.

Paper's compound components have announced badly under React Native Web twice in this
codebase (`Checkbox.Item` in `PeopleField`, and see `MetaChip`), so the accordion's
`aria-expanded` is verified in the browser pass rather than assumed.

Offline: nothing here writes, so nothing is gated.

### Rename

`TitleDialog` unchanged, mounted only while open, `returnFocusTo` the menu anchor.

- **Details screen** gains an overflow `Menu` in the app bar, between the title and
  `AccountMenu`, holding one item.
- **Board screen**: `BoardMenu` gains *Rename* as its **first** item and now renders
  whenever `node !== null`, not only when `canFilter`. On the root board there is no node,
  so there is still nothing to rename and the menu still only appears if it can filter.
- Both write through `updateNode`, which queues offline exactly as `CardMenu`'s rename
  does. No online gate, no hint — a rename that refuses in a garage with no signal would be
  the only write on these screens that does.

### Card creation

`components/board/Board.tsx:209` passes `participantIds: members.map(m => m.uid)` when the
new card is a **shared root** (`parent === null`). `StepsSection` is untouched: a step is
never a root.

### Invite

`InviteForm` gains a `Checkbox`-style row under the role selector, default **off**, whose
value is written to the invite document. `acceptInvite` reads it after the membership write
resolves and appends the new uid to every shared root, best-effort, reporting failure
through the existing error path.

## 6. Strings

Dying, from both `en-US.json` and `sv-SE.json`:

| Key | en-US |
| --- | --- |
| `detail.assigneesNarrowed` | "Only people in {{project}} are shown." |
| `detail.privateOnlyProjects` | "Only a whole project can be kept to yourself, not a step inside one." |
| `detail.privateMoveUp` | "Move {{title}} to the top level" |

Surviving and relocated: `detail.assigneesChange` moves inside the disclosure.

New:

| Key | en-US | sv-SE |
| --- | --- | --- |
| `detail.whoSeesWhat` | Who can see what? | Vem ser vad? |
| `detail.whoSeesProject` | Who's in on a project | Vilka är med i ett projekt |
| `detail.whoSeesProjectBody` | Only the people ticked here see the project on their board. Everyone else in the home can still open it if you send it to them — it just stays off their list. | Bara de som är ikryssade här ser projektet på sin tavla. Alla andra i hemmet kan fortfarande öppna det om du skickar det till dem — det ligger bara inte i deras lista. |
| `detail.whoSeesStep` | Who's doing a step | Vem gör ett steg |
| `detail.whoSeesStepBody` | A step can only be given to someone who is in on the project. Add them to the project first, and they will show up here. | Ett steg kan bara ges till någon som är med i projektet. Lägg till hen i projektet först, så dyker hen upp här. |
| `detail.participantsLast` | At least one person has to be in on a project. | Minst en person måste vara med i ett projekt. |
| `members.inviteAllProjects` | Add them to every shared project | Lägg till hen i alla delade projekt |
| `members.inviteAllProjectsFailed` | Joined, but not every project could be shared. Someone can add them from a project's details. | Med i hemmet, men alla projekt kunde inte delas. Någon kan lägga till hen från ett projekts detaljer. |

Rename reuses `board.rename` ("Rename" / "Byt namn") for the menu item and
`board.renameTitle` ("Rename card" / "Byt namn på kortet") for the dialog heading, on both
screens. No new key: the thing being renamed is a card at every depth, whether you are
looking at its details or standing inside it.

## 7. Acceptance

1. `[test]` A new project created on the root board stores every current member's uid in
   `participantIds`, and every member sees it on their board.
2. `[test]` A new step created on a project's board stores `participantIds: []`.
3. `[test]` Unticking participants down to one leaves that last row untickable, with
   `detail.participantsLast` shown under the list.
4. `[test]` A project narrowed to one member is absent from another member's board and
   still opens from a direct link.
5. `[test]` On a step of a project with one participant and nobody assigned, "Who's doing
   it?" is not on the screen.
6. `[test]` On a step of the same project with somebody assigned, the control is on the
   screen and unticking them writes an empty `assigneeIds`.
7. `[test]` A stale assignee still renders their sentence, and *Remove [name]* still clears
   them.
8. `[test]` No detail screen at any depth contains "Move to the top level", "Only a whole
   project can be kept to yourself" or "Only people in".
9. `[test]` A step can still be promoted through `CardMenu › Move under… › Top level`.
10. `[test]` Promoting a step out of a project narrowed to one member gives the new root
    that member's uid, not an empty list, and the move is accepted.
11. `[test]` Promoting a step out of a private project leaves it private and keeps the same
    participants.
12. `[test]` Demoting a shared root back under a project still clears its `participantIds`
    to `[]`.
13. `[test]` `PATCH /nodes/:id` with `parentId: null` promotes with the old root's
    participants, the same as the app.
14. `[test]` *Who can see what?* opens two headed sections and a *Change who's in on
    [project]* button that navigates to the root's details.
15. `[test]` Renaming from the details app bar changes the title on the screen and on the
    board behind it, and survives a reload.
16. `[test]` Renaming from a board's own app bar changes the app-bar title and the
    breadcrumb.
17. `[test]` A rename made offline appears immediately and lands on reconnect.
18. `[test]` `POST /nodes` with no `participantIds` creates a shared root carrying every
    member; with `participantIds: [me]` it carries only that uid; `PATCH` with the field
    still returns `participants_immutable`.
19. `[test]` Accepting an invite with the box ticked puts the new member on every shared
    root; with it unticked, on none.
20. `[eye]` The disclosure reads as something worth opening, and its two sections are
    visibly separated rather than one grey paragraph.
21. `[eye]` The details app bar with a back arrow, a title, an overflow and the account
    menu is not crowded at 200 % text in `sv-SE`.

## 8. What this does NOT change

- Every field still saves and reads as it does now — due date, priority, effort, notes,
  assignees, visibility.
- The private-visibility flip: its top-down *n* writes, its progress dialog, its resumable
  retry, its offline gate. Untouched.
- `hiddenByParticipants` and the board's default-hide filter. Identical behaviour on the
  day the backfill runs.
- Who can read what. The read rules are not edited; the new constraint is a shape check on
  a field, not a grant.
- A step is still promotable, through the board card menu.
- `PATCH /nodes/:id` still refuses `participantIds`, for the reason it always has.
- Shared descendants still carry `[]`, and `StepsSection` still creates them that way.
- The demotion arm of `reparentNode`: a shared root that becomes a step still has its
  participants cleared.
- `detail.participants`, `detail.participantsPrivate` and `detail.assignees` keep their
  current wording.

## 9. Out of scope

- **The desktop layout of this screen** — moved to
  [#31](https://github.com/Senth/home-backlog/issues/31), which owns desktop layout, along
  with the two-column split and the details-beside-the-board idea from #103.
- **A non-interactive example checkbox row inside the disclosure.** The issue floats it;
  two sentences and a real control one scroll above it are enough, and a fake control that
  looks tappable is a new confusion traded for an old one.
- **Tap-the-title-to-rename.** Considered and rejected above.
- **A search-and-add people picker** — [#88](https://github.com/Senth/home-backlog/issues/88).

## 10. Phases

| # | Scope | Agent |
| --- | --- | --- |
| 1 | `models/node.ts` create defaults, `data/nodes.ts` promotion arm, `firestore.rules` + `tests/rules/`, and `functions/scripts/migrate-102-participants.mjs` with its `OPERATIONS.md` table row | `feature-large` |
| 2 | `functions/src/{body,writes}.ts` — `participantIds` accepted on create, still refused on update; default to every member for a shared root; the promotion arm at `writes.ts:396`; `docs/specs/rest-api.md` | `feature-small` |
| 3 | `PeopleSection` removals and hide rules, `PeopleField` last-participant lock, the disclosure, `Board.tsx` creation, strings in both locales | `feature-large` |
| 4 | Rename on both app bars | `feature-small` |
| 5 | Invite flag: model, rules, `InviteForm`, `acceptInvite` | `feature-large` |
| 6 | `e2e/` specs for every `[test]` claim above | `feature-small` |

**Before Phase 1 is considered done**, and before this branch merges:

```bash
node functions/scripts/migrate-102-participants.mjs --project home-backlog          # dry run
node functions/scripts/migrate-102-participants.mjs --project home-backlog --apply
node functions/scripts/migrate-102-participants.mjs --project home-backlog          # 0 changes
```

and the same script against `.emulator-seed/`, per `OPERATIONS.md`. Re-run `--apply` once
the deploy has landed.
