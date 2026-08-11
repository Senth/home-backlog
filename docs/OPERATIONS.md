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
