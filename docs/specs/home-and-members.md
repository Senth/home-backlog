# Homes and members

A home is the container everything else in the app lives in.
[Nodes](boards-and-nodes.md), locations and recurring rules all hang off one, membership
decides who can read them, and no other feature can be built until a home exists and the
app knows which one is active.

This spec covers creating a home, moving between several, managing a home's name and its
people, inviting somebody by email address, and joining a home you were invited to.

## The shape of it

`homes/{homeId}` carries a `members` map of uid → `'owner' | 'member'`, and every
subcollection rule resolves membership by reading it. `/homes` is a real route above the
boards where you pick which home you are in. Invitations live in a subcollection, keyed
by a hash of the invitee's address, and must be explicitly accepted.

Nothing is delivered to an invitee. There is no email and no link — see
[Invitations are found, not delivered](#invitations-are-found-not-delivered), which is
the honest limit of the feature.

## Data

### `homes/{homeId}`

| Field | Type | Notes |
| ----- | ---- | ----- |
| `name` | `string` | 1–60 characters, validated in rules |
| `members` | `map<uid, 'owner' \| 'member'>` | at least one `'owner'`, always |
| `memberProfiles` | `map<uid, { displayName: string, photoURL: string \| null }>` | each member writes their own |
| `memberEmailHashes` | `map<uid, string>` | `sha256(lowercased email)`, hex; each member's own must equal their token's |
| `createdAt` | `Timestamp` | |
| `createdBy` | `uid` | |

### `homes/{homeId}/invites/{sha256(lowercased email)}`

| Field | Type | Notes |
| ----- | ---- | ----- |
| `emailHash` | `string` | equals the document id — validated in rules, so the collection-group query cannot be poisoned with somebody else's hash |
| `email` | `string` | plaintext, readable only by this home's owners |
| `role` | `'owner' \| 'member'` | what accepting grants |
| `homeName` | `string` | denormalized — the invitee cannot read the home doc |
| `invitedByName` | `string` | denormalized — the invitee cannot read `memberProfiles` |
| `createdAt` | `Timestamp` | orders the owner's pending list |

### `members` keeps its shape; profiles sit beside it

Six rule expressions read `members` as uid → role string. Widening its values to objects
to carry names would rewrite all of them and every test, for nothing the sibling maps do
not give. So the home doc gains `memberProfiles` and `memberEmailHashes` instead.

Addresses of **members** are never stored in readable form. An owner matches a typed
address against `memberEmailHashes` by hashing it — enough to answer "already a member?"
and "that's you?" without exposing anyone's address to whoever is holding the phone. A
**pending** invite does carry the plaintext `email`, readable only by that home's owners,
because they typed it: a bare hash makes a typo invisible on both ends and leaves no way
to withdraw or resend by person. It disappears with the invite when it is consumed.

Future per-user settings belong in a `users/{uid}` document readable only by that user.
This feature does not create one; it is named here so the next feature that needs private
per-user state knows where it goes, and knows it does not go on the home doc.

## Queries

Three, each one shaped so that *every document it can match* is one the caller may read.
Firestore rejects an entire query if any matching document could be denied, so being
rule-safe is not enough. The node queries follow the same discipline — see
[`boards-and-nodes`](boards-and-nodes.md), where the two halves of a board load each
constrain one disjunct of the node read rule.

**The homes I belong to** — fired once per session by `HomeProvider`.

```ts
query(collection(db, "homes"),
      where(new FieldPath("members", uid), "in", ["owner", "member"]))
```

Provably safe: a home where I am not a member has no `members.<uid>` subfield, so it
cannot match, and every document that *can* match satisfies `allow get, list:
if memberOfThis()`. Listener breadth is the number of homes I belong to — one to three.
Map subfields are indexed automatically; no composite index.

**My pending invitations** — fired while the homes list is on screen, which is the only
place an invitation can be acted on.

```ts
query(collectionGroup(db, "invites"),
      where("emailHash", "==", emailHash(myEmail)))
```

Provably safe: every matching document carries *my* hash by definition, which is exactly
the condition the collection-group read rule tests. `homeId` for the accept and decline
writes comes from `snapshot.ref.parent.parent.id`.

This one needs the `emailHash` entry in `firestore.indexes.json`. Firestore's automatic
single-field indexes are COLLECTION-scoped, and a collection-group filter needs a
COLLECTION_GROUP-scoped one declared. The emulator indexes everything on the fly and so
can never surface the omission — it would appear only in production, as an invitee who
can never find an invitation that was really sent. A field override *replaces* automatic
indexing for the field, so the two default COLLECTION-scoped indexes are restated there
rather than lost.

**Pending invitations for a home** — fired only on the manage screen, and only by an owner.

```ts
query(collection(db, "homes", homeId, "invites"), orderBy("createdAt", "desc"))
```

Provably safe *for an owner*: `isOwner(homeId)` is resource-independent, so it holds for
every document in the collection. A non-owner member must never fire it — for them some
documents would be denied and the whole query would fail. The hook takes that as an
explicit `enabled` gate rather than trusting the screen to render correctly.

**Accepting** writes with dotted field paths, so nothing that is not readable has to be
read first:

```ts
updateDoc(doc(db, "homes", homeId), {
  [`members.${uid}`]: invite.role,
  [`memberProfiles.${uid}`]: { displayName, photoURL },
  [`memberEmailHashes.${uid}`]: myHash,
});
```

## Invitations

### Invites are keyed by a hash of the email address, and must be accepted

The invite lives at `homes/{homeId}/invites/{sha256(lowercased email)}`. The invitee signs
in with that Google account, finds the invite, and explicitly joins. Nobody is added to a
household they did not agree to join, and the rules — not the UI — are what guarantee it:
`acceptsInvite()` lets the invitee add **only their own uid**, with **only the role the
invite grants**, and only with a verified email.

*Rejected:* adding people directly by uid. The owner does not know anyone's uid, only
their address, and a direct add would let anyone drop anyone else into a household.

### Invites are found with a collection-group query

The invitee cannot read the home doc, and does not know `homeId`. They therefore cannot
reach the invite by path. `documentId()` in a collection-group query compares the **full
document path**, not the last segment, so the hash in the key is not queryable either.

So the hash is **also** stored as a field, `emailHash`, found under a
`match /{path=**}/invites/{id}` read rule. The invite denormalizes `homeName` and
`invitedByName` because the invitee can read neither the home nor its members.

*Rejected:* `users/{uid}/invites/{homeId}` mirror docs. Trivially query-safe, and
unwriteable — at invite time the owner has an address, not a uid.

### Case folding is ASCII-only, on both sides, deliberately

`firestore.rules` folds case with CEL's `lower()`, which leaves every non-ASCII letter
alone. `emailHash()` in `models/home.ts` mirrors that exactly, with an ASCII-only fold,
and a rules test with an uppercase non-ASCII address proves the two agree.

This is load-bearing rather than fussy. The rules compare *their* hash of your token email
against the `memberEmailHashes` entry you wrote, so a client that folded further would be
refused its own entry — and that entry is required to create a home and to accept an
invitation. Using JavaScript's `toLowerCase()` meant a user whose Google address carried
an uppercase Ä, Ö or Å could do neither, with nothing on screen to explain why.

The other half of the problem is that an owner typing `Märta@Exempel.se` still has to
reach an invitee whose provider address is `märta@exempel.se`. So `normalizeEmail()` does
the fuller fold on **what a person types**, once, before it is hashed or stored — while
the hashing itself stays an exact mirror of the rule.

One residual case survives and cannot be fixed in CEL: an invitee whose *provider* address
carries an uppercase non-ASCII letter is still unreachable, because the owner-typed side
folds it fully and the token side does not. That is strictly narrower than the bug it
replaced, where such an account could not create or join any home at all. **Do not widen
`lowerAscii()` alone** — it reopens the blocking half.

### Invitations are found, not delivered

**This is the honest limit of the feature and must not be papered over.** Nothing is
delivered to the invitee. They discover the invitation the next time they open the app.
Somebody telling them out of band is the notification channel, and the confirmation says
so in as many words — "They will see it the next time they open Home Backlog" — rather
than implying a message went somewhere.

An invite *link* was designed and dropped. Once invitations are findable in-app, a link's
only remaining value is the pre-auth line "Marcus invited you to Villa Solberg" — and
buying that costs a `/join/[homeId]` route, display text carried in attacker-controllable
query parameters, and pending state that has to survive `signInWithRedirect`. That last
one is a defect in its own right: the redirect eats the URL, the invitee lands on
onboarding, creates a second empty household, and there is no merge path. Dropping the
link removes the failure rather than handling it. The trust line survives in post-auth
form, on the pending-invite card. Revisit when there is a reason; the data model needs no
change for it.

*Rejected alongside it:* **link-only discovery**, where the invitee must be sent a URL.
That is the version where the least technical person in [`PERSONAS.md`](../PERSONAS.md)
is lost — she will not go looking, and a link she never taps is an invitation that never
existed.

### Joining is server-confirmed, and never optimistic

`acceptsInvite()` is evaluated on the server, so a queued write would show membership
locally and then revert. Nor is it enough to route on the resolved promise: the tab layout
sends you straight back to `/homes` while the new home is not yet on the homes listener,
and that bounce is exactly what routing on the write alone produces. The Join button holds
its pending state until the home has actually arrived, and only then carries you into it.

That pending state belongs to the `/homes` screen rather than to the invitation card.
Accepting deletes the invitation, the delete applies locally at once, and a card that
unmounted with the last invitation would take the waiting effect with it — stranding the
invitee on the screen they started from.

Clearing the consumed invitation is deliberately not awaited into the result. Membership
landing is what joining means; telling somebody "could not join" while they are already a
member is the one wrong answer available. A leftover invite is harmless — accepting it
again is a no-op write of membership they already have.

## Rules

Beyond membership, three invariants live in `firestore.rules` rather than in a component,
so the REST API ([`rest-api`](rest-api.md)) inherits them.

### A home always has a name and an owner

`validHome()` requires a name of 1–60 characters and at least one `'owner'`, on create and
on every update branch.

Nothing may leave a home with zero owners: the remaining members could edit nodes forever
but never invite, never remove and never delete, and no action inside the app could
recover it. The sole owner therefore cannot demote themselves, cannot remove themselves,
and cannot step down until somebody else is an owner.

### You may only ever claim your own address

`memberEmailHashes[uid]` must equal the hash of your own token email, on create and on
update, for owners as much as for members. Without it anyone could plant somebody else's
hash on themselves and be mistaken for them by the "already a member?" check.

A member may write their own `memberProfiles` and `memberEmailHashes` entries and nobody
else's. An owner may write anyone's, because removing a member has to remove theirs too.

### Leaving, and a deliberately narrow delete

`leavesHome()` lets a member remove **exactly themselves** — not another member on the
way out, not the home's name, and not their own role, since it requires that you end up
gone rather than merely different. Without it only owners could ever leave, because the
member update branch requires `members` to be unchanged. `validHome()` still applies,
which is what traps the last admin until they promote somebody.

Deleting a home doc does **not** delete its [`nodes`](boards-and-nodes.md), `locations`
and `recurring`. Every
one of those rules resolves membership through a `get()` on the home doc, so once it is
gone those documents are unreachable by anyone, permanently, while still stored. There is
no Cloud Function to cascade — [#1](https://github.com/Senth/home-backlog/issues/1) is
open and unbuilt, and [#39](https://github.com/Senth/home-backlog/issues/39) covers the
atomicity gap and the exact private-node counts.

Delete is therefore offered only when you are the home's **sole member**, where the
client-side cascade is bounded and usually empty, and where it cannot revoke anyone else's
access as a side effect. It exists at all because the last-owner rule otherwise traps a
sole owner with every home they ever created by accident.

Pending invitations *are* cascaded, and must be: every invite rule resolves ownership
through a `get()` on the home doc, so once the home is gone nobody can delete them — while
the collection-group read never touches the home at all, so an invitee would go on seeing
an invitation to a household that no longer exists. They are deleted first, while the home
is still there to prove ownership.

## Navigation

### The switcher is a level of navigation, not a menu

`/homes` is a real route above the boards. The app bar shows where you are: the home's own
name on a board, "My homes" one level up. Switching is going up and picking another.

This answers a real failure — somebody records cabin work on the house board because
nothing on screen said which home they were in — with the same rule
[`platform-offline`](platform-offline.md) already applies to identity: **visible without a
tap**. It also keeps leave and delete two levels away from the row people tap most often,
instead of adjacent to it in a menu.

*Rejected:* a switcher row in the account menu (the shape idea issue #21 proposed, now
absorbed). It leaves the active home invisible until tapped, and puts destructive rows in
the menu used for switching.

### Which home the app opens into

`HomeProvider` resolves in this order, and the splash holds the router until it has:

```
persisted home id, and I am still a member of it  → that home
exactly one home                                   → that home
no homes                                           → /homes (onboarding)
several homes, no valid persisted id               → /homes
```

The ladder is a pure function and is unit-tested. Falling back to "the first home" for the
last case was rejected: with two homes and no answer, picking one silently is the failure
above. Returning nothing sends you one level up to a screen that names both, which is a
question rather than a guess.

The persisted id lives in `AsyncStorage`. Being removed from the active home, or deleting
it, lands in the first case with an id that no longer matches and drops back to `/homes`.

`app/(app)/(tabs)/_layout.tsx` returns `<Redirect href="/homes" />` when there is no active
home, so the tab routes never mount — the same declarative, during-render pattern
`app/(app)/_layout.tsx` already uses for auth. `/homes` lives outside `(tabs)`, so there is
no redirect loop. `HomeProvider` mounts inside the resolved-auth half of the tree and never
races it.

## Screens

### `/homes` — "My homes", and the empty state that is onboarding

A list of homes, each with the name as the title, the member count as the description, a
check on the active one, and a chevron into manage. Tapping the row switches to that home
and goes to the boards; the chevron goes to manage instead. Below, pending invitations
render as cards — "Marcus invited you to Villa Solberg" — with Join and Decline. Below
that, a button opens a dialog with a single field prefilled `{{name}}'s home`.

With no homes and no invitations this same screen *is* onboarding: one prefilled field and
one button, no wizard and no choice screen.

Which is exactly why an empty list has to be an *answer* and never a failure. When the homes
query has spent its retry ladder, `useHome()` reports `failed` and this screen shows
`homes.loadFailed` and a **Try again** in place of both the empty state and the create
button — an onboarding screen offered to somebody who has had a home for a year is the app
believing a broken connection, and the second household it produces has no merge path back
(see the note above on why that is unrecoverable). A connection that could not run the query
would not carry `createHome` either, so nothing is lost by taking the button away until the
retry succeeds.

The retry does **not** re-raise `loading`: that would swap the whole router for the splash
and unmount this screen mid-retry, taking the Try again button and the `joining` state with
it. It reports itself on the button, through `retrying`. The ladder itself is in
`docs/specs/platform-offline.md`.

The account menu is in this app bar too. The gate sends a home-less person here and the
boards are unreachable until a home exists, so without it there would be no way to sign
out.

### `/homes/[homeId]` — manage

The back arrow goes **up** to `/homes` rather than calling `router.back()`. This screen is
reachable with no in-app history — a reload, a bookmark, a pasted URL — and there `back()`
is a no-op that logs "GO_BACK was not handled by any navigator" and leaves the arrow dead.
The destination is the same either way, so it is named.

- **Name** — a field and a Save button. Any member may rename.
- **Members** — a row per person with their avatar, a role chip, "You" on your own row,
  and for an owner an overflow menu with Make admin / Make member / Remove. Actions that
  would leave no admin are disabled with "Make someone else an admin first."
- **Invite someone** (owners only) — a field for the address, Member / Admin, and Send.
- **Pending invitations** (owners only) — a row per invite showing the plaintext address
  and its age, with a withdraw button.
- **Danger zone** — Leave this home, and Delete this home when you are its sole member,
  each behind a confirmation. The remove-member dialog says that anything only that person
  could see — their private tasks — stops being visible to anyone. The delete dialog names
  the home and states that every project, location and maintenance task in it is deleted.

A home you are alone in shows no members section and no pending section: one quiet "Invite
someone" action and nothing else, so a solo household never meets the concept.

### The boards

A back action up to `/homes`, the home's **name** as the title, and the existing account
menu on the right. The bottom tab bar already names the screen, so `screen.*.title` is
retired as an app-bar title; the empty-state strings stay.

## Component notes

Two Paper behaviours are worked around in shared components, because both are easy to
reintroduce by accident.

**`AppDialog` takes its actions as an array, never a fragment.** `Dialog.Actions` clones
each of its children to inject `compact` and the inter-button margin; a fragment absorbs
both, React logs "Invalid prop `compact` supplied to `React.Fragment`" for every dialog
the app opens, and Paper's action spacing never lands. The prop type enforces it.

**A row that carries controls but is not itself tappable uses `Row`, not `List.Item`.**
`List.Item` renders its row as a `TouchableRipple`, whose `disabled` is
`disabledProp || !hasPassedTouchHandler` — so a row with no `onPress` sets
`aria-disabled="true"` on itself, and everything nested inside inherits it. That made the
member overflow menu unopenable and announced the withdraw button as disabled. Rows that
really are tappable keep `List.Item`.

**A `SegmentedButtons` segment is as tall as its label box, and nothing else.** Paper
hard-codes `paddingVertical: 9` on the segment content and exposes no prop that reaches
the pressable: there is no `contentStyle`, `density` only makes it smaller, and `hitSlop`
is honoured by React Native Web's legacy `Touchable` but not by the `Pressable` Paper
renders. A `minHeight` on the segment inflates the *box* and leaves the tap target at
38px. Growing the label's line height is what grows the target — see
`segmentedLabelLineHeight`.

**`returnFocusTo` must reach a focusable node.** Paper's `Button` forwards its ref to the
outer `Surface` and keeps the pressable on a private `touchableRef`, so a ref to a
`Button` points at a plain `div` with no tabindex; focusing it drops focus on `<body>`,
which is the failure the prop exists to prevent. `useModalFocus` therefore focuses the
first focusable *inside* the referenced node, falling back to the node itself.

**One anchor ref per row, never one beside a `.map()`.** A single ref shared across a list
holds whichever row rendered last, so a dialog opened from the first row would return
focus to the last one — worse than the fallback it overrides. Each row is its own
component and owns its ref and its dialog.

## Offline

Creating a home, sending an invitation, joining and declining all require a connection and
are disabled with a hint, the way the login screen already treats sign-in — their writes
resolve only on server acknowledgement, so offline they would hang rather than fail. The
guard is repeated inside the submit handlers, because Enter in a text field reaches them
without going through the disabled button.

Reading the homes list works offline from Firestore's cache. Renaming and role changes
queue normally, and renaming deliberately does not await the server: Firestore applies it
locally at once and the listener already shows the new name, so waiting would spin a
button over a change that has visibly happened.

## Vocabulary

The UI noun is **Home** / **hem**, but the app prefers the home's *own* name — "Huset",
"Stugan" — and uses the noun only where a word is unavoidable ("Create a new home" /
"Skapa ett nytt hem"). A cabin is not a *hem*; it is *stugan*, and a switcher built from
two named rows asks nobody to learn anything.

"Home" does not collide with the house in the Locations tree — they are deliberately the
same thing. The post-MVP dashboard in [`PROJECT.md`](../PROJECT.md) is called **Overview**
/ **Översikt** so it does not take the word.

The `owner` role is labelled **Admin** / **Administratör** in the UI while staying `owner`
in the data. On a family-shared cabin, "ägare" makes a claim about the deed;
"administratör" describes what the person can do in the app.

`sv-SE` uses *hen* for a member of unknown gender.

## Out of scope

- **Invite links and the pre-auth trust line** — no `/join` route ships. Idea issue #22
  keeps the reserved line on the login screen; the post-auth pending-invite card carries
  the inviter and home name instead.
- **Sending email.** No invitation is delivered anywhere. Discovery is in-app only.
- **A Cloud Function cascade** for home deletion and member removal, and exact
  private-node counts in the remove dialog — #39, which shares machinery with #1.
- **Bootstrap over REST.** Creating a home, inviting and accepting an invitation stay
  human-only — #38. An API key is scoped to a *person* and reaches every home they are
  already a member of ([`rest-api`](rest-api.md)), so it can never bring the first one into
  existence, and `SKILL.md` says so. What a member's key *can* do is write into any home
  they belong to, which is why every home lists the automations that have written into it,
  read-only, on its manage screen.
- **A `users/{uid}` settings document.**
- Transferring ownership as a single explicit action (promote, then demote yourself),
  per-home preferences, and archiving a home instead of deleting it.
