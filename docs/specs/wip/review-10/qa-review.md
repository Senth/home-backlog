# qa-review

**Verdict:** FAIL
**Viewports:** 2560x1440 (full), 390x844 (primary path)

Issue #10 "Login and session", spec `docs/specs/wip/10-login-and-session.md`, app at
http://localhost:8081 against emulators seeded from `.emulator-seed/`.

## Acceptance

| Spec claim | Result |
|------------|--------|
| §1 web sign-in is a redirect flow (no popup) | PASS — click "Continue with Google" navigates same tab to `http://localhost:8061/emulator/auth/handler?...&authType=signInViaRedirect&...`, no second tab opens |
| §2 account chooser always forced (`prompt: 'select_account'`) | PASS — handler URL carries `customParameters=%7B%22prompt%22%3A%22select_account%22%7D`; picker shown on every sign-in, including immediately after a failed one |
| §1/§3 session survives browser restart | PASS — persistent-profile browser, sign in as Anna, `close`, reopen, `goto /` → lands `/projects`, "Signed in as anna@example.com". New tab also signed in |
| §3 persistence is IndexedDB-backed | PASS — `indexedDB.databases()` = `firebaseLocalStorageDb`, `localStorage` empty |
| §5 splash instead of router while auth unresolved | PASS on `/` — reload shows element with `aria-label="Loading"` + brand image before Projects; never the login screen when signed in |
| §2/§5 empty Projects board never appears before login | **FAIL** — signed-out load of `/projects` (or `/locations`) renders the board + tab bar for ~40 ms before bouncing to `/login`. Finding 1 |
| §5 login screen: centred Surface, brand mark, `screen.login.title`, `screen.login.tagline`, gap, Google button | PASS — "Home Backlog" / "Every job around the house, in one place." / "Continue with Google", card 400 px wide centred at 2560, fills width at 390 |
| §5 login `ScrollView` scrolls rather than clips when content does not fit | PASS — at 390x400 the container reports `scrollHeight 436 > clientHeight 400` and the button stays reachable |
| §5 button disabled + `screen.login.offlineHint` while offline, re-enables by itself | PASS — offline: `button [disabled]` + "Signing in needs a connection."; back online the button is enabled again with no reload |
| §5 double tap cannot start two redirects | PASS (indirect) — three synchronous `click()`s produce exactly one handler navigation, 0 console errors. The busy/`loading` state itself is not observable in the emulator, the document navigates first |
| §5 `OfflineBar` session-aware wording | PASS — signed out: "Offline — you need a connection to sign in."; signed in: "Offline — changes are saved and will sync when you reconnect." |
| §5 redirect error surfaces in the Snackbar via `mapAuthError()` | PASS — `signInWithIdp` aborted → "You are offline. Signing in needs a connection."; `signInWithIdp` 400 → "Could not sign in with Google. Try again." |
| §5 cancelling at Google returns to login with no error | PASS — browser back from the picker returns to `/login`, no Snackbar |
| §5 AccountMenu in the app bar of all three tab screens | PASS — `[aria-label="Account"]` present on `/projects`, `/locations`, `/maintenance` |
| §5 `Avatar.Text` initials when no `photoURL` | PASS — Marcus → "M"; "Anna Maria Berg" → "AB"; "Bartholomew Maximilian Fitzgerald-Wetterström Jr" → "BJ" |
| §5 `Avatar.Image` when `photoURL` exists | PASS — Anna renders one `<img>`, no initials text |
| §5 photo unreachable → initials, no layout shift | PASS — Anna's `photoUrl` repointed to `https://lh3.googleusercontent.com/a/qa-broken-photo` and that host aborted: initials "AB" render, account button box identical to the photo case (`x 2393.4375, width 162.5625, height 48`) |
| §5 display name beside avatar at ≥ compact width, avatar alone below | PASS — name shown at 760 px and up, avatar-only at 700 px and below and at 390 px; no overlap with the "Projects" title at 760 px |
| §5 menu header (avatar, display name, email), divider, "Sign out" with logout icon | PASS — "Marcus" / "marcus@example.com" / "Sign out" |
| §5 sign out is menu → confirmation dialog; only the second action signs out | PASS — dialog "Sign out?" / "You will need to sign in with Google again." / "Cancel" / "Sign out"; Cancel keeps the session on `/projects`, Sign out lands `/login` |
| §5 `PlaceholderScreen` footnote, Projects shows `account.signedInAs` | PASS — "Signed in as marcus@example.com" under "No projects yet."; Locations ("No locations yet.") and Maintenance ("Nothing due.") carry no footnote |
| §5 offline table row "Signed in, offline" | PASS |
| §5 offline table row "Signed out, offline" | PASS |
| §5 offline table row "Goes offline mid-redirect" | PASS |
| §5 offline table row "Avatar photo unreachable" | PASS |
| §6 all nine new strings, `en-US` and `sv-SE` | PASS — every key rendered translated in both locales, none raw. See checklist 5 |
| §7 three tab screens keep placeholder content, no Firestore traffic | PASS — no Firestore document read or written during any flow |
| §1 `authDomain` = app origin in production | NOT VERIFIABLE LOCALLY — `__DEV__` points at the Auth emulator on `localhost:8061`; this is a deploy-config claim, no browser evidence available here |

