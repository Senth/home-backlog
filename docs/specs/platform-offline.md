# Platform, auth and offline

How the app gets onto a device, who it lets in, what language it speaks, and what
survives losing the connection. Everything here is web behaviour — native builds exist
in the codebase but are unfinished and unverified
([#8](https://github.com/Senth/home-backlog/issues/8)).

## The shape of it

The app is an Expo / React Native Web PWA served by Firebase Hosting from a single
production project. Signing in with Google on the web is a redirect flow whose session
survives browser restarts; the app never renders a screen before it knows whether you
are signed in; and the signed-in identity is visible without a tap and signed out
deliberately.

Every user-facing string goes through `t()`, in `en-US` and `sv-SE`.

## Sign-in

**Google is the only method.** Settled in [`PROJECT.md`](../PROJECT.md). Sign in with
Apple remains a pre-launch task, required by the App Store wherever third-party sign-in
is offered.

### A redirect, not a popup

Web sign-in is `signInWithRedirect`. `signInWithPopup` is the smaller change and works
fine in a desktop tab, but it dead-ends in an installed PWA: the popup opens outside the
app shell and the result may never return to the opener — and the installed PWA is the
shipping product for the least technical person in [`PERSONAS.md`](../PERSONAS.md). A
redirect has no popup to block, no opener to lose, and one code path rather than a tab
path plus a standalone path that is the hardest of the two to test.

*Rejected:* popup everywhere (its failure mode is untestable and gets discovered by the
user, not the developer); popup on desktop and redirect in standalone (two paths, and
the one that matters is the one never exercised in review).

### `authDomain` is the app's own origin

A redirect's own weakness is Safari's third-party-storage blocking: Firebase's redirect
handler at `<project>.firebaseapp.com` is a different origin from the app, so the
handshake relies on cross-site storage Safari discards. Pointing `authDomain` at the
origin the app is served from removes the cross-site leg entirely — Firebase Hosting
reserves `/__/auth/` on every domain it serves, so `https://hb.senth.org/__/auth/handler`
is same-origin with the app.

`EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` carries it; with the key unset or blank the app falls
back to its own origin. The host has to be on the Firebase authorized-domain list *and*
`https://<host>/__/auth/handler` has to be an authorized redirect URI on the web OAuth
client — see [`OPERATIONS.md`](../OPERATIONS.md), which also covers the `ENV` secret the
deploy reads.

Local development is unaffected: `__DEV__` connects the Auth emulator, which serves its
own handler and its own account picker, so sign-in works without a real Google account.

### The account chooser is always forced

`prompt: 'select_account'` on every sign-in. Without it Google silently reuses whichever
account the browser saw last, so signing out and back in is a no-op that returns the same
wrong account — a person with a work and a personal Google account can be locked out of
their own board with no way back from inside the app. The cost is one extra tap on a
screen a persistent session means you see roughly never.

### Session persistence

`initializeAuth` is given the persistence chain explicitly:
`[indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence]`. That
array is Firebase's own default, so it changes no behaviour — it states the app's
headline promise in code, where a future Firebase major cannot quietly alter it.

The chain is kept rather than pinning IndexedDB alone: a browser that blocks IndexedDB
(a Firefox private window, some embedded webviews) would otherwise fail and make sign-in
impossible, where the chain degrades to a session-only login that still works.

Honest limits of "remembers your login":

| Environment | Session survives |
| ----------- | ---------------- |
| Chrome / Firefox / Edge, ordinary tab | Indefinitely |
| Installed PWA | Indefinitely |
| Private / incognito window | Until the window closes |
| Plain iOS Safari, not installed | ~7 days idle, then evicted |

That last row is not fixable by any web app. It is documented rather than mitigated.

### No profile document

This area reads and writes no Firestore document. Uid, display name, email and photo URL
all come from the `User` object the Auth SDK holds in memory and restores from local
persistence.

Worth stating rather than leaving implied: the "signed in as" line and the account menu
are exactly the kind of surface that invites a `users/{uid}` profile document, and adding
one would put a read on the app's startup path for data the SDK already has. There is no
`homes` read either — home creation does not exist yet.

Consequently there is no query-safety question here, and `firestore.rules` /
`storage.rules` say nothing about auth beyond `request.auth != null`, which they already
required.

## Startup, and never showing the wrong screen

`AuthGate` in `app/_layout.tsx` renders `<SplashScreen />` **in place of** `<Slot />`
until auth is unresolved — that is, until both the first `onAuthStateChanged` **and**
`getRedirectResult()` have settled. No route mounts, so no wrong screen can appear
underneath.

Awaiting the redirect result is what stops the login screen appearing for half a second
on the way back from Google: `onAuthStateChanged` can report "no user" before the
redirect credential has been exchanged.

That wait is capped at five seconds. The gate holds the entire router, and Firebase's
redirect resolver sits on a 30–60 s network timeout, so on lie-fi an already signed-in
user would stare at a splash — the exact failure the splash was built to prevent, in a
new costume. After the cap the app routes on what `onAuthStateChanged` alone has said; a
credential that lands later still arrives through it, which is the only path that can
sign anyone in. For the same reason the popup/redirect resolver is passed per call rather
than to `initializeAuth`, which would otherwise load the handler iframe — on that same
timeout — before the first `onAuthStateChanged` can fire at all.

The splash is the app mark, a spinner, and nothing else. It deliberately does not
resemble the login screen — a splash that looks like login is a login screen that keeps
refusing to accept a tap.

*Rejected:* a Projects skeleton (a signed-out visitor is shown a fake board — the same
lie in a nicer costume) and a blank surface (indistinguishable from a white-screen
crash).

The reason this matters more than it sounds: the app used to redirect to the tabs
immediately while the gate waited on `loading`, so a signed-out or still-restoring
visitor saw the empty Projects board flash before being bounced to login. On a phone in a
garage with no signal, that flash reads as *the app logged me out and my list is gone* —
and that user opens the app nowhere else.

## The login screen

One layout at every width: a Paper `Surface` centred in a `ScrollView` and clamped to
`contentWidth.form`, filling the screen below that. The `ScrollView` is what keeps the
screen usable at large text sizes — content that no longer fits scrolls instead of
clipping, and this is the one screen where clipping means locked out.

App mark, title, tagline, then the Google button. A blank line's worth of layout room is
left under the tagline for the "who invited you" context line of
[#22](https://github.com/Senth/home-backlog/issues/22), so adding it will not move the
button out from under anyone's thumb.

The button goes busy and disabled from the tap until the browser navigates away, so a
double tap cannot start two redirects. A user who cancels at Google's own screen comes
back with no result and no error, and simply sees the login screen again. A real failure
comes back through `mapAuthError()` into the screen's `Snackbar`.

## Identity, and the way out

`AccountMenu` sits in the app bar of all three tab screens, so it is in the same place
wherever the user is.

**Identity is visible without a tap.** Signing in with the wrong Google account produces
"No projects yet" — identical to a working app with an empty board, and identical to a
broken one. The fix is redundancy at no cost: the empty state names the signed-in
address, the app bar shows the display name beside the avatar at desktop widths, and the
menu header carries both. A phone app bar stays avatar-only for room, which is why the
empty-state line matters most there.

The avatar is the account photo where there is one, with initials underneath it. The
photo is a `googleusercontent.com` request, so the initials are painted *over* the image
and removed only once it has loaded: the app bar never shows a hole, never shifts layout,
and keeps the initials if the request fails or the user is offline.

**Sign out is two deliberate steps** — the menu holds it, and choosing it opens a
confirmation dialog. For the developer, sign-out is trivially reversible; for a
71-year-old whose phone has remembered her Google password since 2019, it is total loss
of access until a family member visits. Google sign-in only is settled, so the mitigation
has to be making sign-out hard to hit by accident rather than adding a second provider.

*Rejected:* sign-out on a Settings screen (there is no Settings screen, and nothing so
far has needed to invent one) and a menu with no dialog (a menu opened by accident still
has the cliff one tap away).

Paper gives a web dialog no focus management at all, so `useModalFocus` traps Tab inside
it, closes it on Escape, and hands focus back to the avatar that opened it — by ref, not
by `testID`, because every visited tab stays mounted and three identical `testID`s are in
the DOM at once. That same fact is why the trigger is `tabIndex={-1}` unless its own
screen is focused: otherwise the app bars of the screens you are *not* looking at keep
their place in the tab order, as invisible buttons that still open a menu. (`focusable`
does not work for this — React Native Web's `Pressable` always writes a `tabIndex` of its
own, and only falls back to `focusable` when none was given.)

`useAnchorFocusGuard` undoes a focus nobody asked for: a closed Paper `Menu` focuses its
own anchor on mount, so without it every screen and every tab change greeted the user
with a focus ring drawn around the one control that signs them out. It returns focus
where it came from rather than blurring, so activating a tab from the keyboard does not
leave focus on `<body>`.

The dialog's two actions wrap rather than sitting in a row that overflows the card —
below about 230 px, which is a phone at 200 % zoom, the unwrapped row pushed *Cancel* off
the screen and left only the destructive answer visible.

The menu is built as an *account* menu with room for more rows, not a sign-out drawer,
because "Switch home" ([#21](https://github.com/Senth/home-backlog/issues/21)) lands
here, and API keys will once the REST API exists
([#7](https://github.com/Senth/home-backlog/issues/7)) — web sign-out will not invalidate
an agent's key, and the menu should say so when keys exist.

## The keyboard focus ring

One CSS rule, app-wide, in `theme/focus-visible.ts` and injected by `app/+html.tsx` the
same way that file sources its `theme-color` metas — so the ring colour cannot drift from
`primary`, in either scheme.

It has to be CSS rather than a style prop. React Native Web compiles `outline*` style
props to atomic classes with no selector attached, so an outline in a style prop is
painted *always*: it decorates a control rather than indicating focus, and it leaves a
keyboard user with focused and unfocused rendering identically. React Native has no
`:focus-visible` equivalent, and `Pressable`'s `focused` state is true for a mouse click
too, so it would strand a ring behind after every tap.

Chrome's default — a 1 px near-black outline — is what this replaces, because it all but
disappears against a dark app bar.

## Offline

Firestore's offline persistence is configured with `persistentLocalCache` and the
multi-tab manager, so reads come from cache and writes queue until reconnect. The
multi-tab manager is what keeps an installed app and a browser tab from fighting over the
lease; with the single-tab manager the second one to open throws `failed-precondition`.

That only helps a session that already exists. Signed out with no connection, nothing in
the app works, and the UI says so rather than failing:

| State | Behaviour |
| ----- | --------- |
| Signed in, offline | Firestore serves cache; the offline bar shows the sync message. |
| Signed out, offline | Sign-in button disabled with an explanation; the offline bar says a connection is needed to sign in. |
| Goes offline mid-redirect | Returns `auth/network-request-failed`; the Snackbar shows the offline message. |
| Avatar photo unreachable | Initials render instead. No layout shift. |

`OfflineBar` sits above the router so it reaches every screen, and its wording depends on
whether there is a session: "changes are saved and will sync" is true signed in and a lie
signed out.

`useOnlineStatus()` reads `navigator.onLine` and is only ever used to *tell* the user.
Firestore queues its own writes and is never gated on it.

⚠️ Firebase **Storage has no offline write queue**. Photos captured without signal will
need a local pending-upload queue with retry. Nothing has shipped that uploads yet.

### A listener that fails is not an answer

A Firestore listener is **terminated by its own error callback**. It never reconnects, so
whatever the screen behind it had at that moment is what it keeps — and a query that has
never answered has nothing. The app cannot tell "nothing arrived" from "there is nothing",
so a single failed homes query rendered as *You are not in any home yet* to a household
with a full board, and a failed board rendered as *Nothing here yet. Add the first card.*
Neither healed without force quitting the app. That is #101, and a cold start on a phone
waking with an expired token and no connection up yet is exactly where it lives.

Every listener therefore opens through `subscribeWithRetry` in `data/live-query.ts`, which
re-opens a failed one three times — 400 ms, 1.2 s, 3 s — before reporting anything. The
waits grow because the failure it exists for is a connection that is not up *yet*; they
stop because a splash held longer than about five seconds is its own kind of broken. Every
snapshot that **answers** restores the budget, so a listener that has been up for an hour is
never one failure away from having none left.

Answering is the other half, and the half that bites first. **No listener has to fail for
#101 to happen.** Firestore raises its first event from the local cache, and on a phone
whose cache has been evicted that event is empty and `fromCache` — which the app read as
"there is nothing". The splash lifted on no homes, the ladder bounced to `/homes`, and the
household was told it was not in any home, with no error anywhere for a retry to catch.
`isQueryAnswer` is that rule written down: a snapshot answers when it is **not empty**, or
when the **server** sent it, or when we are **offline** and nothing better is coming. The
last clause is what keeps a genuinely empty board in a shed reading as empty rather than as
broken. Anything else is held, and held is not free — nothing better within the ladder's
own budget is a failure like any other.

`hooks/use-node.ts` has held this line for a single document since it shipped: *"Not in the
cache is not not there."* This is that rule for a query, and it needs the same
`{ includeMetadataChanges: true }` for the same reason — a server confirming that an empty
result is *still* empty changes nothing but `fromCache`, and Firestore suppresses
metadata-only events by default. Without it the hold would never release on a board that
really is empty.

Once the ladder is spent the screen **says so** rather than drawing the result as empty:
`useHome()` and `useNodes()` expose `failed` alongside `loading`, the empty state gives way
to `homes.loadFailed` / `board.loadFailed` / `detail.stepsFailed`, and a **Try again**
re-opens the listener. On `/homes` the create-a-home button goes with the empty state —
"could not load your homes" above "create a new home" is the same invitation to a duplicate
home, and a connection that could not run the query would not carry `createHome` either.

`failed` is never true while `loading` is. A board is two listeners that give up
independently, so without that a half-connected board would draw a spinner and a failure at
once, over a Try again that would tear down the half still arriving. For the same reason the
homes retry does **not** re-raise `loading`: that swaps the whole router for the splash, and
a retry that unmounts the screen its own button lives on is barely better than the force
quit it replaces. It reports itself on the button instead, through `retrying`.

*Rejected:* retrying forever (the splash never lifts, and `/homes` at least has a way
forward on it), and reporting the first failure straight to the user (on a cold start that
is a connection three hundred milliseconds from working).

## Install and updates

`InstallCard` captures Chrome's `beforeinstallprompt` and replays it at a moment that
makes sense, instead of leaving it to the browser's mini-infobar. Safari and Firefox
never fire the event, so the card simply does not render there and those users install
through the browser menu.

`public/sw.js` is a hand-rolled runtime-caching service worker — no Workbox, no precache
manifest, no build step. Assets are cached the first time they are used, which is enough
because the app cannot be used before signing in online once. Its routing table lives in
`public/sw-routing.js`, free of service worker globals so it can be unit tested directly,
and `importScripts` also makes the browser check it for updates.

The strategies: writes and cross-origin requests pass through untouched (Firestore, Google
auth and fonts run their own offline handling, and the Firestore write queue breaks if the
worker answers for it); **anything under `/__/` is passed straight through**, because
`authDomain` is now the app's own origin, which puts Firebase's OAuth handler on a path the
worker would otherwise treat as a navigation and cache as the app shell — sign-in would
then be answered by a cached copy of the app instead of by Google, and the cached shell
would be a Google page; navigations are network-first and store the single app shell,
never a per-route copy, because each exported HTML file names a content-hashed bundle and
a stale per-route copy would boot old app code on one route while others ran the new
build; content-hashed assets under `/_expo/static/` are cache-first forever; everything
else is stale-while-revalidate.

The worker never calls `skipWaiting()` on its own. A worker swap reloads the page, and a
reload loses whatever the user was typing — `UpdateBanner` offers the new build and the
user chooses. `VERSION` in `sw.js` is bumped whenever that file changes, so `activate`
drops the old cache.

## Language

`i18next`, initialised from the device locale, with `en-US` and `sv-SE` shipped from day
one. Both locale files are updated in the same change as any string.

`resolveLocale()` matches on the **language subtag**, not the full tag. Matching the full
tag is not enough: a device set to `sv`, `sv-FI` or `en-GB` would match no resource and
silently fall back to English — including for the Swedish speakers this app is partly
for. Every other language is treated as English. It is kept free of `expo-localization`
so it is testable in plain Node.

## Known gaps

- **iOS installed-PWA sign-in is unverified.** The redirect flow plus a same-origin
  `authDomain` is precisely the design that fixes the standalone dead-end, but confirming
  it needs a real iPhone against the real origin, and `main` deploys straight to
  production so there is no pre-merge origin that reproduces the configuration. No
  iOS-specific code ships for it.
- **iOS Safari's ~7-day storage eviction**, above. Not fixable in a web app.
- **Native auth.** `GoogleSignIn.tsx` keeps the `expo-auth-session` PKCE flow and
  `initializeAuth` runs without a persistence adapter, so a native app forgets the user on
  relaunch. Both are [#8](https://github.com/Senth/home-backlog/issues/8).
- **Switching between homes** — [#21](https://github.com/Senth/home-backlog/issues/21).
  The account menu is shaped to hold the row; it does not hold it yet.
- **Telling a visitor what the app is, or who invited them** —
  [#22](https://github.com/Senth/home-backlog/issues/22). Layout room is reserved.
- **The redirect's edges are the browser's, not ours.** A back-navigation straight after
  signing in leaves the app for Google's chooser rather than returning to the board, and
  losing the connection between the tap and the handler lands on the browser's own error
  page — the app is not running at that moment, so it cannot say anything better. Both
  are known and unhandled.
