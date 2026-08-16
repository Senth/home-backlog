# Operations

Infrastructure facts and gotchas that only matter occasionally. Day-to-day
rules live in [`CLAUDE.md`](../CLAUDE.md); setup and scripts in
[`README.md`](../README.md).

## Cloud project

There is one project, `home-backlog`, and it is production. Firestore and
Storage both live in **`europe-west1`**, which is permanent — neither can be
moved without recreating the project.

Auth is Google sign-in only. A new host has to be added to the
authorized-domain list in the Firebase console before login works there.

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`, which authenticates
through Workload Identity Federation (pool `github`, provider `home-backlog`,
pinned to this repo) as
`github-actions-deploy@home-backlog.iam.gserviceaccount.com` and deploys
hosting, Firestore rules and indexes, and Storage rules.

That service account holds `roles/firebasehosting.admin`,
`roles/firebaserules.admin`, `roles/datastore.indexAdmin`,
`roles/serviceusage.serviceUsageConsumer` and `roles/firebasestorage.viewer`.
The Service Usage one is not optional: the `storage` deploy target checks
`firebasestorage.googleapis.com` through the Service Usage API before it
uploads rules, and without it the whole deploy fails with a 403 that mentions
no service account at all. Adding a deploy target means checking the roles
again.

### Cloud Functions

`functions/` is a plain sibling npm package, not a yarn workspace — the root is
an Expo app whose Metro config, `@/` alias and jest preset all assume they own
the tree. The root `postinstall` runs `yarn --cwd functions install`, so one
`yarn install` covers both, and `yarn typecheck` and `yarn test` each run the
app's pass and then the function's.

The `predeploy` hook in `firebase.json` compiles TypeScript into
`functions/lib/` before the source is uploaded; `src/` is in the deploy `ignore`
list because the runtime only ever loads `lib/`. `engines.node` is `"22"` —
that is the **runtime the deploy picks**, not a constraint on the machine
installing, which is why `functions/.yarnrc` sets `--install.ignore-engines`.

The deploy service account needs, on top of the five roles above:

| Role | For |
| --- | --- |
| `roles/cloudfunctions.admin` | creating and updating the functions |
| `roles/run.admin` | v2 functions *are* Cloud Run services |
| `roles/artifactregistry.admin` | the container images the build produces |
| `roles/cloudbuild.builds.editor` | the build that produces them |
| `roles/storage.admin` | the `gcf-sources-*` upload bucket |
| `roles/iam.serviceAccountUser` | acting as the runtime service account |
| `roles/eventarc.admin` and `roles/pubsub.admin` | the `onDocumentDeleted` trigger, which is delivered through Eventarc over Pub/Sub |

`roles/serviceusage.serviceUsageConsumer` is already held; the first deploy also
has to have `cloudfunctions`, `cloudbuild`, `artifactregistry`, `run` and
`eventarc` **enabled as APIs** on the project. Enabling them needs
`roles/serviceusage.serviceUsageAdmin`, which the deploy account deliberately
does not hold — enable them once by hand in the console rather than granting a
CI identity the right to turn services on.

#### The `/api/**` rewrite has to come first

Hosting matches rewrites **in order**, and `**` catches everything. The `/api/**`
entry is therefore above it in `firebase.json`; move it below and every API call
is answered with `index.html` and a 200, which an agent reads as a successful
request that returned no data.

The rewrite names `europe-west1` explicitly. Hosting defaults a function rewrite
to `us-central1`, where this function does not exist.

#### The TTL policy on API run records

`users/{uid}/apiKeys/{keyId}/runs/{idempotencyKey}` holds a bulk create's
`ref` → id map for 24 hours so a repeated `Idempotency-Key` replays instead of
writing a second subtree. Firestore TTL is configured **per collection group and
is not carried by `firebase deploy`** — it is a one-off:

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=runs --enable-ttl --project=home-backlog
```

Without it nothing breaks and nothing is lost; the documents simply accumulate
forever. The emulator ignores TTL entirely, so this is invisible locally.

### Why the Storage rules are deployed through a target

`firebase.json` configures `storage` as an *array* with a `target`, and
`.firebaserc` maps that target to `home-backlog.firebasestorage.app`. That
shape is deliberate. With the plain object form the CLI has to discover the
bucket itself, and it does so with
`GET firebasestorage.googleapis.com/v1alpha/projects/home-backlog/defaultBucket`.
That call succeeds for a signed-in user but 404s for the deploy service
account, and the CLI turns any 404 into `Firebase Storage has not been set up
on project 'home-backlog'` — a message about the project that is really about
the caller. Storage was set up the whole time; granting
`roles/firebasestorage.viewer` (which does carry
`firebasestorage.defaultBucket.get`) did not change it. The array form skips
the lookup and releases the ruleset straight to the named bucket, so the
deploy needs nothing beyond `roles/firebaserules.admin`.

The `target` key is what keeps the emulators working: the Storage emulator
rejects an array entry without one. The `bucket` key next to it is what the
`firebase.json` schema wants, and deploy prefers `target` when both are
present. Renaming the bucket means editing `.firebaserc`, not `firebase.json`.
The rules tests are unaffected either way — `initializeTestEnvironment` in
`tests/rules/helpers.ts` uploads `storage.rules` to the emulator itself, which
is why the emulator's "storage targets in firebase.json will be ignored" line
under a `demo-` project id is harmless.

The `prod` GitHub environment holds the secrets `ENV` (the contents of
`.env.local`) and `GCP_PROJECT_NUMBER`. Run
`gh secret set ENV --env prod < .env.local` whenever `.env.local` changes —
nothing does it automatically, and a stale `ENV` ships a working build pointed
at the wrong config.

### The auth domain has to be set up in three places

Web sign-in is a redirect whose `authDomain` is the app's own origin rather
than `home-backlog.firebaseapp.com` — the *why* is in
[`specs/platform-offline.md`](specs/platform-offline.md). Three things have to
be true for a host, and only the first is visible from the Firebase console's
happy path:

1. The host is on the **authorized domains** list (Authentication → Settings).
   `hb.senth.org`, `home-backlog.web.app`, `home-backlog.firebaseapp.com` and
   `localhost` are on it.
2. `https://<host>/__/auth/handler` is an **authorized redirect URI** on the
   web OAuth client — the one named "Web client (auto created by Google
   Service)". This is added by hand in the Google Cloud console; there is no
   public API for it, so it cannot be scripted and it is the step that gets
   forgotten. The `firebaseapp.com` handler URI is kept alongside it, so the
   old auth domain still works and reverting costs nothing.
3. `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` in `.env.local` names the host, and that
   file has been pushed to the `ENV` secret above. Unset or blank, the app
   falls back to the origin it is served from, which is right for every
   Hosting-served origin and wrong for a local `expo export` preview on a port
   (the fallback drops the port).

Hosting serves `/__/auth/handler` on every domain it serves, so nothing needs
deploying for it — but **do not add a rewrite that shadows `/__/`**, and note
that `public/sw.js` passes that prefix straight through: a service worker that
caches it answers Google's handler with a copy of the app.

Local development is unaffected. `__DEV__` connects the Auth emulator, which
serves its own handler and its own account picker.

## Rules tests

`yarn test:rules` boots the emulators and runs `tests/rules/` against them,
serially, under the project id `demo-home-backlog-rules`. That id appears in
both the `test:rules` script and `tests/rules/helpers.ts` and the two must
agree: the emulators run in `singleProjectMode`, and `storage.rules` reaches
into Firestore with `firestore.get()`, which resolves against the emulator's
own project. A mismatch fails every upload test with a permission error that
looks like a rules bug and is not.

## Emulators

The Auth emulator intercepts `signInWithPopup`, so Google sign-in works locally
without a real Google account.
