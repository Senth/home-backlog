# code-review

**Verdict:** FAIL
**Scope:** `main...HEAD` (`feat/10-login-and-session`, 5 commits, working tree clean)
**Files:** 28

## Findings

1. **[blocking]** `public/sw-routing.js:21` — Same-origin `authDomain` drags Firebase's
   reserved `/__/` namespace inside the service worker scope, and `chooseStrategy()` no
   longer excludes it. `if (!sameOrigin) return "passthrough";` was the whole defence
   ("Firestore, Google auth and fonts run their own offline handling"), and
   `config/firebase.ts:39` just moved Google auth onto the app's own origin. Now
   `https://hb.senth.org/__/auth/handler` (top-level nav) and
   `https://hb.senth.org/__/auth/iframe` (hidden iframe — an iframe load is `mode ===
   "navigate"` too) both hit `chooseStrategy()` line 24 and get `"navigate"` →
   `networkFirst()` in `public/sw.js:80`, which stores **every** OK navigation response as
   `SHELL_URL` = `/index.html`. Both URLs return 200 HTML (the spec's own manual step 2
   confirms the handler does), so the offline app shell gets overwritten by Firebase's auth
   page. Not theoretical on the target device: `@firebase/auth`'s browser resolver has
   `get _shouldInitProactively() { return _isMobileBrowser() || _isSafari() || _isIOS(); }`,
   so on a phone, on Safari and in the installed iOS PWA the iframe loads on **every** app
   start — after the app's own navigation — leaving the poisoned copy as the last write.
   Next offline launch, `networkFirst()`'s catch serves that cached copy and the PWA boots
   Firebase's auth iframe page instead of the app. Second-order: offline, the iframe request
   itself is answered from cache with the app shell, so the app boots a second copy of
   itself in a hidden frame.
   Fix: add `if (pathname.startsWith("/__/")) return "passthrough";` as the first same-origin
   check in `chooseStrategy()`, bump `VERSION` in `public/sw.js:15` to `"v2"` so `activate`
   drops the already-poisoned `home-backlog-v1` cache, and add the case to
   `utils/sw-routing.test.ts`.

2. **[blocking]** `components/auth/GoogleSignIn.web.tsx:7` and
   `components/auth/GoogleSignIn.tsx:8` — `import type { GoogleSignInButtonProps } from
   "./GoogleSignIn.types";` is a relative path. `CLAUDE.md`: "Imports use the `@/` alias,
   never relative paths." Invariant 4.
   Fix: `from "@/components/auth/GoogleSignIn.types"` in both files.

3. **[blocking]** `auth/errors.test.ts:1` and `auth/display-name.test.ts:1` — same
   invariant: `from "./errors"` and `from "./display-name"`. Pre-existing tests in `i18n/`
   do the same, but those files are not in this diff and the rule has no exemption for tests.
   Fix: `from "@/auth/errors"` and `from "@/auth/display-name"`.

4. **[should-fix]** `contexts/AuthContext.tsx:57` — the whole router is gated on
   `consumeRedirectResult()`, a promise that can take tens of seconds on a bad connection.
   `AuthImpl._initializeWithPersistence` **awaits** `_popupRedirectResolver._initialize()`
   before the first `onAuthStateChanged` on Safari / mobile / iOS, and the gapi iframe load
   runs on `NETWORK_TIMEOUT = new Delay(30000, 60000)` / `PING_TIMEOUT = new Delay(5000,
   15000)`. Before this diff a slow init only delayed the redirect decision; now
   `app/_layout.tsx:41` renders `<SplashScreen />` instead of `<Slot />`, so a signed-in
   user on one bar of signal stares at a splash with a cached session sitting in IndexedDB.
   Spec §5 promises "Signed in, offline | Unchanged". Uncertain: exact wall-clock depends on
   which timeout fires; hard offline fails fast because `apis.google.com` is cross-origin and
   errors immediately — lie-fi is the bad case.
   Fix: race the redirect wait against a cap — `Promise.race([consumeRedirectResult(),
   new Promise((r) => setTimeout(r, 5000))])` — so `redirectResolved` can never hold the
   router; a late credential still arrives through `onAuthStateChanged`.

5. **[should-fix]** `components/auth/AccountMenu.tsx:184` — `void signOut();` throws the
   rejection away. `AuthContext.signOut` is a bare `await firebaseSignOut(auth)` with no
   catch, so a failure is an unhandled rejection, the dialog closes, and the user stays
   signed in with no message on the one action the whole feature is built to make deliberate.
   Fix: `signOut().catch((error) => { console.error("Sign-out failed:", error); })`, or
   surface `mapAuthError(error)` in a Snackbar.

6. **[should-fix]** `components/ui/OfflineBar.tsx:39` — `user` is `null` while auth is
   unresolved, so an offline launch by a **signed-in** user shows
   `status.offlineSignedOut` ("Offline — you need a connection to sign in.") over the splash
   before flipping to `status.offline`. That is the exact "the app logged me out" lie the
   splash exists to prevent, and finding 4 can hold it on screen for seconds.
   Fix: pull `loading` from `useAuth()` and `if (online || loading) return null;`.

