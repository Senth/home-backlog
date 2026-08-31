# Platform, auth and offline

How the app gets onto a device, who it lets in, what language it speaks, and what
survives losing the connection. Everything here is web behaviour. Native builds exist
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
fine in a desktop tab, but it dead-ends in an installed PWA. The popup opens outside the
app shell and the result may never return to the opener, and the installed PWA is the
shipping product for the least technical person in [`PERSONAS.md`](../PERSONAS.md). A
redirect has no popup to block, no opener to lose, and one code path rather than a tab
path plus a standalone path that is the hardest of the two to test.

*Rejected:* popup everywhere (its failure mode is untestable and gets discovered by the
user, not the developer); popup on desktop and redirect in standalone (two paths, and
the one that matters is the one never exercised in review).

### `authDomain` is the app's own origin

A redirect's own weakness is Safari's third-party-storage blocking. Firebase's redirect
handler at `<project>.firebaseapp.com` is a different origin from the app, so the
handshake relies on cross-site storage Safari discards. Pointing `authDomain` at the
origin the app is served from removes the cross-site leg entirely. Firebase Hosting
reserves `/__/auth/` on every domain it serves, so `https://hb.senth.org/__/auth/handler`
is same-origin with the app.

`EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` carries it; with the key unset or blank the app falls
back to its own origin. The host has to be on the Firebase authorized-domain list *and*
`https://<host>/__/auth/handler` has to be an authorized redirect URI on the web OAuth
client. The deploy reads `.env.local` from the `ENV` secret in the `prod` GitHub
environment; refresh it with `gh secret set ENV --env prod < .env.local` whenever the
file changes.

Local development is unaffected. `__DEV__` connects the Auth emulator, which serves its
own handler and its own account picker, so sign-in works without a real Google account.

### The account chooser is always forced

`prompt: 'select_account'` on every sign-in. Without it Google silently reuses whichever
account the browser saw last, so signing out and back in is a no-op that returns the same
wrong account. A person with a work and a personal Google account can be locked out of
their own board with no way back from inside the app. The cost is one extra tap on a
screen a persistent session means you see roughly never.

### Session persistence

`initializeAuth` is given the persistence chain explicitly:
`[indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence]`. That
array is Firebase's own default, so it changes no behaviour. It states the app's
headline promise in code, where a future Firebase major cannot quietly alter it.

The chain is kept rather than pinning IndexedDB alone. A browser that blocks IndexedDB
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
are exactly the kind of feature that invites a `users/{uid}` profile document, and adding
one would put a read on the app's startup path for data the SDK already has. One read does
sit on that path, `HomeProvider`'s homes listener, and it belongs to
[`home-and-members`](home-and-members.md) rather than here. Auth adds nothing beside it.

Consequently there is no query-safety question here, and `firestore.rules` /
`storage.rules` say nothing about auth beyond `request.auth != null`, which they already
required.

## Startup, and never showing the wrong screen

`AuthGate` in `app/_layout.tsx` renders `<SplashScreen />` in place of `<Slot />`
while auth is unresolved, that is, until both the first `onAuthStateChanged` and
`getRedirectResult()` have settled. No route mounts, so no wrong screen can appear
underneath.

Awaiting the redirect result is what stops the login screen appearing for half a second
on the way back from Google. `onAuthStateChanged` can report "no user" before the
redirect credential has been exchanged.

That wait is capped at five seconds. The gate holds the entire router, and Firebase's
redirect resolver sits on a 30–60 s network timeout, so on lie-fi an already signed-in
user would stare at a splash, which is the exact failure the splash was built to prevent,
in a new costume. After the cap the app routes on what `onAuthStateChanged` alone has
said; a credential that lands later still arrives through it, which is the only path that
can sign anyone in. For the same reason the popup/redirect resolver is passed per call
rather than to `initializeAuth`, which would otherwise load the handler iframe, on that
same timeout, before the first `onAuthStateChanged` can fire at all.

The splash is the app mark, a spinner, and nothing else. It deliberately does not
resemble the login screen. A splash that looks like login is a login screen that keeps
refusing to accept a tap.

*Rejected:* a Projects skeleton (a signed-out visitor is shown a fake board, the same
lie in a nicer costume) and a blank screen (indistinguishable from a white-screen
crash).

