# Homes and members

## Handoff

_wip only — the cleanup phase deletes this section._

This file is the implementation plan for issue **#37**. Work the **Phases** section in
order. Read [`CLAUDE.md`](../../../CLAUDE.md), [`docs/PROJECT.md`](../../PROJECT.md) and
[`docs/specs/platform-offline.md`](../platform-offline.md) first — this feature sits
directly on top of the auth gate and the splash that spec describes.

Nothing durable may live only in **Handoff** or **Phases**; both are deleted by the
cleanup phase, which folds the rest into `docs/specs/home-and-members.md`.

Branch `feat/37-homes-and-members`. One commit per phase, once that phase is green on
`yarn lint --write`, `yarn typecheck` and `yarn test`. The first commit also carries the
`TODO.md` regenerated at handoff.

**After the cleanup phase — and only then:**

```bash
GIT_VANILLA=1 gh pr create --fill --body "Closes #37"
GIT_VANILLA=1 gh pr checks --watch
GIT_VANILLA=1 gh pr merge --squash --delete-branch
```

Any check failing means stop, report, and **do not merge**.

Committing, opening the PR and merging are an explicit, user-authorized exception to the
global "never commit without being asked" rule. The exception is scoped to this flow and
to this branch. Nothing else is committed or pushed without asking, and nothing is ever
pushed straight to `main` — that deploys to production.

---

## 1. What

A signed-in person creates a home, is carried into it, manages its name and its people,
invites others by email address, and joins the homes they have been invited to — moving
between several homes from a "My homes" level that sits above the boards.

## 2. Why

`firestore.rules` has modelled `homes/{homeId}` with a `members` map and hash-keyed
invites since the auth work landed, and no application code has ever touched it. Every
feature after this one — nodes, locations, recurring — is scoped to a home, so nothing
else can be built until a home exists and the app knows which one is active.

### Invites are keyed by a hash of the email address, and must be accepted

The invite lives at `homes/{homeId}/invites/{sha256(lowercased email)}`. The invitee signs
in with that Google account, finds the invite, and explicitly joins. Nobody is added to a
household they did not agree to join, and the rules — not the UI — are what guarantee it:
`acceptsInvite()` lets the invitee add **only their own uid**, with **only the role the
invite grants**, and only with a verified email.

Rejected: adding people directly by uid. The owner does not know anyone's uid, only their
address, and a direct add would let anyone drop anyone else into a household.

### There is no invite link, and no email is sent

**This is the honest limit of the feature and must not be papered over.** Nothing is
delivered to the invitee. They discover the invitation the next time they open the app.
Marcus telling Nadia "I added you" out of band is the notification channel.

An invite *link* was designed and dropped. Once invites are findable in-app, a link's only
remaining value is the pre-auth line "Marcus invited you to Villa Solberg" — and buying
that costs a `/join/[homeId]` route, display text carried in attacker-controllable query
parameters, and pending state that has to survive `signInWithRedirect`. That last one was
a `blocking` finding in its own right: the redirect eats the URL, the invitee lands on
onboarding, creates a second empty household, and there is no merge path. Dropping the
link removes the failure rather than handling it. The trust line survives in post-auth
form, on the pending-invite card. Revisit when there is a reason; the data model needs no
change for it.

Rejected alongside it: **link-only discovery**, where the invitee must be sent a URL. That
is the version where Nadia is lost, and the persona review says so directly — she will not
go looking, and a link she never taps is an invitation that never existed.

### Invites are found with a collection-group query

The invitee cannot read the home doc, and does not know `homeId`. They therefore cannot
reach the invite by path. `documentId()` in a collection-group query compares the **full
document path**, not the last segment, so the hash in the key is not queryable either.

So the hash is **also stored as a field**, `emailHash`, and found with
`collectionGroup('invites').where('emailHash', '==', myHash)` under a new
`match /{path=**}/invites/{id}` read rule. The invite doc denormalizes `homeName` and
`invitedByName` because the invitee can read neither the home nor its members.

Rejected: `users/{uid}/invites/{homeId}` mirror docs. Trivially query-safe, and
unwriteable — at invite time the owner has an address, not a uid.

### The switcher is a level of navigation, not a menu

`/homes` is a real route above the boards. The app bar shows where you are: the home's
name on a board, "My homes" one level up. Switching is going up and picking another.