## Checklist

| # | Check | Result |
|---|-------|--------|
| 1 | console | FAIL — one app-level `[ERROR]` on a handled path, plus three deprecation `[WARNING]`s on every screen. Findings 2 and 3 |
| 2 | offline | PASS — all four §5 rows verified; the feature performs no Firestore write, and signing out while offline still lands on `/login` with the correct offline wording |
| 3 | empty state | PASS — "No projects yet." + "Signed in as <email>", "No locations yet.", "Nothing due."; signed-out state is the login card, never a blank surface |
| 4 | reload + back | PASS — reload with the sign-out dialog open keeps the session and closes the dialog; back through the tabs works; back into the account chooser recovers by picking an account (finding 5) |
| 5 | sv-SE | PASS — "Projekt", "Inga projekt än.", "Inloggad som anna@example.com", "Konto", "Logga ut", "Logga ut?", "Du behöver logga in med Google igen.", "Avbryt", "Offline — du måste vara uppkopplad för att logga in.", "Du måste vara uppkopplad för att logga in.", "Du är offline. Du måste vara uppkopplad för att logga in.", "Kunde inte logga in med Google. Försök igen.", splash `aria-label` "Laddar". No raw key, no missing key |
| 6 | volume | PASS — the feature lists nothing that can overflow (the menu holds one row). Stressed instead with a 47-character display name and a 66-character email: both wrap in the menu and the empty state, neither clips nor pushes the app bar off screen |
| 7 | smoke | PASS — sign out and back in five times across two accounts and two locales, all three tab routes, `/` and deep links, no collateral breakage |

## Findings

1. **[blocking]** Signed out, a load of any tab route renders the empty board plus tab bar before redirecting to `/login` — the exact flash §2 says cannot happen ("no route mounts and no wrong screen can appear") and phase 2 says to verify against ("the empty Projects board must never appear before login").
   Repro: sign out (or use a fresh profile), then `goto http://localhost:8081/projects`. Poll `document.body.innerText` every 10 ms.
   Expected: splash, then `/login`. Actual, reproduced 3/3 runs at both 2560x1440 and 390x844:
   `t=248 ms "/projects::"` → `t=549 ms "/projects::Projects | No projects yet. | Projects | Locations | Maintenance"` → `t=584 ms "/login::Home Backlog | ..."`. Same on `/locations` ("Locations | No locations yet."). Loading `/` is clean, so `AuthGate` is doing its job — the leak is the group layout mounting the tab route before its signed-out redirect runs.
   Fix: in the `(app)` group layout return the splash (or `null`) whenever `!user`, before rendering children, instead of redirecting from an effect after the route has mounted.

