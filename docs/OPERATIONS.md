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

## Merging a PR

**Watch the run, then merge. Never `gh pr merge --auto`.**

```bash
GIT_VANILLA=1 gh pr create --base main --head <branch> --title "..." --body "..."
# The run is not registered the instant the PR exists, so poll for its id.
for _ in $(seq 30); do
  RUN=$(GIT_VANILLA=1 gh run list --branch <branch> \
          --workflow "PR - Lint, typecheck, test and build" \
          --limit 1 --json databaseId --jq '.[0].databaseId')
  [ -n "$RUN" ] && break || sleep 2
done

GIT_VANILLA=1 gh run watch "$RUN" --exit-status && GIT_VANILLA=1 gh pr merge <n> --squash
```

`--exit-status` makes `gh run watch` exit non-zero on a failed run, so the `&&`
is the whole gate: the merge only happens on green, and a red run leaves the PR
open.

The poll matters. `gh run list` returns an empty array for a few seconds after
`gh pr create`, and an empty `$RUN` makes `gh run watch` open its interactive
run picker — which hangs forever in a non-interactive session.

`--auto` does **not** do this, and the failure is silent. It queues a merge
behind *required status checks*, and this repo has none — branch protection is a
paid feature on a private repo, and `gh api repos/Senth/home-backlog/branches/main/protection`
returns `403 Upgrade to GitHub Pro`. With nothing required, `--auto` merges the
instant it is called. That merged #127 into `main` while its CI was still
running, and because pushing to `main` deploys, it shipped to production
unverified. It happened to be green.

Two things would make `--auto` mean what it says, neither of them in place:
making the repo public (branch protection is free there) or upgrading to Pro.
Until one of those, the `&&` above *is* the branch protection.

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

`roles/serviceusage.serviceUsageConsumer` was already held. **All of the above are
granted, and `cloudfunctions`, `cloudbuild`, `artifactregistry`, `run` and
`eventarc` are enabled** — done once, by hand, on 2026-08-19. Enabling an API needs
`roles/serviceusage.serviceUsageAdmin`, which the deploy account deliberately
does not hold: a CI identity that can turn services on can turn on billable ones.

#### What the *first* functions deploy needed, beyond those roles

The list above is what the deploy account needs. It is not the whole list of
what has to exist, and the rest was learned by watching the first deploy fail
four times. All of it is **done**; this is here so the next person recognises
the failure rather than rediscovering it.

`firebase-tools` tries to grant three **service-agent** bindings itself, and
cannot, because the deploy account has no `setIamPolicy`. It prints them and
stops before releasing anything — so the failure is safe, and the fix is to run
them once as an owner:

| Member | Role |
| --- | --- |
| `service-<project-number>@gcp-sa-pubsub.iam.gserviceaccount.com` | `roles/iam.serviceAccountTokenCreator` |
| `<project-number>-compute@developer.gserviceaccount.com` | `roles/run.invoker` |
| `<project-number>-compute@developer.gserviceaccount.com` | `roles/eventarc.eventReceiver` |

The last of those is what a v2 event-driven function needs to be delivered
anything; it is granted explicitly rather than left to the `roles/editor` the
runtime account inherits, because that inheritance is a default Google has been
narrowing for years.

Two more APIs are needed and are not in the list `firebase deploy` names up
front: **`cloudbilling.googleapis.com`** (a gen-2 function checks the billing
account) and **`firebaseextensions.googleapis.com`**.

The Artifact Registry **cleanup policy** has to be set once, or every deploy
exits non-zero *after* successfully deploying the functions — which reads like a
failed deploy and is not one:

```bash
firebase functions:artifacts:setpolicy --location=europe-west1 --force
```

It is set by hand rather than by adding `--force` to the deploy command, because
on `firebase deploy` that flag also deletes functions that have disappeared from
the source without asking.

Finally, the **first** 2nd-gen deploy in a project fails its Eventarc trigger
with *"Permission denied while using the Eventarc Service Agent … it may take a
few minutes"*. That one is real propagation and not a missing grant — check that
`service-<project-number>@gcp-sa-eventarc.iam.gserviceaccount.com` holds
`roles/eventarc.serviceAgent`, then wait and re-run. `api` and `createApiKey`
deploy on that attempt; only the trigger has to be retried.

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

**Done** — the policy is `ACTIVE` as of 2026-08-19. It is a *backstop*, not the
mechanism: revoking a key deletes its runs immediately through the
`onApiKeyDeleted` trigger, and this only reaches runs whose key still exists.

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

`yarn test:rules` runs `tests/rules/` against its own Firestore and Storage
emulators, serially, under the project id `demo-home-backlog-rules`. That id
appears in both `scripts/test-rules.mjs` and `tests/rules/helpers.ts` and the
two must agree: the emulators run in `singleProjectMode`, and `storage.rules`
reaches into Firestore with `firestore.get()`, which resolves against the
emulator's own project. A mismatch fails every upload test with a permission
error that looks like a rules bug and is not.

