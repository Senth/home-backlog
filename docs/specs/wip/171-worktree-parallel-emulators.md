# Worktree-parallel emulators

## Handoff

- This file is the implementation plan; `/continue-work` works the **Phases** in order,
  reviews, and ships.
- Read `CLAUDE.md` and `docs/OPERATIONS.md` (the dev-stack it documents) first. There is no
  Surface brief: the change is dev tooling and no screen, string or flow moves. Its durable
  home after `/ship` is `docs/OPERATIONS.md`, not an area spec.
- Nothing durable may live only in **Handoff**, **Acceptance** or **Phases**. `/ship` deletes
  all three.
- The run stops at a draft PR. The merge is the user's.

## What

Every `scripts/dev-stack.sh up` allocates a fresh, free block of ports in 7000–7999 — UI,
auth, firestore, storage, functions, hub, logging and the Expo web server — records it in
gitignored state under this worktree's `.tmp/dev-stack/`, and every client of those ports
reads the allocation instead of a literal. No surface: this is plumbing.

## Why

Issue #171: work on two features at once means two worktrees, and two worktrees cannot both
boot the stack. The ports are fixed literals in nine places — `firebase.json`,
`config/firebase.ts` (baked into the browser bundle), `playwright.config.ts`,
`e2e/support/firestore.ts`, `e2e/auth.setup.ts`, `e2e/rest-api.spec.ts`,
`tests/rules/helpers.ts` and `scripts/dev-stack.sh` — and beyond the raw collision there is
a trap: `dev-stack.sh`'s `port_open` check treats any listening port as "already up (not
ours)", so the second worktree does not fail, it silently adopts the first worktree's
emulator and runs its e2e against someone else's data.

There is no Firebase-native standard for this: the CLI cannot bind port 0 and has no
per-emulator port flags. The established pattern elsewhere (testcontainers, webpack
dev-server's `port: "auto"`) is allocate-at-boot plus a discovery channel, and Firebase's
adaptation of it is the `--config` flag: the generated `firebase.json` in `.tmp/dev-stack/`
carries the allocated ports, produced by rewriting only the `emulators` block of the
committed `firebase.json` (jq; everything else byte-identical, so rules paths, the storage
bucket and the functions predeploy come along untouched). The hub and logging emulators —
which `firebase.json` never pinned and which default to 4400/4500 — get allocated ports too;
two concurrent suites would fight over them exactly as they would over 8062.

Alternatives rejected:

- **Fixed ports forever, documented** — rejected; it is the behaviour the issue exists to
  kill, silent adoption included.
- **Deterministic per-worktree offset** (hash the worktree path into the range) — rejected;
  two hashes can land on one block, and it still knows nothing about what else listens in
  7000–7999.
- **Env vars only, no registry** — rejected; two `up`s scanning at the same moment can pick
  the same free ports (TOCTOU). The registry is the cheap fix: claims are atomic `mkdir`s
  under the **main** repo's `.tmp/dev-stack/registry/` (found via
  `git rev-parse --git-common-dir`, outside every worktree), each recording its owning pid
  and worktree, dead pids reclaimable, freed by `down`. Allocation bind-probes before
  claiming, so a foreign squatter in the range fails `up` loudly rather than silently.
- **`up` regenerating ports every call** — rejected for a *running* stack; the second `up`
  consults this worktree's own state file and, with live pids, does nothing. New ports are
  for a boot, not a re-ask.

No test dies with the literals: nothing today asserts a port number — the fixed values
appear only as inputs in test helpers, and the claims that read them get their ports from
the state instead.

## Data & queries

None. No Firestore field, index or query changes; nothing in any emulator database is read
or written differently.

## Rules & tests

No `firestore.rules` or `storage.rules` change. `tests/rules/helpers.ts` switches its
`initializeTestEnvironment` ports from literals to the allocation env that
`yarn test:rules` now sets; the rules test cases themselves are untouched.

## UI flow

None.

## Strings

None. No `t()` key added, changed or removed.

## Acceptance

1. [test] Two allocations against one fresh registry return disjoint port sets.
2. [test] A registry claim whose owning pid is dead is reclaimed by the next allocation;
   one whose pid is alive is skipped.
3. [eye]  A second `up` in a worktree whose stack is running reports "already up" and
   leaves every port in the state file unchanged.
4. [eye]  Two worktrees each run `up`, then `yarn e2e` passes in both at the same time.
5. [eye]  `down` in worktree A stops A's emulators and web and frees A's claims; worktree
   B's stack keeps serving and B's claims survive.
6. [eye]  `yarn test:rules` passes in two worktrees at the same time.
7. [eye]  `up --fresh` followed by `dev-stack.sh export` yields an `.emulator-seed`
   equivalent to the old `yarn emulators:export` flow, importable by a later `up`.
8. [eye]  No screen, flow, string or notification changed, and no `t()` key added or
   removed.

## What this does NOT change

- The command names and their jobs: `yarn e2e` boots its own stack; `dev-stack.sh up/down`;
  `yarn test:rules`. What changes under them is ports, not shapes.
- `up` stays idempotent and ownership-safe: `down` stops only what this worktree started,
  verified against the ports afterwards exactly as today.
- The `.emulator-seed` fixture: same import on boot, same export flow (now via
  `dev-stack.sh export`), same data.
- CI: one worktree, one stack, same gates.
- The `/review` skill's flow, which calls the same script.

## Out of scope

- Native dev targets: how a device build finds a stack on another host (Android loopback,
  LAN IPs) — web-first; in `__DEV__` with no allocated ports present, the app fails fast
  with a message naming `dev-stack.sh`, which is in scope.
- Parallel e2e across *CI* runners; CI is and stays a single stack.
- The sibling project's emulator range (8050–8052); different repo.
- Making `firebase.json`'s emulator ports mean anything again — they die with the literals.

## Phases

Phase 1  `scripts/alloc-ports.mjs` (scan 7000–7999, bind-probe, atomic claims in the main
         repo's registry, pid-liveness reclaim) + jest tests; `dev-stack.sh` rewired: `up`
         allocates, writes `stack.json` and the generated `firebase.json`, starts emulators
         and web (`--port`, `EXPO_PUBLIC_*` port env), no-ops on live state; `down` kills
         groups, frees claims, verifies ports; `status`; `export`.
Phase 2  Consumers: `config/firebase.ts` reads the port env and fails fast in `__DEV__`
         without it; `playwright.config.ts`, `e2e/support/firestore.ts`,
         `e2e/auth.setup.ts`, `e2e/rest-api.spec.ts` read the state; package.json scripts
         (`emulators` → `up --no-web`, `emulators:seed` dies into `up --fresh`,
         `emulators:export` → `dev-stack.sh export`, `test:rules` through the allocator
         with `--config` + port env); `tests/rules/helpers.ts` env ports; README +
         OPERATIONS updates. Gates green.
Phase 3  e2e specs for claims 1–2 (node-side, no browser needed); targeted
         `yarn playwright test --no-deps --grep '\b(1|2):'`; then the full `yarn e2e`, and
         the two-worktree runs for claims 3–7.