2. **[should-fix]** The app logs a console error for a state it handles and shows correctly in the UI.
   Repro: on `/login`, route `**/accounts:signInWithIdp**` to `abort('failed')`, click "Continue with Google", pick any account.
   Expected: Snackbar "You are offline. Signing in needs a connection." and a clean console.
   Actual: correct Snackbar, plus `[ERROR] Google sign-in redirect error: FirebaseError: Firebase: Error (auth/network-request-failed).` Same error on the non-network branch (400 from `signInWithIdp` → "Could not sign in with Google. Try again.").
   Fix: log the handled redirect failure with `console.warn`, or drop it once `mapAuthError()` has produced a user-facing message.

3. **[should-fix]** Three React-Native-Web deprecation warnings fire on first paint of every screen, signed in or out, with no interaction.
   Repro: `goto http://localhost:8081`, then `console`.
   Expected: no warnings.
   Actual: `[WARNING] props.pointerEvents is deprecated. Use style.pointerEvents`, `[WARNING] Animated: `useNativeDriver` is not supported because the native animated module is missing. Falling back to JS-based animation. To resolve this, add `RCTAnimation` module to this app, or remove `useNativeDriver`. Make sure to run `bundle exec pod install` first. Read more about autolinking: https://github.com/react-native-community/cli/blob/master/docs/autolinking.md`, `[WARNING] "shadow*" style props are deprecated. Use "boxShadow".` They look pre-existing (Paper / RN-Web internals), and this project fixes rather than inherits.
   Fix: pin down whether they come from app code or `react-native-paper`; if app code, move `pointerEvents` and `shadow*` into style props and set `useNativeDriver: false` on web.

4. **[idea]** The refreshed seed cannot exercise the "avatar photo unreachable" branch it was refreshed for. Anna's `photoUrl` in `.emulator-seed/auth_export/accounts.json` is a 138-character `data:image/png;base64,...` URI, so it can never fail to load, while §5 describes the image as "a `googleusercontent.com` request" that must fall back to initials. I could only test the branch by rewriting the account through the emulator admin API.
   Repro: `POST /identitytoolkit.googleapis.com/v1/projects/home-backlog/accounts:query` with `Authorization: Bearer owner`.
   Expected: a remote https photo URL. Actual: a data URI.
   Fix: seed the photo account with an `https://lh3.googleusercontent.com/...` URL so blocking that host reproduces the fallback in one step.

5. **[idea]** One browser back from `/projects` right after signing in leaves the app for the account chooser (in production, Google's own screen) rather than staying inside the PWA. Choosing the account again returns to `/projects` cleanly, so it recovers, and it is inherent to `signInWithRedirect`.
   Repro: sign in, then `go-back`. Actual: `http://localhost:8061/emulator/auth/handler?...` showing "Sign-in with Google.com".
   Fix: nothing safe in app code — worth a line in the area spec so the next reader does not treat it as a bug.

6. **[idea]** If the connection dies between the tap and the handler load, the user lands on the browser's own error page, outside the app: "This site can't be reached". Only the back button returns them to `/login`.
   Repro: on `/login`, route `**localhost:8061/**` to `abort('failed')`, click "Continue with Google". Actual URL `chrome-error://chromewebdata/`.
   Fix: also inherent to a redirect flow; note it beside the offline table so the honest-offline story is complete.

## Notes, not findings

- No service worker registers against the dev server (`navigator.serviceWorker.getRegistrations()` → 0), so a cold offline boot and the offline brand-mark fetch (`[ERROR] Failed to load resource: net::ERR_INTERNET_DISCONNECTED @ http://localhost:8081/assets/?unstable_path=.%2Fassets%2Fimages/icon.png`) cannot be judged locally. Both are production-build behaviour and §7 leaves the service worker unchanged.
- The splash `aria-label` starts as "Loading" for one frame and becomes "Laddar" once i18n initialises, in a Swedish browser. Not user-visible text.
