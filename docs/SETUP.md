# Firebase & Cloud Setup

State of the cloud project as provisioned. Everything here already exists — this is a
record, not a runbook to re-run.

## Project

| | |
|---|---|
| Firebase / GCP project | `home-backlog` ("Home Backlog") |
| Project number | `792394648653` |
| Billing | Blaze, account `01F299-6DD781-BD1670`, budget "home-backlog monthly" at 50 SEK with 50/90/100 % alerts |
| Firestore | Native mode, `(default)`, **`europe-west1`** — permanent |
| Cloud Storage | `home-backlog.firebasestorage.app`, **`europe-west1`** — permanent |
| Hosting site | `home-backlog` → `https://home-backlog.web.app` |
| Custom domain | `hb.senth.org` (CNAME → `home-backlog.web.app`) |
| Web app | `Home Backlog Web`, app id `1:792394648653:web:77c28d7bf20802766d2004` |

There is **no dev project**. Local development uses the Firebase emulators
(`yarn emulators`): UI 8060, Auth 8061, Firestore 8062, Storage 8063. Ports are
offset from the sibling `my-musical-repertoire` project (8050–8052) so both suites can run
at once.

`config/firebase.ts` connects to them whenever `__DEV__` is true, which is **always** in a
dev server and **never** in an `expo export` bundle. There is no flag to point local
development at the live project; the alternative to the emulators is the household's real
data. The Auth emulator intercepts `signInWithPopup`, so Google sign-in works locally
without a real Google account.

Rules tests (`yarn test:rules`) run the emulators under the project id
`demo-home-backlog-rules`. That id appears in two places — the `test:rules` script and
`tests/rules/helpers.ts` — and they must agree: `firebase.json` runs the emulators in
`singleProjectMode`, and `storage.rules` reaches into Firestore with `firestore.get()`,
which resolves against the emulator's own project. A mismatch makes every upload test fail
with a permission error that looks like a rules bug and is not.

## Auth

- **Google sign-in only.** Enabled through the Firebase console, which auto-created the
  Web OAuth client; its id is in `.env.local` as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.
- Authorized domains: `home-backlog.firebaseapp.com`, `home-backlog.web.app`,
  `hb.senth.org`, `localhost`.
- ⚠️ Pre-launch: the Apple App Store requires Sign in with Apple wherever third-party
  sign-in is offered.

## Data model encoded in the rules

`firestore.rules` is deployed and is the authoritative statement of the membership model:

```
homes/{homeId}                     members: { uid: 'owner' | 'member' }
homes/{homeId}/invites/{emailHash} role: 'owner' | 'member'
homes/{homeId}/nodes/{nodeId}      visibility: 'shared' | 'private', participantIds: []
homes/{homeId}/locations/{id}
homes/{homeId}/recurring/{id}
```

- Any signed-in user may create a home, but only one where they list themselves as
  `owner`. Home ids are auto-generated.
- Members may edit the home doc; only an owner may rewrite `members` — except an invitee
  accepting their own invite, who may add exactly their own uid with exactly the role the
  invite grants, and change nothing else.
- Invite doc ids are `sha256(lowercased email)` hex, so an invitee can find their own
  invite without member email addresses being readable by everyone.
- **Node reads are query-shaped, not just rule-shaped.** Firestore denies a whole query if
  any matching doc could be denied, so a board load must run two queries —
  `visibility == 'shared'` and `participantIds array-contains me` — and merge client-side.
  Do not widen the node read rule past what those two queries can prove.
- Storage rules gate `homes/{homeId}/**` on the same `members` map via `firestore.get()`,
  and cap uploads at 20 MB and `image/*`.

`firestore.indexes.json` is intentionally empty — composite indexes get added as real
queries appear (Firestore's error gives a one-click creation link).

## Deploy identity (GitHub Actions)

- Workload identity pool `github`, provider `home-backlog`, pinned with
  `attribute.repository=='Senth/home-backlog'`.
- Service account `github-actions-deploy@home-backlog.iam.gserviceaccount.com` with
  `roles/firebasehosting.admin`, `roles/firebaserules.admin`, `roles/datastore.indexAdmin`,
  and `roles/iam.workloadIdentityUser` for that principal set.
- GitHub environment `prod` holds secrets `ENV` (contents of `.env.local`) and
  `GCP_PROJECT_NUMBER`.

`.github/workflows/deploy.yml` uses that identity and runs on every push to `main`:

```yaml
workload_identity_provider: projects/${{ secrets.GCP_PROJECT_NUMBER }}/locations/global/workloadIdentityPools/github/providers/home-backlog
service_account: github-actions-deploy@home-backlog.iam.gserviceaccount.com
```

⚠️ The deploy target list is `hosting,firestore:rules,firestore:indexes,storage` — the
sibling project has no Storage and its workflow omits the last one. `storage` is covered by
the same `roles/firebaserules.admin` as `firestore:rules`, but the first deploy is the
first time that is actually exercised.

Re-run `gh secret set ENV --env prod < .env.local` whenever `.env.local` changes.

## Not done yet

- App Check (reCAPTCHA Enterprise on web) — pre-launch.
- Cloud Functions REST API + API keys — MVP scope item, own task.
- Native auth persistence. `config/firebase.ts` calls `initializeAuth` without a
  persistence adapter, so a native build forgets the session on relaunch. The fix is
  `getReactNativePersistence(AsyncStorage)`, which exists only in Firebase's React Native
  build and is absent from the `firebase/auth` typings entry. Web is unaffected.