This answers a `blocking` finding — Ingrid records cabin work on the house board because
nothing on screen said which home she was in — with the same rule
[`platform-offline`](../platform-offline.md) already applies to identity: **visible
without a tap**. It also keeps leave and delete two levels away from the row she taps most
often, instead of adjacent to it in a menu.

Rejected: a switcher row in the account menu (the shape idea issue **#21** proposed, now
absorbed). It leaves the active home invisible until tapped, and puts destructive rows in
the menu used for switching.

### `members` keeps its shape; profiles sit beside it

Six rule expressions read `members` as uid → role string. Widening its values to objects
to carry names would rewrite all of them and every test, for nothing the sibling maps do
not give. So the home doc gains `memberProfiles` (display name and photo) and
`memberEmailHashes`.

Addresses of **members** are never stored in readable form. The owner matches a typed
address against `memberEmailHashes` by hashing it — enough to answer "already a member"
and "that's you" without exposing anyone. A **pending** invite does carry the plaintext
`email`, readable only by that home's owners, because they typed it: a bare hash makes a
typo invisible on both ends and leaves no way to withdraw or resend by person. It
disappears with the invite when it is consumed.

Future per-user settings belong in a `users/{uid}` document readable only by that user.
This feature does not create one.

### The last owner cannot be removed, and delete is deliberately narrow