This matters more than it sounds. The app used to redirect to the tabs immediately while
the gate waited on `loading`, so a signed-out or still-restoring visitor saw the empty
Projects board flash before being bounced to login. On a phone in a garage with no signal,
that flash reads as *the app logged me out and my list is gone*, and that user opens the
app nowhere else.

## The login screen

One layout at every width: a Paper `Surface` centred in a `ScrollView` and clamped to
`contentWidth.form`, filling the screen below that. The `ScrollView` is what keeps the
screen usable at large text sizes. Content that no longer fits scrolls instead of
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
"No projects yet", identical to a working app with an empty board, and identical to a
broken one. The fix is redundancy at no cost: the empty state names the signed-in
address, the app bar shows the display name beside the avatar at desktop widths, and the
menu header carries both. A phone app bar stays avatar-only for room, which is why the
empty-state line matters most there.

The avatar is the account photo where there is one, with initials underneath it. The
photo is a `googleusercontent.com` request, so the initials are painted *over* the image
and removed only once it has loaded. The app bar never shows a hole, never shifts layout,
and keeps the initials if the request fails or the user is offline.

**Sign out is two deliberate steps.** The menu holds it, and choosing it opens a
confirmation dialog. For the developer, sign-out is trivially reversible; for a
71-year-old whose phone has remembered her Google password since 2019, it is total loss
of access until a family member visits. Google sign-in only is settled, so the mitigation
has to be making sign-out hard to hit by accident rather than adding a second provider.

*Rejected:* sign-out on a Settings screen (there is no Settings screen, and nothing so
far has needed to invent one) and a menu with no dialog (a menu opened by accident still
has the cliff one tap away).

Paper gives a web dialog no focus management at all, so `useModalFocus` traps Tab inside
it, closes it on Escape, and hands focus back to the avatar that opened it, by ref rather
than by `testID`, because every visited tab stays mounted and three identical `testID`s
are in the DOM at once. That same fact is why the trigger is `tabIndex={-1}` unless its
own screen is focused. Otherwise the app bars of the screens you are *not* looking at
keep their place in the tab order, as invisible buttons that still open a menu.
(`focusable` does not work for this. React Native Web's `Pressable` always writes a
`tabIndex` of its own, and only falls back to `focusable` when none was given.)

`useAnchorFocusGuard` undoes a focus nobody asked for. A closed Paper `Menu` focuses its
own anchor on mount, so without it every screen and every tab change greeted the user
with a focus ring drawn around the one control that signs them out. It returns focus
where it came from rather than blurring, so activating a tab from the keyboard does not
leave focus on `<body>`.

The dialog's two actions wrap rather than sitting in a row that overflows the card. Below
about 230 px, which is a phone at 200 % zoom, the unwrapped row pushed *Cancel* off the
screen and left only the destructive answer visible.