`scripts/test-rules.mjs` allocates a fresh port block through
`scripts/alloc-ports.mjs` — firestore and storage, plus the hub and the
logging emulator, which run beside whatever `--only` names — writes a
generated `firebase.rules-tests.json` at the worktree root, and runs jest
inside `firebase emulators:exec` with the ports in the `EMULATOR_*_PORT`
environment, which `tests/rules/helpers.ts` reads. Nothing is a fixed port,
so two worktrees can run the suite at the same time.

## One-off migrations

A change that **narrows what `firestore.rules` accepts** has to migrate the stored
documents *before* it merges, because pushing to `main` deploys production. The
rules validate `request.resource.data` — the *full post-update* document — so a
node still holding a value the new rules reject has **every** update to it denied,
including the `childCount` bump that adding a step to the project above it
performs. Nothing in the app can unstick that.

The scripts live in `functions/scripts/`, because that is the package that depends
on `firebase-admin`; `firebase.json` lists `scripts` in the functions `ignore`, so
they are never part of the deployed upload. They run under Application Default
Credentials (`gcloud auth application-default login`), report by default, and
write only with `--apply`:

```bash
node functions/scripts/<script>.mjs --project home-backlog            # dry run
node functions/scripts/<script>.mjs --project home-backlog --apply    # write
node functions/scripts/<script>.mjs --project home-backlog            # 0 changes
```

The third line is the point: every script is idempotent and skips a settled
document, so a clean second dry run is the proof the migration finished. A write
that fails is named on stderr and exits non-zero rather than being swallowed.

**Run `--apply` again once the deploy has landed.** Between the migration and the
new build reaching every browser, the old one is still live and can still write
the value the new rules reject — and that node is then stuck with nothing to say
so. The re-run costs one collection-group read.

The same script migrates `.emulator-seed/`, which is the other place stored
documents live:

```bash
scripts/dev-stack.sh up --no-web   # imports .emulator-seed; ports in .tmp/dev-stack/stack.json
FIRESTORE_EMULATOR_HOST=127.0.0.1:$(jq -r .ports.firestore .tmp/dev-stack/stack.json) \
  node functions/scripts/<script>.mjs --project home-backlog --apply
scripts/dev-stack.sh export
```

Written so far:

| Script | What it did |
| ------ | ----------- |
| `migrate-99-statuses.mjs` | [#99](https://github.com/Senth/home-backlog/issues/99) — rewrote `status` `research` / `planning` / `review` to `execution`, and every `columns` array to the four that survived. |
| `migrate-102-participants.mjs` | [#102](https://github.com/Senth/home-backlog/issues/102) — gave every shared **root** still holding `participantIds: []` the uids of its home's current members, so the empty list stops meaning "everybody, including whoever joins later". |

## Emulators

The Auth emulator serves its own sign-in widget, so Google sign-in works locally
without a real Google account. The web flow is a **redirect**, not a popup — see
`components/auth/GoogleSignIn.web.tsx` — so signing in leaves the app for the
Auth emulator's account picker on the port this worktree's stack allocated (see
`scripts/dev-stack.sh status`), picks an account from
`.emulator-seed/auth_export`, and comes back. One tab throughout.

### The local stack

`scripts/dev-stack.sh` owns bringing the emulators and the Expo web server up and
down. Three callers share it: you, `yarn e2e` (which boots it before running the
suite), and the `/review` skill.

```bash
scripts/dev-stack.sh up      # idempotent; imports .emulator-seed
scripts/dev-stack.sh up --no-web   # emulators only
scripts/dev-stack.sh up --fresh    # boot empty, for rebuilding the fixture
scripts/dev-stack.sh status  # which ports are listening, and whose they are
scripts/dev-stack.sh export  # overwrite .emulator-seed from the running stack
scripts/dev-stack.sh down    # stops only what it started
```

Every `up` that actually boots something allocates a fresh block of ports in
7000–7999 — the emulators, the web server, and the hub and logging emulator too,
which `firebase.json` never pinned and which default to 4400/4500, so two
concurrent suites would fight over them exactly as over any other port —
through `scripts/alloc-ports.mjs`: each port is bind-probed, then claimed by an
atomic mkdir in the **main** repo's registry (`git rev-parse --git-common-dir`,
so every worktree shares one book), and a claim whose owning pid is dead is
reclaimed by the next allocation. The allocation lands in
`.tmp/dev-stack/stack.json`, and the emulators run against a generated
`firebase.dev-stack.json` at the worktree root — the committed `firebase.json`
with only its `emulators` block rewritten, everything else spliced through byte
for byte so rules paths, the storage bucket and the functions predeploy survive
a reflow they never asked for (at the root, because the CLI pins the project
root to the config file's directory). Consumers read the
allocation instead of literals: `playwright.config.ts` and the e2e helpers
read `stack.json`, the web bundle gets its ports as `EXPO_PUBLIC_EMULATOR_*`,
and a dev app started without them fails fast naming `dev-stack.sh`. Two
worktrees can each run a full stack at once; `yarn e2e` and `yarn test:rules`
in one never touch the other's ports.

There is no Firebase-native standard underneath this: the CLI cannot bind port
0 and has no per-emulator port flags. The alternatives were rejected for
concrete reasons. Fixed ports forever is the behaviour the issue exists to
kill. A deterministic per-worktree offset puts two worktrees on one block and
knows nothing about a foreign squatter. Env vars alone race, because two `up`s
scanning at the same moment can pick the same free ports — which is why the
claims are atomic `mkdir`s rather than a convention. And a running stack never
re-allocates: new ports are for a boot, not a re-ask.

`up` is idempotent and never adopts a foreign stack: what it trusts is this
worktree's own `stack.json` and the pids recorded in it, and nothing else. A
port that is listening without a live recorded pid is somebody else's — `up`
allocates its own block around it, and `down` still only ever stops what this
worktree started. `status` marks each port `ours` or `external`, and that
distinction matters for review: a stack you did not start holds whatever data
the last session left in it, not the committed fixture. The distinction is also
why the script exists: its predecessor read any listening port as "already up
(not ours)", so a second worktree did not fail, it silently adopted the first
worktree's emulator and ran its e2e against someone else's data — the behaviour
issue #171 exists to kill.

Two traps, both of which cost real time before this script existed, and one of
which cost it again while writing this:

- **Never `pkill -f "firebase emulators:start"`** — or `pkill -f "playwright
  test"`, for the same reason. The pattern matches the shell running the command,
  so it kills itself before reaching the target.
- `yarn` is a wrapper. Killing its pid leaves the `firebase` child holding the
  ports. Everything is started under `setsid`, so its pid is also its process
  group id, and `down` signals the group.

### End-to-end tests

`yarn e2e` brings that stack up and then runs `playwright test` against it. Use
the yarn script rather than `npx playwright test`, which assumes the stack is
already running: Playwright's own `webServer` block expects a command that stays
in the foreground, and `dev-stack.sh up` deliberately returns once the ports
answer. It covers what a browser agent used to walk by hand: the console, an
offline write surviving a reload, reload and back, deep links, contrast in both
colour schemes, touch-target size, horizontal overflow, clipped control labels,
and untranslated `sv-SE` strings.
Which of those is measured in which project is not a free choice — see [where a
new spec goes](#where-a-new-spec-goes) below.

Two things it depends on, both easy to break by regenerating the fixture:

- `e2e/auth.setup.ts` signs in as **Marcus** and opens the home **Huset**. The
  tab routes bounce to `/homes` without an active home, so a suite that stopped
  at the home list would assert the wrong screen five times and still go green.
- `e2e/support/app.ts` waits on a **readiness marker** per route — a seeded title
  such as `Renovera badrummet`. `networkidle` is not enough: Firestore's
  WebChannel never goes quiet, so the page is "idle" while the board still shows
  its empty state.

#### Where a new spec goes

The suite is projects crossed over two axes and two exceptions, and putting a new
spec in the wrong one costs a duplicate pass — the same measurement made twice,
paid for on every PR forever. Five questions, in order:

**Does its claim need the app at all?** A claim about the dev stack's own
machinery — the port allocator, the stack scripts — goes in the `node`
project: browserless, no signed-in state, no viewport, no locale, and no
dependency on the setup project, because it needs none of what setup builds.
It starts as soon as the suite does, beside setup rather than after it, and
never opens the app in a browser. Its config still reads `stack.json` at load,
so the stack must exist — it just never visits it. One rule learned the hard
way: the 7000–7999 range is shared with every other worktree on the machine,
so a spec there may not assume a port it probed free stays free until its
assertion runs; assert the invariant, not the port's identity.

**Does it write to the emulator?** Then it goes in the `writes` project,
whatever else is true of it. That project runs one worker and runs last, after
every read-only project has finished, because the emulator is one shared backend
and there is no other way to keep a write out of somebody else's assertion.
Everything else runs in parallel.

Only a spec that *writes* belongs there. A read-only spec that asserts a number
the fixture fixes — a column chip's count, a card's step count — is safe exactly
because of that ordering: every reader has finished before the first writer
starts, so no foreign card exists yet to make it wrong. `i18n.spec.ts` counts
column chips and stays read-only for that reason. Moving a reader into `writes`
to protect it buys nothing and costs it the projects it was running in.

**Does its claim depend on the width?** If it pins its own viewport with
`test.use({ viewport })` or `page.setViewportSize`, it belongs to exactly one
project: the axis cannot tell it anything it has not already decided for itself.
Only a spec that takes the project's viewport earns a run at both.

**Does its claim depend on the locale?** Swedish exists in this suite for one
reason — longer words — so the Swedish projects run `craft` and `i18n` and
nothing else. Behaviour is behaviour in every language.

**Does its claim depend on the colour scheme?** Almost nothing does. Only the
palette changes with the scheme, so contrast is the only measurement in the app
a scheme can move; a box is the same box in the dark. A test that is genuinely
about colour goes in `craft.spec.ts`'s scheme loop, which tags the dark half
`@dark` so the Swedish projects can `grepInvert` it — a contrast ratio is the
same ratio whatever the words say.

Prefer light and `en-US` when a run has to be dropped, and when two answers seem
equally defensible, drop the run: a claim asserted twice is a claim asserted
once, plus a bill.
