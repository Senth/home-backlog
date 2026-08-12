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

The menu is built as an *account* menu with room for more rows, not a sign-out drawer,
because "Switch home" ([#21](https://github.com/Senth/home-backlog/issues/21)) lands
here, and API keys will once the REST API exists
([#7](https://github.com/Senth/home-backlog/issues/7)) — web sign-out will not invalidate
an agent's key, and the menu should say so when keys exist.

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
worker answers for it); navigations are network-first and store the single app shell,
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