The menu is built as an *account* menu with room for more rows, not a sign-out drawer,
and that room is now used. An Automations row
([#7](https://github.com/Senth/home-backlog/issues/7)) sits above the divider and sign out
stays last; [`rest-api`](rest-api.md) covers what it opens. Switching home went the other
way. [#21](https://github.com/Senth/home-backlog/issues/21) proposed a row here, and it
shipped as the `/homes` route instead, a level above the boards rather than a line in the
menu used to reach it, for the reasons [`home-and-members`](home-and-members.md) records.

One thing the menu still does not say: web sign-out does not invalidate an agent's key.
Keys exist now, and `account.signOut.body` promises only that you will need to sign in
again.

## The palette

Green is the brand colour, deliberately unlike the sibling project's purple so the two
apps are distinguishable in a tab strip or app switcher. It also leaves red and amber free
to mean *overdue* and *waiting* on a board. `warning` and `success` are additions rather
than MD3 roles, which is why `useAppTheme()` exists at all — Paper's own `useTheme()` does
not carry their types.

**The neutrals are re-hued off Material's default.** MD3's stock `neutral` and
`neutralVariant` families lean violet: the outline everyone reads as white is
`rgb(147,143,153)`, a violet grey. `primary` was overridden to green when the app was
built and the neutrals never were, so every grey surface in the app quietly fought the
brand.

They are re-neutralised by **preserving each Material tone's exact relative luminance and
changing only its hue** — chroma 0.016 at hue 150:

| role | Material | here |
|---|---|---|
| `n10` — dark bg/surface, light `onSurface` | `rgb(28,27,31)` | `rgb(22,29,23)` |
| `n20` — light `inverseSurface` | `rgb(49,48,51)` | `rgb(43,51,44)` |
| `n90` — dark `onSurface` | `rgb(230,225,229)` | `rgb(219,230,221)` |
| `n95` — light `inverseOnSurface` | `rgb(244,239,244)` | `rgb(233,244,235)` |
| `n99` — light bg/surface | `rgb(255,251,254)` | `rgb(244,255,246)` |
| `nv30` — light `onSurfaceVariant` | `rgb(73,69,79)` | `rgb(64,73,66)` |
| `nv50` — light `outline` | `rgb(121,116,126)` | `rgb(111,120,113)` |
| `nv60` — dark `outline` | `rgb(147,143,153)` | `rgb(138,148,139)` |
| `nv80` — light `outlineVariant` | `rgb(202,196,208)` | `rgb(191,201,192)` |
| `nv90` — light `surfaceVariant` | `rgb(231,224,236)` | `rgb(219,230,221)` |

The largest luminance delta across the ramp is 6.5e-03, so **every contrast ratio in the
app is unchanged by construction** and a repaint of every surface cannot regress an axe
check anywhere. That is what makes an app-wide palette change safe to make at all, rather
than a re-audit of every screen.

These are tones, not roles. Both palettes assign them to the MD3 roles Paper already
reads — `background`, `surface`, `surfaceVariant`, `onSurface`, `onSurfaceVariant`,
`outline`, `outlineVariant`, `inverseSurface`, `inverseOnSurface` — so every Paper
component follows without a call site changing. `surfaceDisabled`, `onSurfaceDisabled` and
`backdrop` are alpha compositions of the same tones and are derived the same way.

Paper's `elevation` levels are opaque colours rather than shadows on web, so they are part
of the ramp too, and are re-hued with it:

| level | Material light | here | Material dark | here |
|---|---|---|---|---|
| `level1` | `rgb(247,243,249)` | `rgb(237,247,239)` | `rgb(37,35,42)` | `rgb(30,38,32)` |
| `level2` | `rgb(243,237,246)` | `rgb(231,242,233)` | `rgb(44,40,49)` | `rgb(36,43,37)` |
| `level3` | `rgb(238,232,244)` | `rgb(226,237,228)` | `rgb(49,44,55)` | `rgb(40,48,41)` |

Levels 4 and 5 are left as Paper ships them: `elevation` in `theme/tokens.ts` stops at
`high: 3`, so nothing in this app can reach them.

The board adds four named colours of its own on top of this ramp — a recessed column, a
raised card, the card's border and the muted step count. They are the board's own surfaces
and [`boards-and-nodes`](boards-and-nodes.md#the-boards-surfaces) records why they exist.

### The navigators are themed too, or they paint their own grey

Paper's theme reaches every Paper component, but not the navigators. A `Stack` or `Tabs`
left alone reads react-navigation's own `DefaultTheme`, which paints `rgb(242,242,242)` as
the full-screen background behind every route and `rgb(216,216,216)` as the desktop tab
bar's top border. Neither belongs to any palette here, and both sit underneath screens
that are painting the real one — so the wrong grey shows exactly where a screen does not
cover its own background.

So the root layout wraps the app in react-navigation's `ThemeProvider` and maps Paper's
roles onto navigation's, in both schemes: `primary` to `primary`, `background` to
`background`, `surface` to `card`, `onSurface` to `text`, `outlineVariant` to `border`
and `error` to `notification`. All six of navigation's roles are assigned, because a role
left out falls back to the same stock grey the mapping exists to remove.

## The keyboard focus ring

One CSS rule, app-wide, in `theme/focus-visible.ts` and injected by `app/+html.tsx` the
same way that file sources its `theme-color` metas, so the ring colour cannot drift from
`primary`, in either scheme.

It has to be CSS rather than a style prop. React Native Web compiles `outline*` style
props to atomic classes with no selector attached, so an outline in a style prop is
painted *always*. It decorates a control rather than indicating focus, and it leaves a
keyboard user with focused and unfocused rendering identically. React Native has no
`:focus-visible` equivalent, and `Pressable`'s `focused` state is true for a mouse click
too, so it would strand a ring behind after every tap.

Chrome's default, a 1 px near-black outline, is what this replaces, because it all but
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

**Firebase Storage has no offline write queue.** Photos captured without signal will
need a local pending-upload queue with retry. Nothing has shipped that uploads yet.

### A listener that fails is not an answer

A Firestore listener is terminated by its own error callback. It never reconnects, so
whatever the screen behind it had at that moment is what it keeps, and a query that has
never answered has nothing. The app cannot tell "nothing arrived" from "there is nothing",
so a single failed homes query rendered as *You are not in any home yet* to a household
with a full board, and a failed board rendered as *Nothing here yet. Add the first card.*
Neither healed without force quitting the app. That is #101, and a cold start on a phone
waking with an expired token and no connection up yet is exactly where it lives.

Every listener therefore opens through `subscribeWithRetry` in `data/live-query.ts`, which
re-opens a failed one three times, at 400 ms, 1.2 s and 3 s, before reporting anything. The
waits grow because the failure it exists for is a connection that is not up *yet*; they
stop because a splash held longer than about five seconds is its own kind of broken. Every
snapshot that answers restores the budget, so a listener that has been up for an hour is
never one failure away from having none left.

Answering is the other half, and the half that bites first. **No listener has to fail for
#101 to happen.** Firestore raises its first event from the local cache, and on a phone
whose cache has been evicted that event is empty and `fromCache`, which the app read as
"there is nothing". The splash lifted on no homes, the ladder bounced to `/homes`, and the
household was told it was not in any home, with no error anywhere for a retry to catch.
`isQueryAnswer` is that rule written down: a snapshot answers when it is not empty, when
the server sent it, or when we are offline and nothing better is coming. That last clause
is what keeps a genuinely empty board in a shed reading as empty rather than as broken.
Anything else is held, and held is not free. Nothing better within the ladder's own budget
is a failure like any other.

`hooks/use-node.ts` has held this line for a single document since it shipped: *"Not in the
cache is not not there."* This is that rule for a query, and it needs the same
`{ includeMetadataChanges: true }` for the same reason. A server confirming that an empty
result is *still* empty changes nothing but `fromCache`, and Firestore suppresses
metadata-only events by default. Without it the hold would never release on a board that
really is empty.

Once the ladder is spent the screen says so rather than drawing the result as empty:
`useHome()` and `useNodes()` expose `failed` alongside `loading`, the empty state gives way
to `homes.loadFailed` / `board.loadFailed` / `detail.stepsFailed`, and a Try again
re-opens the listener. On `/homes` the create-a-home button goes with the empty state.
"Could not load your homes" above "create a new home" is the same invitation to a duplicate
home, and a connection that could not run the query would not carry `createHome` either.

`failed` is never true while `loading` is. A board is two listeners that give up
independently, so without that a half-connected board would draw a spinner and a failure at
once, over a Try again that would tear down the half still arriving. For the same reason the
homes retry does not re-raise `loading`. That swaps the whole router for the splash, and
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

It renders on [`overview`](overview.md), the route the app opens on, and inside that
screen's scroller rather than pinned under the app bar. Behind a tab tap, the member who
never opens Projects is never asked; pinned, a one-time offer holds a phone's worth of
height on every visit.

`public/sw.js` is a hand-rolled runtime-caching service worker. No Workbox, no precache
manifest, no build step. Assets are cached the first time they are used, which is enough
because the app cannot be used before signing in online once. Its routing table lives in
`public/sw-routing.js`, free of service worker globals so it can be unit tested directly,
and `importScripts` also makes the browser check it for updates.

The strategies:

- Writes and cross-origin requests pass through untouched. Firestore, Google auth and
  fonts run their own offline handling, and the Firestore write queue breaks if the worker
  answers for it.
- Anything under `/__/` is passed straight through. `authDomain` is now the app's own
  origin, which puts Firebase's OAuth handler on a path the worker would otherwise treat
  as a navigation and cache as the app shell. Sign-in would then be answered by a cached
  copy of the app instead of by Google, and the cached shell would be a Google page.
- Navigations are network-first and store the single app shell, never a per-route copy.
  Each exported HTML file names a content-hashed bundle, so a stale per-route copy would
  boot old app code on one route while others ran the new build.
- Content-hashed assets under `/_expo/static/` are cache-first forever.
- Everything else is stale-while-revalidate.

The worker never calls `skipWaiting()` on its own. A worker swap reloads the page, and a
reload loses whatever the user was typing. `UpdateBanner` offers the new build and the
user chooses. `VERSION` in `sw.js` is bumped whenever that file changes, so `activate`
drops the old cache.

## Language

`i18next`, initialised from the device locale, with `en-US` and `sv-SE` shipped from day
one. Both locale files are updated in the same change as any string.

`resolveLocale()` matches on the language subtag, not the full tag. Matching the full
tag is not enough. A device set to `sv`, `sv-FI` or `en-GB` would match no resource and
silently fall back to English, including for the Swedish speakers this app is partly
for. Every other language is treated as English. It is kept free of `expo-localization`
so it is testable in plain Node.

## The console

The [`/review`](../../.claude/skills/review/SKILL.md) hostile checklist treats the console
as a gate: an error is `blocking`, a warning is `should-fix`. That only works while the
console is quiet by default. Three framework warnings fired on every load and a burst of
red arrives on every network cut, and a console that is never clean teaches the next
reviewer, human or agent, to read past it, which is exactly how a real error gets waved
through.

Every source is therefore either silenced or written down here, with a reason. None of it
is left as folklore.

### Silenced: three framework warnings `react-native-paper` provokes

```
props.pointerEvents is deprecated. Use style.pointerEvents
"shadow*" style props are deprecated. Use "boxShadow".
Animated: `useNativeDriver` is not supported because the native animated module is missing…
```

All three are `react-native-web` warning about what `react-native-paper` hands it: Paper
passes a `pointerEvents` prop, builds `Surface`'s elevation out of `shadow*` styles, and
animates with `useNativeDriver: true`. No code in this repository does any of the three,
and every one of them is a `warnOnce`, so it is three lines per load, on every screen.

**A version bump does not clear them.** `react-native-web` is on its latest release, and
`react-native-paper`'s latest passes all three exactly as the pinned version does. The
`useNativeDriver` one is not even a bug awaiting a fix. There is no native animated module
on the web, so it is permanent rather than pending.

So they are filtered at the console boundary, in `utils/dev-console.ts`.

**The filter is installed from the repo-root `index.ts`, which is what
`package.json`'s `main` points at**, ahead of its own `import "expo-router/entry"`. That
entry-point move is the part worth remembering, because the obvious placement does not
work. A module's imports are all evaluated before its first statement, so installing from
`app/_layout.tsx` runs *after* the router, its dependencies and everything they touch, and
the `shadow*` warning fires in there, before the root layout is reached at all. That was
tried, and the warning still appeared in the browser. `index.ts` is the only position
upstream of all of it. Nothing else belongs in that file.

*Rejected:* a call in `app/_layout.tsx` (demonstrably too late, above) and a Metro
`serializer` or Babel transform (a build-time answer to a runtime problem, and far more
machinery than three `startsWith` calls).

A filter's own danger is hiding a real warning that happens to match, so it is kept as
narrow as it can be:

- **`console.warn` only.** None of the three is ever logged as an error, and an error is
  the signal the checklist most needs to keep.
- **The `useNativeDriver` entry is filtered on the web only.** Off the web those same
  words are not a deprecation at all. They are `react-native`'s own `NativeAnimatedHelper`
  reporting that the native animated module is genuinely missing, and the message's own
  advice is to run `pod install`. Filtering it on iOS or Android would pre-install a blind
  spot in the one line that explains a broken autolink, on builds this project has not
  done yet. The other two are `react-native-web`'s and are filtered everywhere.
- **A long literal prefix, matched with `startsWith`.** Never a keyword, never a regular
  expression. An app message that *quotes* a deprecation while reporting something real
  still comes through.
- **`__DEV__` only.** It is false in an `expo export` bundle, so a production build never
  patches `console` at all.
- **The first suppression announces itself.** One `[dev-console]` line naming the filter
  and this document, so a console that is missing three warnings explains why rather than
  just being quiet.

Each prefix deliberately stops short of its message's trailing advice, "run `bundle exec
pod install`" or "Use `boxShadow`", because that tail is the part a framework release
rewords. A filter that fails *open* puts the noise back and somebody re-triages it; one
that fails closed goes on swallowing whatever the message turned into.
`utils/dev-console.test.ts` keeps the three messages verbatim for the same reason, and
`check-invariants.sh` check 9 keeps this from becoming the first of several filters
scattered around the tree.

*Rejected:* patching Paper through `postinstall` (three separate internals, maintained
forever, to change nothing a user sees); a regular expression per warning (wider than the
thing it matches, for no gain when the messages are constants); and filtering
`console.error` as well (nothing needs it, and it is the one signal that must never be
lost).

### Not silenced: Firestore's transport on a real network cut

Cutting the network for real, with `page.context().setOffline(true)` rather than the app's
own offline state, produces a burst of

```
net::ERR_INTERNET_DISCONNECTED
@firebase/firestore: Firestore (…): WebChannelConnection RPC 'Listen' stream … transport errored
```

while the Firestore listener retries. Nothing user-facing breaks: the offline bar appears,
controls that need a connection are disabled, cached reads still render, and a reload after
reconnecting is clean.

**It is expected, and it stays.** Two separate reasons, neither of them laziness.

`net::ERR_INTERNET_DISCONNECTED` is not reachable from JavaScript. Chrome's own network
stack writes it when a request fails. It is not a `console.*` call, so no wrapper, no
filter and no SDK log level can remove it. Anything done about the second line would leave
the first one exactly where it is.

The `WebChannelConnection` line is Firestore's own warning, and it is the same message a
genuinely unreachable backend produces: the wrong project, a rules deploy that broke
`Listen`, an emulator suite nobody started. Silencing it trades three lines during a test
we deliberately triggered for the only clue in the case where nobody triggered anything.

*Rejected:* `setLogLevel("silent")` under `__DEV__` (removes the second line, cannot touch
the first, and takes every real Firestore diagnostic with it); and
`experimentalForceLongPolling` / `experimentalAutoDetectLongPolling` in
`config/firebase.ts`. Those choose which transport the SDK uses, not whether the browser
logs a socket that died, and forcing long-polling puts a latency cost on every session in
order to reword a message in a test.

### What "console clean" means

The gate counts errors and warnings. Expo's own dev runtime always logs a couple of
`info` and `log` lines ("Download the React DevTools…", "Running application `main`"), and
so does the filter above; none of them is a warning and none of them is a finding.

On any screen, in normal use, the count is **0 errors and 0 warnings**. Two things may
change that, and only these two:

1. **A real network cut.** `page.context().setOffline(true)`, the offline item on the
   checklist. Firestore's long-poll channel produces a burst of
   `net::ERR_INTERNET_DISCONNECTED` and `WebChannelConnection … transport errored` while
   it retries, as above. Expected *during that check only*.
2. **A backend the browser cannot reach while it still believes it is online.** The
   emulator suite is not running, the wrong project, a rules deploy that broke `Listen`.
   Chrome logs `net::ERR_CONNECTION_REFUSED` per attempt, Firestore logs the same
   `transport errored` warning, and once the `subscribeWithRetry` ladder is spent the app
   adds its own `Could not load this board, attempt 1: …`. That last one is not noise.
   It is `hooks/use-nodes.ts` reporting a failure the user is being shown on screen, and it
   is the difference between a board that is empty and a board that could not be read. If
   you see it and you did not cut the connection, the finding is whatever broke the
   connection.

Anything else is a finding. The list is closed: a new entry is added here with a reason,
or the noise is fixed. "Known warnings" is not an answer.

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
- **`isQueryAnswer`'s offline clause cannot fire on native.** `isOnline()` returns `true`
  off the web, and native runs on the in-memory cache, so a board opened offline there is
  always `empty && fromCache && online`. It holds for the ladder's budget and then says
  "Could not load this board", which is the exact lie the clause exists to prevent. It
  costs nothing today because native does not ship; it wants a real connectivity read
  (`expo-network` or `@react-native-community/netinfo`) whenever it does.
- **Sign-out does not mention API keys.** Signing out of the web app leaves every key in
  [`rest-api`](rest-api.md) working, and the confirmation dialog says nothing about it.
- **Telling a visitor what the app is, or who invited them**,
  [#22](https://github.com/Senth/home-backlog/issues/22). Layout room is reserved.
- **The redirect's edges are the browser's, not ours.** A back-navigation straight after
  signing in leaves the app for Google's chooser rather than returning to the board, and
  losing the connection between the tap and the handler lands on the browser's own error
  page. The app is not running at that moment, so it cannot say anything better. Both
  are known and unhandled.
