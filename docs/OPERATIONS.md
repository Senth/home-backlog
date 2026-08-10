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
`roles/firebaserules.admin`, `roles/datastore.indexAdmin` and
`roles/serviceusage.serviceUsageConsumer`. The last one is not optional: the
`storage` deploy target checks `firebasestorage.googleapis.com` through the
Service Usage API before it uploads rules, and without it the whole deploy
fails with a 403 that mentions no service account at all. Adding a deploy
target means checking the roles again.

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