Nothing may leave a home with zero owners: the remaining members could edit nodes forever
but never invite, never remove and never delete, and no action inside the app could
recover it. The invariant is enforced in `firestore.rules`, not in a component, so the
REST API (#7) inherits it.

Deleting a home doc does **not** delete its `nodes`, `locations` and `recurring`. Every
one of those rules resolves membership through a `get()` on the home doc, so once it is
gone those documents are unreachable by anyone, permanently, while still stored. There is
no Cloud Function to cascade — #1 is open and unbuilt.

Delete is therefore offered only when you are the home's **sole member**, where the
client-side cascade is bounded and usually empty, and where it cannot revoke anyone else's
access as a side effect. It exists at all because the last-owner rule otherwise traps a
sole owner with every home they ever created by accident. The atomicity gap and the exact
private-node counts are #39.

### Vocabulary

The UI noun is **Home** / **hem**, but the app prefers the home's *own* name — "Huset",
"Stugan" — and uses the noun only where a word is unavoidable ("Create a new home" /
"Skapa ett nytt hem"). Ingrid's cabin is not her *hem*; her cabin is *stugan*, and a
switcher built from two named rows asks her to learn nothing.

"Home" does not collide with the house in the Locations tree — they are deliberately the
same thing. The post-MVP dashboard in [`PROJECT.md`](../PROJECT.md) is renamed
**Overview** / **Översikt** so it does not take the word.

The `owner` role is labelled **Admin** / **Administratör** in the UI while staying `owner`
in the data. On a family-shared cabin, "ägare" makes a claim about the deed; "administratör"
describes what the person can do in the app.

## 3. Data & queries

### `homes/{homeId}`

| Field | Type | Notes |
| ----- | ---- | ----- |
| `name` | `string` | 1–60 characters, validated in rules |
| `members` | `map<uid, 'owner' \| 'member'>` | unchanged shape; at least one `'owner'` always |
| `memberProfiles` | `map<uid, { displayName: string, photoURL: string \| null }>` | written by each member for themselves |
| `memberEmailHashes` | `map<uid, string>` | `sha256(lowercased email)`, hex; each member's own must equal their token's |
| `createdAt` | `Timestamp` | |
| `createdBy` | `uid` | |

### `homes/{homeId}/invites/{sha256(lowercased email)}`

| Field | Type | Notes |
| ----- | ---- | ----- |
| `emailHash` | `string` | equals the document id — validated in rules, so the collection-group query cannot be poisoned with someone else's hash |
| `email` | `string` | plaintext, readable only by this home's owners |
| `role` | `'owner' \| 'member'` | what accepting grants |
| `homeName` | `string` | denormalized — the invitee cannot read the home doc |
| `invitedByName` | `string` | denormalized — the invitee cannot read `memberProfiles` |
| `createdAt` | `Timestamp` | orders the owner's pending list |

### Queries

**The homes I belong to** — fired once per session by `HomeProvider`.

```ts
query(collection(db, "homes"),
      where(new FieldPath("members", uid), "in", ["owner", "member"]))
```

Provably safe: a home where I am not a member has no `members.<uid>` subfield, so it
cannot match, and every document that *can* match satisfies the existing
`allow get, list: if memberOfThis()`. Listener breadth is the number of homes I belong to
— one to three. Map subfields are indexed automatically; no composite index.

**My pending invitations** — fired when the homes list is shown.

```ts
query(collectionGroup(db, "invites"),
      where("emailHash", "==", sha256(myEmail.toLowerCase())))
```

Provably safe: every matching document carries *my* hash by definition, which is exactly
the condition the new collection-group read rule tests. Verify in the emulator whether a
collection-group-scoped single-field index on `emailHash` is created automatically; if the
query errors, add a `fieldOverrides` entry to `firestore.indexes.json` in the same phase.

`homeId` for the accept and decline writes comes from `snapshot.ref.parent.parent.id`.

**Pending invitations for a home** — fired only on the manage screen, and only by an owner.

```ts
query(collection(db, "homes", homeId, "invites"), orderBy("createdAt", "desc"))
```

Provably safe *for an owner*: `isOwner(homeId)` passes for every document in the
collection. A non-owner member must never fire it — for them some documents would be
denied and the whole query would fail. The manage screen renders the pending section only
when `role === 'owner'`.

**Accepting** writes with a dotted field path, so nothing that is not readable has to be
read first:

```ts
updateDoc(doc(db, "homes", homeId), {
  [`members.${uid}`]: invite.role,
  [`memberProfiles.${uid}`]: { displayName, photoURL },
  [`memberEmailHashes.${uid}`]: myHash,
});
await deleteDoc(inviteRef);
```

## 4. Rules & tests

### `firestore.rules`

Helpers added:

```
function hasAnOwner(members) {
  return members.values().hasAny(['owner']);
}

function validHome(data) {
  return data.name is string && data.name.size() > 0 && data.name.size() <= 60
    && hasAnOwner(data.members);
}
```

`match /homes/{homeId}`:

- `create` also requires `validHome(request.resource.data)` and
  `request.resource.data.memberEmailHashes[request.auth.uid] == emailHash()` — you cannot
  create a home recording somebody else's address hash as your own.
- `update` requires `validHome(request.resource.data)` on every branch. The member branch
  additionally requires that the diffs of `memberProfiles` and `memberEmailHashes` each
  affect only `request.auth.uid`, so a member can maintain their own profile and nobody
  else's. The owner branch may touch anyone's, because removing a member must remove their
  entries too.
- `acceptsInvite()` widens from `hasOnly(['members'])` to
  `hasOnly(['members', 'memberProfiles', 'memberEmailHashes'])`, with the two new maps'
  diffs restricted to `request.auth.uid`, and
  `request.resource.data.memberEmailHashes[request.auth.uid] == emailHash()`.
- `delete` becomes `ownerOfThis() && resource.data.members.keys().size() == 1`.

`match /homes/{homeId}/invites/{emailHashId}`:

- `create, update` additionally require `request.resource.data.emailHash == emailHashId`.

New collection-group rule, **read only**:

```
match /{path=**}/invites/{emailHashId} {
  allow get, list: if signedIn()
    && request.auth.token.email != null
    && resource.data.emailHash == emailHash();
}
```

It widens nothing: the nested rule already grants the hash holder read access. It exists
so the same grant applies to a collection-group query, which the nested path does not
cover. Writes stay on the nested rule alone.

### `tests/rules/firestore.test.ts`

Existing cases must keep passing; seeds gain the new fields. Added:

- A home cannot be created or updated with an empty or over-long name.
- A home cannot be created or updated into having no owner: the sole owner cannot demote
  themselves, cannot remove themselves, and an owner cannot remove the only other owner.
- A member may write their own `memberProfiles` / `memberEmailHashes` entry and not
  another member's.
- Neither a member nor an owner may record a `memberEmailHashes` entry for themselves that
  is not the hash of their own token email.
- An owner may delete a home they are alone in, and may not delete one with a second member.
- An invite whose `emailHash` field disagrees with its document id is rejected on create
  and on update.
- The collection-group read returns an invitee their own invite, across homes they are not
  a member of, and returns nothing for somebody else's hash.
- The collection-group path grants no write: an invitee cannot create or edit an invite.
- A non-owner member listing a home's invites is denied.
- Accepting writes `members`, `memberProfiles` and `memberEmailHashes` for the invitee and
  nothing else; accepting while claiming a hash that is not yours is denied.

`storage.rules` is unchanged.

## 5. UI flow

### `/homes` — "My homes", and the empty state that is onboarding

`Appbar.Header` + `Appbar.Content title` = "My homes". A `List.Section` of homes, each a
`List.Item` with a `home-outline` `List.Icon`, the name as the title, the member count as
the description, a check on the active one, and a chevron into manage. Below a `Divider`,
pending invitations render as `Card`s — "Marcus invited you to Villa Solberg" — with
`Card.Actions` Join / Decline. Below another `Divider`, a `Button` opens a `Dialog` with a
single `TextInput` prefilled with `{{name}}'s home`, and a Create button.

With no homes and no invitations this same screen *is* onboarding: one prefilled field and
one button, no wizard and no choice screen.

### The gate

`app/(app)/(tabs)/_layout.tsx` returns `<Redirect href="/homes" />` when there is no active
home, so the tab routes never mount — the same declarative, during-render pattern
`app/(app)/_layout.tsx` already uses for auth. `/homes` lives outside `(tabs)`, so there is
no redirect loop.

`HomeProvider` resolves in this order, and `SplashScreen` holds the router until it has:

```
persisted home id, and I am still a member of it  → that home
exactly one home                                   → that home
no homes                                           → /homes (onboarding)
several homes, no valid persisted id               → /homes
```

The persisted id lives in `AsyncStorage`, already a dependency. Being removed from the
active home, or deleting it, drops back to `/homes`.

### The boards

`Appbar.BackAction` up to `/homes`, `Appbar.Content title` = the home's **name**, and the
existing `AccountMenu` on the right. The bottom tab bar already names the screen, so
`screen.*.title` is retired as an app-bar title; the empty-state strings stay.

### `/homes/[homeId]` — manage

`Appbar.BackAction`, title "Manage home".

- **Name** — `TextInput` and a Save `Button`. Any member may rename.
- **Members** — `List.Item` per person with `Avatar.Image` (falling back to `Avatar.Text`
  initials, reusing the pattern in `components/auth/AccountMenu.tsx`), a role `Chip`, "You"
  on your own row, and for an owner an overflow `Menu` with Make admin / Make member /
  Remove. Actions that would leave no admin are disabled with "Make someone else an admin
  first."
- **Invite someone** (owners only) — `TextInput` for the address, `SegmentedButtons` for
  Member / Admin, and a Send `Button`. Validation runs at typing time against the hashes
  already on the home doc: your own address, an existing member, an already-invited
  address and a malformed address each produce their own message.
- **Pending invitations** (owners only) — `List.Item` per invite showing the plaintext
  address and its age, with a withdraw `IconButton`.
- **Danger zone** — Leave this home, and Delete this home when you are its sole member.
  Each behind a `Dialog`. The remove-member dialog says that anything only that person
  could see — their private tasks — stops being visible to anyone. The delete dialog names
  the home and states that every project, location and maintenance task in it is deleted.

A home you are alone in shows no members section and no pending section: one quiet
"Invite someone" action and nothing else, so a solo household never meets the concept.

Errors surface through `Snackbar`, matching `AccountMenu`. Spacing, radii and elevation
come from `theme/tokens.ts`; colours from `useAppTheme()`.

### Offline

`useOnlineStatus` already exists. Creating a home, sending an invite, joining and declining
all require a connection and are disabled offline with a hint, the way the login screen
already treats sign-in. Joining in particular cannot be optimistic: `acceptsInvite()` is
evaluated on the server, so a queued write would show membership locally and then revert.
The Join button shows a pending state and membership is claimed only once the write
resolves. Reading the homes list works offline from Firestore's cache; renaming and role
changes queue normally.

## 6. Strings

All new keys go into both `i18n/locales/en-US.json` and `i18n/locales/sv-SE.json` in the
same change.

| Key | `en-US` | `sv-SE` |
| --- | ------- | ------- |
| `homes.title` | My homes | Mina hem |
| `homes.empty` | You are not in any home yet. | Du är inte med i något hem än. |
| `homes.create` | Create a new home | Skapa ett nytt hem |
| `homes.nameLabel` | Name | Namn |
| `homes.nameHint` | What you call it between yourselves — "The house", "The cabin". | Det ni själva kallar det — ”Huset”, ”Stugan”. |
| `homes.defaultName` | {{name}}'s home | {{name}}s hem |
| `homes.createAction` | Create | Skapa |
| `homes.nameRequired` | Give the home a name. | Ge hemmet ett namn. |
| `homes.nameTooLong` | That name is too long. | Namnet är för långt. |
| `homes.current` | Current | Nuvarande |
| `homes.memberCount` | {{count}} people | {{count}} personer |
| `homes.offlineHint` | Creating a home needs a connection. | Du måste vara uppkopplad för att skapa ett hem. |
| `invite.pending` | {{inviter}} invited you to {{home}} | {{inviter}} har bjudit in dig till {{home}} |
| `invite.join` | Join | Gå med |
| `invite.joining` | Joining… | Går med… |
| `invite.decline` | Decline | Avböj |
| `invite.declineTitle` | Decline the invitation? | Avböja inbjudan? |
| `invite.declineBody` | {{inviter}} would have to invite you again. | {{inviter}} måste bjuda in dig igen. |
| `invite.offlineHint` | Joining a home needs a connection. | Du måste vara uppkopplad för att gå med. |
| `invite.failed` | Could not join. The invitation may have been withdrawn. | Kunde inte gå med. Inbjudan kan ha tagits tillbaka. |
| `invite.sendTitle` | Invite someone | Bjud in någon |
| `invite.emailLabel` | Email address | E-postadress |
| `invite.send` | Send invitation | Skicka inbjudan |
| `invite.sent` | Invitation sent to {{email}}. | Inbjudan skickad till {{email}}. |
| `invite.sentBody` | They will see it the next time they open Home Backlog. | Den syns nästa gång de öppnar Home Backlog. |
| `invite.selfError` | That is your own address. | Det är din egen adress. |
| `invite.alreadyMember` | {{name}} is already in this home. | {{name}} är redan med i hemmet. |
| `invite.alreadyInvited` | That address has already been invited. | Adressen är redan inbjuden. |
| `invite.invalidEmail` | That does not look like an email address. | Det ser inte ut som en e-postadress. |
| `invite.pendingTitle` | Pending invitations | Skickade inbjudningar |
| `invite.revoke` | Withdraw | Ta tillbaka |
| `invite.revokeTitle` | Withdraw the invitation? | Ta tillbaka inbjudan? |
| `invite.revokeBody` | {{email}} will no longer be able to join. | {{email}} kan inte längre gå med. |
| `members.title` | Members | Medlemmar |
| `members.roleOwner` | Admin | Administratör |
| `members.roleMember` | Member | Medlem |
| `members.you` | You | Du |
| `members.promote` | Make admin | Gör till administratör |
| `members.demote` | Make member | Gör till medlem |
| `members.remove` | Remove from home | Ta bort från hemmet |
| `members.removeTitle` | Remove {{name}}? | Ta bort {{name}}? |
| `members.removeBody` | They lose access to this home. Anything only they could see — their private tasks — stops being visible to anyone. | Hen förlorar åtkomst till hemmet. Sådant som bara hen kunde se — hens privata uppgifter — försvinner för alla. |
| `members.lastAdmin` | Make someone else an admin first. | Gör någon annan till administratör först. |
| `manageHome.title` | Manage home | Hantera hem |
| `manageHome.save` | Save | Spara |
| `manageHome.saved` | Name saved. | Namnet sparat. |
| `manageHome.leave` | Leave this home | Lämna hemmet |
| `manageHome.leaveTitle` | Leave {{home}}? | Lämna {{home}}? |
| `manageHome.leaveBody` | You will need a new invitation to come back. | Du behöver en ny inbjudan för att komma tillbaka. |
| `manageHome.delete` | Delete this home | Radera hemmet |
| `manageHome.deleteTitle` | Delete {{home}}? | Radera {{home}}? |
| `manageHome.deleteBody` | Every project, location and maintenance task in it is deleted. This cannot be undone. | Alla projekt, platser och underhåll i det raderas. Det går inte att ångra. |
| `manageHome.deleteConfirm` | Delete | Radera |
| `manageHome.deleteOnlyAlone` | Remove everyone else first. | Ta bort alla andra först. |

`sv-SE` uses *hen* for a member of unknown gender, and prefers the home's own name over
the noun wherever a name is available.

## 7. What this does NOT change

- Auth: the redirect sign-in, `AuthGate`, `SplashScreen`, the account menu and its
  deliberate sign-out are untouched. `HomeProvider` mounts inside the resolved-auth half of
  the tree and never races it.
- The service worker, the install offer, the offline bar, and the i18n wiring.
- `nodes`, `locations` and `recurring` — no field, rule or query for any of them changes.
  The two-query board privacy pattern in [`PROJECT.md`](../PROJECT.md) is untouched, and
  the `array-contains` slot on the shared-node query stays free for
  `locationAncestorIds`.
- `storage.rules`.
- The `members` map's uid → role shape, and every rule expression that reads it.
- `theme/tokens.ts` may be extended if a value is genuinely missing; no literal is inlined.

## 8. Out of scope

- **Invite links and the pre-auth trust line** — no `/join` route ships. Idea issue **#22**
  keeps the reserved line on the login screen; the post-auth pending-invite card carries
  the inviter and home name instead.
- **Sending email.** No invitation is delivered anywhere. Discovery is in-app only.
- **A Cloud Function cascade** for home deletion and member removal, and exact private-node
  counts in the remove dialog — **#39**, which shares machinery with **#1**.
- **Bootstrap over REST.** A key is scoped to a home, so no agent can create the first one
  or accept an invite — **#38**, to be written into `SKILL.md` when **#7** lands.
- **An account-menu switcher** — idea issue **#21**, absorbed by the `/homes` route and
  closed by this work.
- **A `users/{uid}` settings document.** Named here so the next feature that needs private
  per-user state knows where it goes, and knows it does not go on the home doc.
- Transferring ownership as a single explicit action (promote, then demote yourself),
  per-home preferences, and archiving a home instead of deleting it.

## 9. Phases

_wip only — the cleanup phase deletes this section._

Each phase ends green on `yarn lint --write`, `yarn typecheck` and `yarn test`, and is one
commit. Phases 1 and 4 also run `yarn test:rules`.

**Phase 1 — model, rules, rule tests.** `models/home.ts` with the `Home`, `Member`,
`Invite` and role types, plus an `emailHash()` domain module tested against the same
vectors as `tests/rules/helpers.ts` — if those two ever disagree, no invitee can find their
own invite. All of §4's `firestore.rules` changes and all of its `tests/rules/` cases.

**Phase 2 — the data layer.** `HomeProvider` and `useHome()`: the two queries in §3, the
active-home resolution ladder, and `AsyncStorage` persistence. The resolution ladder is a
pure function and is unit-tested; the SDK wrappers around it are not.

**Phase 3 — `/homes` and the gate.** The homes list, the create dialog, the onboarding
empty state, the redirect in `(tabs)/_layout.tsx`, and the boards' app bar rewiring to
back-action plus home name. Strings for both locales.

**Phase 4 — sending invitations.** The manage screen skeleton, rename, the invite form with
its four typing-time validations, the pending list and withdraw. Confirm here whether
`emailHash` needs a `fieldOverrides` entry in `firestore.indexes.json`, and add it if so.

**Phase 5 — joining and declining.** The invite cards on `/homes`, the server-confirmed
join, decline, and the offline handling in §5.

**Phase 6 — members.** Promote, demote, remove, leave and delete, with every confirm dialog
and every last-admin guard, and the solo-home surface that hides the members section.

**Phase 7 — review.** Run `/review` until PASS. `code-review` first, its findings fixed and
green, then `browser-review` against the clean change; fix loop capped at two rounds and
re-run scoped. `blocking` findings are never deferrable; a `should-fix` may be deferred only
with a stated reason. `idea` findings go to the user, who decides which become issues.

**Phase 8 — cleanup, then ship.**

- Fold this file into a new area spec `docs/specs/home-and-members.md` — the name
  [`INDEX.md`](../INDEX.md) already reserves. Rewrite, do not append: it must read as one
  present-tense description of how homes and members work, carrying every *why* and every
  rejected alternative from §2. Sections **Handoff** and **Phases** are deleted.
- Add the row to `docs/specs/INDEX.md` and remove `home-and-members` from its planned list.
- Rename PROJECT.md's post-MVP "Dashboard home" to "Overview", per §2.
- Delete `docs/specs/wip/37-homes-and-members.md`.
- Refresh `.emulator-seed/` **through the app**: two homes with distinct names, a second
  member in one of them, and one pending invitation — the fixture every future review needs
  in order to see a switcher with more than one row. Then `yarn emulators:export`.
- Close idea issue **#21** as absorbed.
- Commit, then the PR / checks / merge sequence in **Handoff**.