7. **[idea]** `config/firebase.ts:93` — bare `catch {}` swallows every `initializeAuth`
   failure, not only the Fast Refresh `auth/already-initialized` it documents; a real
   mis-configuration silently degrades to `getAuth(app)` with nothing in the console.
   Fix: rethrow unless `(error as { code?: string }).code === "auth/already-initialized"`.

8. **[idea]** `config/firebase.ts:40` — `window.location.hostname` drops the port, so any
   non-443 production-mode origin (`npx serve dist -p 3000`, a LAN preview) builds
   `https://localhost/__/auth/handler` and the redirect dead-ends with no clue why.
   Fix: `window.location.host`, or log a warning when `window.location.port` is set.

9. **[idea]** `.env.example:11` — `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=hb.senth.org` contradicts
   the comment three lines above it ("Left blank, the app falls back to its own origin") and
   hands every copied `.env.local` the production host.
   Fix: leave the value empty and keep the comment.

10. **[idea]** `components/auth/AccountMenu.tsx:37` — `photoLoaded` / `photoFailed` are not
    keyed on `photoURL`, so if the SDK ever swaps the photo on the same mounted `User`, a
    stale `photoFailed` pins the initials forever.
    Fix: `key={photoURL ?? "none"}` on `<AccountAvatar />`, or reset both in an effect on
    `photoURL`.

11. **[idea]** `contexts/AuthContext.tsx:60` — `redirectError` is only ever rendered by
    `app/(auth)/login.tsx`, so a `getRedirectResult()` rejection that lands while a valid
    session already exists routes the user to the tabs and the message is stranded in
    context, never seen and never cleared.
    Fix: leave as is, or drop the error when `user` is non-null.

Spec conformance: every requirement in §§3–6 is implemented as written — persistence chain,
`prompt: "select_account"`, both-gates `loading`, splash instead of `<Slot />`, the clamped
scrollable card with the reserved `#22` gap, offline hint, session-aware offline bar, avatar
+ menu header + confirmation dialog, `footnote` on the Projects empty state, both locales.
`yarn lint`, `yarn typecheck`, `yarn test` (22 tests, 4 suites) all green. Phase 6 (area
spec, `docs/OPERATIONS.md`, `CLAUDE.md` reword, `utils/` move, `yarn todo`) is not in the
diff — correct, it runs after this review.

## Invariants

| # | Invariant | Result |
|---|-----------|--------|
| 1 | no numeric literal in a style prop | PASS — every `padding`/`gap`/`borderRadius`/`width`/`height` in the diff reads `space` / `radius` / `elevation` / `size` / `contentWidth` / `touchTarget`; new `size`, `contentWidth`, `touchTarget`, `compactBreakpoint` extend the scale in `theme/tokens.ts` |
| 2 | no colour literal outside `theme/` | PASS — no `#`, `rgb(`, `rgba(`, `hsl(` in any changed file outside `theme/` |
| 3 | `useAppTheme()` from `@/theme` | PASS — `AccountMenu.tsx`, `SplashScreen.tsx`, `login.tsx`, `OfflineBar.tsx`, `PlaceholderScreen.tsx` all use it; Paper's bare `useTheme` appears only inside `theme/index.ts` |
| 4 | `@/` alias, never relative | FAIL `components/auth/GoogleSignIn.web.tsx:7`, `components/auth/GoogleSignIn.tsx:8`, `auth/errors.test.ts:1`, `auth/display-name.test.ts:1` |
| 5 | no `StyleSheet.create` / styled-components / Tailwind / NativeWind | PASS — none in the diff or the repo |
| 6 | every user-facing string through `t()` | PASS — `account.label`, `account.signedInAs`, `account.signOut.title`, `account.signOut.body`, `common.cancel`, `common.loading`, `common.signOut`, `screen.login.offlineHint`, `status.offlineSignedOut`, `error.offline` all via `t()`; the only bare JSX text is `{name}` and `{user.email}`, which are data |
| 7 | `en-US.json` / `sv-SE.json` identical key sets | PASS — 33 keys each, symmetric difference empty; all nine new keys landed in both, wording matches spec §6 |
| 8 | rules changed ⇒ `tests/rules/` changed | PASS — `firestore.rules` and `storage.rules` untouched, as spec §4 states |
| 9 | new `utils/` or `models/` file ⇒ test | PASS — no new file in either; the new `auth/` modules carry `auth/display-name.test.ts` and `auth/errors.test.ts`. Note: `auth/redirect.ts` / `auth/redirect.web.ts` have none, but they are one-line platform shims over the SDK |
| 10 | `.web.tsx` / `.native.tsx`, not `Platform.OS` in a shared file | PASS — `GoogleSignIn.web.tsx` + base, `redirect.web.ts` + base; no `Platform.OS` in any component. Note: the native halves are base files, not `.native.tsx` as spec phase 1 words it, because `tsconfig.json` sets no `moduleSuffixes` and `@/components/auth/GoogleSignIn` would not resolve without a base — same shape as the existing `hooks/use-color-scheme.ts` / `.web.ts` |
| — | no snapshot / layout-only render tests | PASS — 4 suites, 0 snapshots, no component render tests |
