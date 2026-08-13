# Login and session — issue #10

## Handoff

*(wip only — the cleanup phase deletes this section)*

This file is the implementation plan for [issue #10](https://github.com/Senth/home-backlog/issues/10).
Work the **Phases** section in order. Read [`CLAUDE.md`](../../../CLAUDE.md) and
[`docs/PROJECT.md`](../../PROJECT.md) first — in particular the *Platform, auth, i18n*
section, whose "Google sign-in only" decision this feature does not reopen.

Nothing durable may live only in **Handoff** or **Phases**: both are deleted by the
cleanup phase, which folds sections 1–8 into `docs/specs/platform-offline.md`.

Branch `feat/10-login-and-session`. One commit per phase, once that phase is green on
`yarn lint --write`, `yarn typecheck` and `yarn test`.

**After the cleanup phase** — and only then:

```bash
GIT_VANILLA=1 gh pr create --fill --body "Closes #10"
GIT_VANILLA=1 gh pr checks --watch
GIT_VANILLA=1 gh pr merge --squash --delete-branch
```

Any check failing means stop, report, and **do not merge**.

Committing, opening the PR and merging are an explicit, user-authorized exception to the
global "never commit without being asked" rule. The exception is scoped to this flow and
to this branch — nothing else is committed or pushed without asking, and nothing is ever
pushed straight to `main` (that deploys to production).

### Manual steps: what is already done, what is left

Phase 1 changes `authDomain` from `home-backlog.firebaseapp.com` to the origin the app is
served from. Three things have to be true in production for that to work. As of
2026-08-12:

1. ✅ **`hb.senth.org` is an authorized domain.** Verified against the Identity Toolkit
   admin API — the authorized list is `home-backlog.firebaseapp.com`,
   `home-backlog.web.app`, `hb.senth.org`, `localhost`. Nothing to do.
2. ✅ **Hosting serves the auth handler on the custom domain.**
   `GET https://hb.senth.org/__/auth/handler` returns 200, so the reserved `/__/`
   namespace is not shadowed by the `"**" → /index.html` rewrite in `firebase.json`.
   Nothing to do, but do not add a rewrite that would shadow it.
3. ✅ **`.env.local` exists and already carries
   `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=hb.senth.org`.** It was reconstructed from the public
   values Hosting publishes at `https://hb.senth.org/__/firebase/init.json`.

4. ✅ **`https://hb.senth.org/__/auth/handler` is an authorized redirect URI** on the web
   OAuth client (`792394648653-1a6q1hr1rr6g2rg99tkt95mu0n0f5qfl.apps.googleusercontent.com`,
   "Web client (auto created by Google Service)"), added by hand in the Google Cloud
   console — there is no public API for it. The `firebaseapp.com` handler URI was kept
   alongside it, so the old auth domain still works and reverting costs nothing.

5. ✅ **The `prod` environment's `ENV` secret carries that `.env.local`**, set with
   `GIT_VANILLA=1 gh secret set ENV --env prod < .env.local`. The deploy workflow writes
   the secret back out to `.env.local` before `yarn build:web`, so the next push to `main`
   ships a bundle with `authDomain: hb.senth.org`. Re-run that command whenever
   `.env.local` changes — nothing does it automatically.

**Nothing manual is outstanding.** The environment is ready for the redirect flow before a
line of it is written, which also means the next deploy from `main` carries the new
`authDomain` even if this feature is not finished: harmless, because the current popup flow
works the same way from a same-origin auth domain now that the redirect URI is registered.

Local development is unaffected by all of this: `__DEV__` connects to the Auth emulator,
which serves its own handler.

---

## 1. What

Signing in with Google on the web is a redirect flow whose session survives browser
restarts, the app never renders a screen before it knows whether you are signed in, and
the signed-in identity is visible and signed out deliberately from an account menu.

## 2. Why

The app already had a login screen, and web sessions already persisted — by accident, on
`getAuth()`'s default. What it did not have was any of the things that make the promise
true in the situations this household actually meets. Six decisions carry the feature.

**Redirect instead of popup, with a same-origin `authDomain`.** `signInWithPopup` is the
smaller change and works fine in a desktop tab. It dead-ends in an installed PWA, where
the popup opens outside the app shell and the result may never return to the opener — and
the installed PWA is the shipping product for the least technical user in
[`PERSONAS.md`](../../PERSONAS.md). A redirect has no popup to block, no opener to lose,
and one code path rather than a tab path plus a standalone path that is the hardest to
test. Its own weakness is Safari's third-party-storage blocking: the Firebase redirect
handler at `<project>.firebaseapp.com` is a different origin from `hb.senth.org`, so the
handshake relies on cross-site storage that Safari discards. Pointing `authDomain` at the
origin the app is served from removes the cross-site leg entirely — Firebase Hosting
reserves `/__/auth/` on every domain it serves, so `https://hb.senth.org/__/auth/handler`
is same-origin with the app.

*Rejected:* popup everywhere (untestable failure mode, discovered by the user not the
developer); popup on desktop and redirect in standalone (two paths, and the one that
matters is the one never exercised in review).

**The account chooser is always forced.** `prompt: 'select_account'` on every sign-in.
Without it, Google silently reuses whichever account the browser saw last, so signing out
and back in is a no-op that returns the same wrong account — a person with a work and a
personal Google account can be locked out of their own board with no way back from inside
the app. The cost is one extra tap on a screen that a persistent session means you see
roughly never.

**The router is held until auth resolves.** Previously `app/index.tsx` redirected to the
tabs immediately while `AuthGate` waited on `loading`, so a signed-out or still-restoring
visitor saw the empty Projects board flash before being bounced to login. On a phone in a
garage with no signal, that flash reads as *the app logged me out and my list is gone* —
and that user opens the app nowhere else. `AuthGate` now renders a splash **instead of**
the router while auth is unresolved, so no route mounts and no wrong screen can appear.
The splash deliberately does not resemble the login screen.

*Rejected:* a Projects skeleton (a signed-out visitor is shown a fake board — the same lie
in a nicer costume) and a blank surface (indistinguishable from a white-screen crash).

**Identity is visible without a tap.** Signing in with the wrong Google account produces
"No projects yet" — identical to a working app with an empty board, and identical to a
broken one. The fix is redundancy at no cost: the empty state names the signed-in address,
the app bar shows the display name beside the avatar at desktop widths, and the account
menu header carries both. A phone app bar stays avatar-only for room, which is why the
empty-state line matters most there.

**Sign out is two deliberate steps.** The account menu holds it, and choosing it opens a
confirmation dialog. For the developer, sign-out is trivially reversible; for a 71-year-old
whose phone has remembered her Google password since 2019, it is total loss of access until
a family member visits. Google sign-in only is settled in `PROJECT.md`, so the mitigation
has to be making sign-out hard to hit by accident rather than adding a second provider.

*Rejected:* sign-out on a Settings screen (there is no Settings screen, and this issue
should not invent one) and a menu with no dialog (a menu opened by accident still has the
cliff one tap away).

**Offline is stated honestly on the login screen.** Firestore's offline persistence only
helps a session that already exists; signed out with no connection, nothing in the app
works. The button is therefore disabled rather than allowed to fail, and the global offline
bar swaps to login-specific wording, because its usual "changes are saved and will sync"
is false for a visitor with no session to save anything into.

## 3. Data & queries

**None.** This feature reads and writes no Firestore document. Everything it displays —
uid, display name, email, photo URL — comes from the `User` object the Firebase Auth SDK
holds in memory and restores from local persistence.

That is worth stating rather than leaving implied: the "signed in as" line and the account
menu are the kind of surface that invites a `users/{uid}` profile document, and adding one
would put a read on the app's startup path for data the SDK already has. There is no
`homes` read either — home creation does not exist yet, and the three tab screens are
placeholders.

Consequently there is no query-safety question to answer here. The first queries this app
fires arrive with the boards feature, under the two provably-safe shapes in `PROJECT.md`.

**Session persistence** is explicit rather than inherited:
`setPersistence(auth, [indexedDBLocalPersistence, browserLocalPersistence,
browserSessionPersistence])` on web. That array is Firebase's own default chain, so this
changes no behaviour — it documents the app's headline promise in code, where a future
Firebase major cannot quietly alter it. The chain is kept rather than pinning
IndexedDB alone: a browser that blocks IndexedDB (a Firefox private window, some embedded
webviews) would otherwise fail `setPersistence` and make sign-in impossible, where the
chain degrades to a session-only login that still works.

Honest limits of "remembers your login":

| Environment | Session survives |
| ----------- | ---------------- |
| Chrome / Firefox / Edge, ordinary tab | Indefinitely |
| Installed PWA | Indefinitely |
| Private / incognito window | Until the window closes |
| Plain iOS Safari, not installed | ~7 days idle, then evicted — see §8 |

## 4. Rules & tests

`firestore.rules` and `storage.rules` are **unchanged**, and `tests/rules/` therefore gains
no cases: nothing in this feature touches a document. The rules already require
`request.auth != null` everywhere, which is the only interaction between auth and rules
that exists today.

What is tested instead, as pure modules under `auth/`:

- `auth/display-name.test.ts` — `initials()` over a two-word name, a one-word name, a
  three-word name, a non-Latin name (`Åsa`), an empty display name falling back to the
  email local part, and a user with neither.
- `auth/errors.test.ts` — `mapAuthError()` maps `auth/network-request-failed` to
  `error.offline`, and any unrecognised code to `error.googleSignIn`.

Component render tests are forbidden by `CLAUDE.md`; the login screen, splash and account
menu are verified in the browser by the `ux-review` and `qa-review` agents in phase 5.

## 5. UI flow

### Splash

`AuthGate` renders `<SplashScreen />` in place of `<Slot />` while auth is unresolved —
that is, until the first `onAuthStateChanged` **and** `getRedirectResult()` have both
settled. Awaiting the redirect result is what stops the login screen appearing for half a
second on the way back from Google.

Theme background, the app mark at `size.brandMark`, a Paper `ActivityIndicator` below it,
`accessibilityLabel` from `common.loading`.

### Login screen

One layout at every width: a Paper `Surface` (`elevation.low`, `radius.lg`) centred in a
`ScrollView` whose content container is `flexGrow: 1` and centred, clamped to
`contentWidth.form`. Below that width it simply fills the screen. The `ScrollView` is what
keeps the screen usable at large text sizes — content that no longer fits scrolls instead
of clipping, and the Paper `Button` label wraps rather than truncating.

Contents, in order: app mark (`size.brandMark`), `screen.login.title` as `displaySmall` in
`colors.primary`, `screen.login.tagline` as `bodyLarge` in `colors.onSurfaceVariant`, then
the Google button. A blank line's worth of layout room is left under the tagline for the
"who invited you" context line of [#22](https://github.com/Senth/home-backlog/issues/22) —
nothing is rendered there now.

The button is `mode="contained"`, `icon="google"`, and is `loading` + `disabled` from the
tap until the browser navigates away, so a double tap cannot start two redirects. While
`useOnlineStatus()` is false it is disabled with `screen.login.offlineHint` beneath it in
`bodyMedium` / `onSurfaceVariant`, and re-enables by itself when the connection returns.

Errors returned by `getRedirectResult()` surface in the existing Paper `Snackbar`, with the
message chosen by `mapAuthError()`. A user who cancels at Google's own screen comes back
with no result and no error, and simply sees the login screen again.

### Offline bar

`OfflineBar` takes the session into account: signed out it reads `status.offlineSignedOut`,
signed in it keeps today's `status.offline`. Same component, same placement above the
router.

### Account menu

`AccountMenu` replaces the bare logout `Appbar.Action` and appears in the app bar of all
three tab screens, so it is in the same place wherever the user is.

- **Trigger** — the avatar. `Avatar.Image` at `size.avatarSm` when `user.photoURL` exists,
  otherwise `Avatar.Text` with `initials()` on `primaryContainer`. The image is a
  `googleusercontent.com` request, so initials render until it loads and stay if it fails
  or the user is offline; the app bar never shows a hole. `accessibilityLabel` from
  `account.label`. At ≥ `compactBreakpoint` the display name is shown beside it as
  `labelLarge`; below, the avatar stands alone.
- **Menu** — a Paper `Menu`. First a non-interactive header: `Avatar` at `size.avatarMd`,
  display name in `titleMedium`, email in `bodySmall` / `onSurfaceVariant`. Then a divider,
  then a `Menu.Item` for `common.signOut` with a `logout` icon. It is built as an account
  menu with room for more rows, not a sign-out drawer, because the "Switch home" row of
  [#21](https://github.com/Senth/home-backlog/issues/21) lands here.
- **Sign out** — opens a Paper `Dialog`: `account.signOut.title`, body
  `account.signOut.body`, actions `common.cancel` and `common.signOut`. Only the second
  calls `signOut()`.

### Empty state

`PlaceholderScreen` gains an optional `footnote`, rendered under the empty-state body in
`bodySmall` / `onSurfaceVariant`. The Projects screen passes
`account.signedInAs` with the signed-in email. This is the only place the address appears
without a tap on a phone, which is where a wrong-account sign-in is otherwise
indistinguishable from a broken app.

### Offline behaviour, summarised

| State | Behaviour |
| ----- | --------- |
| Signed in, offline | Unchanged. Firestore serves cache, offline bar shows the sync message. |
| Signed out, offline | Sign-in button disabled with an explanation; offline bar says a connection is needed to sign in. |
| Goes offline mid-redirect | Returns with `auth/network-request-failed`; Snackbar shows `error.offline`. |
| Avatar photo unreachable | Initials render instead. No layout shift. |

## 6. Strings

New keys, `en-US` / `sv-SE`. The Swedish keeps the register already in the file — short and
plain, no hedging.

| Key | en-US | sv-SE |
| --- | ----- | ----- |
| `common.cancel` | Cancel | Avbryt |
| `common.loading` | Loading | Laddar |
| `account.label` | Account | Konto |
| `account.signedInAs` | Signed in as {{email}} | Inloggad som {{email}} |
| `account.signOut.title` | Sign out? | Logga ut? |
| `account.signOut.body` | You will need to sign in with Google again. | Du behöver logga in med Google igen. |
| `screen.login.offlineHint` | Signing in needs a connection. | Du måste vara uppkopplad för att logga in. |
| `status.offlineSignedOut` | Offline — you need a connection to sign in. | Offline — du måste vara uppkopplad för att logga in. |
| `error.offline` | You are offline. Signing in needs a connection. | Du är offline. Du måste vara uppkopplad för att logga in. |

`common.signOut`, `status.offline`, `screen.login.*` and `error.googleSignIn` already exist
and keep their wording. No key is removed.

## 7. What this does NOT change

- **Google sign-in stays the only method.** Settled in `PROJECT.md`; the sign-out lockout
  risk is answered by the confirmation dialog, not by a second provider. Sign in with Apple
  remains a pre-launch task.
- **Native auth is untouched.** `GoogleSignIn.native.tsx` keeps today's `expo-auth-session`
  code verbatim, and `initializeAuth` without a persistence adapter keeps its TODO — native
  session persistence and the native OAuth flow are
  [#8](https://github.com/Senth/home-backlog/issues/8).
- **No Firestore schema, rules, indexes or listeners.** The three tab screens keep their
  placeholder content; "No projects yet" is still the expected result of a successful
  sign-in.
- **The service worker, manifest and `InstallCard` behave as they do today.**

## 8. Out of scope

- **iOS installed-PWA sign-in verification.** The redirect flow plus a same-origin
  `authDomain` is precisely the design that fixes the standalone dead-end, but confirming it
  needs a real iPhone against the real origin, and `main` deploys straight to production so
  there is no pre-merge origin that reproduces the configuration. Deliberately deferred: no
  iOS-specific code ships here and no acceptance step depends on a device nobody is
  testing on.
- **iOS Safari's ~7-day storage eviction.** A non-installed Safari user who goes two weeks
  between visits is signed out, and no web app can prevent that. Documented in §3 rather
  than mitigated; the install nudge that would have softened it is dropped with the point
  above.
- **Switching between homes** — [#21](https://github.com/Senth/home-backlog/issues/21). The
  account menu is shaped to hold the row; it does not hold it yet.
- **Telling a visitor what the app is, or who invited them** —
  [#22](https://github.com/Senth/home-backlog/issues/22). Layout room is reserved under the
  tagline.
- **API keys in the account menu.** Nothing to build until the REST API lands
  ([#7](https://github.com/Senth/home-backlog/issues/7)); web sign-out will not invalidate
  an agent's key, and the menu should say so when keys exist.
- **A Settings screen**, and **a `users/{uid}` profile document** — see §3.

## 9. Phases

*(wip only — the cleanup phase deletes this section)*

Each phase ends green on `yarn lint --write`, `yarn typecheck` and `yarn test`, and is one
commit.

**Phase 1 — auth foundation.**
`config/firebase.ts`: explicit `setPersistence` chain on web, `authDomain` default changed
to the app origin, `.env.example` updated. `contexts/AuthContext.tsx`: hold `loading` until
both the first `onAuthStateChanged` and `getRedirectResult()` have settled, and surface the
redirect error. Split `components/auth/GoogleSignIn.tsx` into `.web.tsx` (a
`signInWithRedirect` with `prompt: 'select_account'`) and `.native.tsx` (today's code,
unchanged). New `auth/display-name.ts` and `auth/errors.ts` with their tests. **Verify in
the emulator that the redirect flow completes** — the Auth emulator serves its own handler;
if it misbehaves, report it rather than silently reintroducing the popup.

**Phase 2 — splash and routing.**
`components/ui/SplashScreen.tsx`; `AuthGate` renders it instead of `<Slot />` while
unresolved; `app/index.tsx` no longer redirects blindly. Verify by hard-reloading signed
out and signed in: the empty Projects board must never appear before login.

**Phase 3 — login screen.**
`size` and `contentWidth` scales in `theme/tokens.ts`. Rebuild `app/(auth)/login.tsx` as
the centred, scrollable, clamped card with the brand mark. Button busy and offline states;
`OfflineBar` session-aware wording. Strings in both locales.

**Phase 4 — account menu.**
`components/auth/AccountMenu.tsx` (avatar, menu, header, confirmation dialog), wired into
all three tab screens. Desktop display name beside the avatar. `PlaceholderScreen`
`footnote` prop and the Projects "signed in as" line. Strings in both locales.

**Phase 5 — review.** ⏸ **IN PROGRESS — round 1 of 3 applied, round 2 not yet run.**

First a smoke test by the implementing session: the app boots, a signed-out reload lands on
login with no flash, sign-in reaches the tabs, a reload keeps the session, the menu opens
and sign-out confirms. Then `/review` — `code-review`, `ux-review`, `qa-review` — and the
fix loop, capped at three rounds. Acceptance to hand the reviewers: the four states in §5's
offline table; `sv-SE` on every new string; the login screen at 200 % text scale, where it
must scroll rather than clip; both avatar branches; and reload-and-back behaviour.
**A PASS is required.** `blocking` findings are never deferrable; a `should-fix` may be
deferred only with a stated reason; `idea` findings go to the user, who decides which
become issues.

### Round 2 (2026-08-13)

`code-review` and `ux-review` re-ran against the round-1 fixes; both said FAIL, and both
confirmed every round-1 finding is genuinely closed. `qa-review` did not run in this round —
the fixes below landed first, so it runs in round 3 against the fixed tree. Reports are in
`.tmp/review/` (gitignored).

Everything found was `should-fix`; all six are fixed:

| Report | Finding | What was done |
| ------ | ------- | ------------- |
| code 1 | `popupRedirectResolver` at `initializeAuth` blocks the first `onAuthStateChanged` for up to 30 s on lie-fi — Firebase awaits `resolver._initialize()` before `initializeCurrentUser()` on every mobile browser, Safari and iOS | resolver passed per call to `signInWithRedirect` / `getRedirectResult` instead |
| code 2 | focus restore used a `testID` shared by three mounted tab screens, so it restored to the hidden Projects trigger | `returnFocusTo` takes an element ref; verified focus lands on the Locations trigger |
| code 3 | ref written during render with the React Compiler on | moved into an effect |
| code 4 | the phase-6 draft lost the `/__/` passthrough and the `redirectGraceMs` cap | both written into the draft, with their *why* |
| ux 1 | every screen and every tab change stole focus to the account trigger, with Chrome's near-black ring — Paper's `Menu` inits `prevVisible` to `null` and runs its hide path on mount, which focuses the anchor | `useAnchorFocusGuard` blurs a focus no user action caused; themed `focusRing` token replaces the UA default |
| ux 2 | below ~230 px the dialog's action row overflowed the card, pushing *Cancel* off-screen while *Sign out* stayed | `Dialog.Actions` wraps; measured inside the card at 195 / 220 / 240 px, unchanged row at 390 / 2560 |

Verified in the browser after the fixes: sign-in redirect completes, focus stays on `<body>`
through reload and tab changes, Tab still reaches the trigger and now draws a
`rgb(46,125,50)` 2 px ring, dialog actions sit inside the card at every width tested.

`idea` findings from both reports are unactioned and listed for the user — they are the
round-1 list plus: `initializeAuth`'s bare `catch` swallowing a real failure,
`window.location.hostname` dropping the port, avatar state not keyed on `photoURL`, the
account-menu email breaking mid-token at 195 px, the splash never naming the app, the
desktop layout being the phone layout stretched, and the display-name chip's 12 px inset.

### Where this stopped (2026-08-12)

Phases 1–4 are committed and green. Round 1 of the review has run and every
`blocking` and `should-fix` finding has been fixed and verified in the browser
(commit `ee359a3`). **No agent has re-reviewed the fixes.**

The three round-1 reports are kept at `docs/specs/wip/review-10/{code,ux,qa}-review.md`
(copies of `.tmp/review/`, which is gitignored and may be wiped). All three said FAIL.

**To resume, run round 2:** re-run all three agents through the `/review` skill against the
same branch. Every agent has to re-run — each one reported findings, and the fixes touched
`components/`, `app/`, `hooks/`, `public/` and both locale files, so no report is still
valid. If it comes back PASS, go to phase 6. The three-round cap leaves two rounds.

What round 1 fixed, so a re-reviewer can check the specific claims:

| Report | Finding | What was done |
| ------ | ------- | ------------- |
| code 1 | SW cached `/__/auth/` as the app shell | `RESERVED_PREFIX` passthrough in `sw-routing.js`, `VERSION` → `v2`, test added |
| code 2, 3 | relative imports | all now `@/` |
| code 4 | router gated on a 30–60 s redirect wait | `redirectGraceMs` cap in `AuthContext` |
| code 5 | `void signOut()` swallowed the rejection | caught, logged, surfaced in a Snackbar |
| code 6 | `OfflineBar` read `user` while unresolved | silent while `loading` |
| ux 1 | dialog had no focus trap, no Escape, no restore | `hooks/use-modal-focus.web.ts` |
| ux 2, 9 | dialog actions 4.27:1 and identical to each other | `onSurfaceVariant` / `error` |
| ux 3 | login label truncated to "C…" at 200 % zoom | label wraps; `denseBreakpoint` padding |
| ux 4 | 40/38 dp touch targets | `contentStyle={{ minHeight: touchTarget }}` |
| ux 5 | brand mark was a network asset with no fallback | `BrandMark` on a tile, precached fixed path |
| ux 6 | dialog full-bleed at 390 px | width computed from the window |
| ux 7 | menu slid off the left edge at high zoom | `contentStyle` `maxWidth` |
| ux 8 | Swedish hint repeated the offline bar | reworded |
| qa 1 | signed-out deep link flashed the board | both group layouts redirect during render |
| qa 2 | handled failure logged as an error | `console.warn` |

Two things were **not** done and need a decision:

- **qa 3 (`should-fix`) — three React Native Web deprecation warnings** on every screen
  (`props.pointerEvents`, `useNativeDriver`, `shadow*`). **Traced 2026-08-13 and deferred:
  every one is library-internal.** App code (`app/`, `components/`, `hooks/`, `contexts/`,
  `theme/`, `auth/`, `config/`) contains no `pointerEvents` prop, no `useNativeDriver` and
  no `shadow*` style — `elevation` appears only as a Paper prop. The sources are
  `react-native-paper` (`Surface.tsx`, `MaterialCommunityIcon.tsx`, `PortalHost.tsx` for
  `pointerEvents`; `ActivityIndicator.tsx`, `Snackbar.tsx` for `useNativeDriver`, which has
  no native animated module on web; `styles/shadow.tsx` + `Surface.tsx` for `shadow*`) and
  `@react-navigation/elements` (`Header.tsx`). Nothing in this feature can silence them
  short of forking a dependency; they clear when those libraries adopt the new APIs.
- **All `idea` findings** — none acted on, per the skill. They are listed for the user at
  the end of the round-1 summary and in the three reports. The user decides which become
  `gh issue create --label idea`. Notable ones: `primary` misses 4.5:1 on elevated light
  surfaces app-wide (only the dialog was fixed); the seeded photo is a data URI so the
  *loaded* branch is testable locally but the *failed* branch is not; a browser back after
  sign-in leaves the app for Google's chooser; losing the connection between tap and
  handler lands on the browser's own error page.

### Deviations from this spec, already made

- **The platform split is `GoogleSignIn.tsx` (native) + `GoogleSignIn.web.tsx`**, not the
  `.native.tsx` / `.web.tsx` pair phase 1 words. `tsconfig.json` sets no `moduleSuffixes`,
  so `tsc` cannot resolve `@/components/auth/GoogleSignIn` when only platform-suffixed
  files exist; adding `moduleSuffixes` changed React Native typings resolution and surfaced
  unrelated breakage. The shape matches every existing split in the repo
  (`hooks/use-color-scheme.ts` + `.web.ts`). `code-review` saw this and passed it.
- **`setPersistence` became `initializeAuth(app, { persistence: [...] })`.** §3 writes
  `setPersistence(auth, [...])`, but that function takes a single `Persistence`; only
  `initializeAuth` accepts the chain. Same chain, same behaviour — fold the corrected form
  into the area spec, not the one in §3.
- **`auth/redirect.ts` + `.web.ts` were added**, not named in phase 1. `getRedirectResult`
  does not exist in Firebase's React Native entry point, so calling it from the shared
  `AuthContext` needs a platform split.
- **Phase 6's seed refresh (item 7) was done early**, in commit before the review, so the
  reviewers had both avatar branches. Item 7 is complete unless the qa `idea` about the
  data URI is acted on.

### Also already done, ahead of phase 6

`docs/specs/wip/platform-offline.draft.md` is a **complete draft of phase 6 item 1** — the
area spec folding §§1–8, written against the code as it stands after round 1. It still
needs: a read-through against whatever round 2 changes, the two qa `idea` notes about
redirect back-navigation and the browser error page if the user wants them recorded, and
then moving to `docs/specs/platform-offline.md`. Delete the draft and the `review-10/`
folder as part of the cleanup.

**Phase 6 — cleanup, then PR.**

1. Fold §§1–8 into a new `docs/specs/platform-offline.md` — the area
   `docs/specs/INDEX.md` already reserves for auth, i18n, PWA install and offline. Write it
   as one present-tense description of the area including the offline bar and install offer
   as they now behave, not as a chapter about this issue. Keep every *why* and every
   rejected alternative from §2. **A full draft already exists** at
   `docs/specs/wip/platform-offline.draft.md` — review it rather than starting over.
2. Add the row to `docs/specs/INDEX.md`, then delete `docs/specs/wip/10-login-and-session.md`,
   `docs/specs/wip/platform-offline.draft.md` and `docs/specs/wip/review-10/`.
3. `docs/PROJECT.md` → *Platform, auth, i18n*: record that web sign-in is a redirect with a
   same-origin `authDomain`, and why.
4. `docs/OPERATIONS.md` → the `authDomain` / OAuth redirect URI / `ENV` secret setup, in the
   same gotcha register as the Storage-target section.
5. `CLAUDE.md` → reword the must-have-tests rule so it covers domain modules such as
   `auth/` rather than naming `utils/` and `models/`.
6. Delete `utils/`, moving `sw-routing.test.ts` to `tests/sw-routing.test.ts` (its subject
   is `public/sw-routing.js`, which is not a module in `utils/` and never was).
7. Refresh `.emulator-seed/` so it holds a second account with a `photoUrl` alongside
   photo-less Marcus, giving both avatar branches to every future review. Created through
   the app and exported with `yarn emulators:export` — never hand-written.
8. `yarn todo`, then the PR / checks / merge sequence in **Handoff**.
