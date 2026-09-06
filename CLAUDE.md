# CLAUDE.md

Home Backlog: an Expo / React Native web-first PWA on Firebase.
[Setup and scripts](README.md), [Design contract](docs/DESIGN.md)

- Package manager is **yarn**, not npm; imports use the `@/` alias, never relative
  paths; platform splits are `.web.tsx` / `.native.tsx`.
- Reach for a `react-native-paper` component first, else a style prop built from
  `theme/tokens.ts` — no `StyleSheet.create`, and deliberately no Tailwind or NativeWind.
- **No numeric literal in a style prop and no color literal outside `theme/`** — use
  `space` / `radius` / `elevation` and `useAppTheme()`, and extend the scale rather
  than inlining.
- Every user-facing string goes through `t()`, with `en-US.json` and `sv-SE.json`
  updated in the same change.
- Domain modules and rules have tests; snapshot and layout-only render tests do not
  exist, and a one-line wrapper around an SDK call is not a domain module. `e2e/` is the
  exception that proves it: those drive a real browser, so asserting layout there is the
  visual check made exact, not a render test.
- Local development is always the emulators (`yarn emulators`).
- Firestore queries must be provably safe, not just rule-safe — one deniable document
  rejects the whole query.
- Changing `firestore.rules` or `storage.rules` means updating `tests/rules/` in the
  same change.
- The console is clean and its exceptions are a closed list: the filtered framework
  warnings in `utils/dev-console.ts` and the expected `info`/`log` prefixes in
  `e2e/support/app.ts`. Anything else is a finding.
- After implementing: `yarn lint --write`, `yarn invariants`, `yarn typecheck`,
  `yarn test` — fix everything they report, including pre-existing failures. e2e is the
  expensive one and runs whole: `scripts/dev-stack.sh up && yarn e2e`, once at the end of
  implement and once more after review, before ship; CI runs it on the PR. The ordered
  list is `[gates]` in [`.ai/config.toml`](.ai/config.toml), and that list is what a green
  report is measured against.
- Testing policy is [`docs/TESTS.md`](docs/TESTS.md): unit tests by default, **ten e2e
  spec files, hard cap**, enforced by `yarn invariants`, and everything else
  hand-checked once through the `playwright-cli` skill with no spec left behind. A new
  spec displaces a named one or it does not get written.
- `yarn invariants` ([`scripts/check-invariants.sh`](scripts/check-invariants.sh)) is
  where the greppable rules above are enforced; a new rule here that a regex could
  catch goes in that script too.
- **The workflow is not in this repo.** The stage logic, the dispatch rules and the review
  loop live in the global agents. This repo carries `.ai/config.toml` plus the `docs/`
  addons and nothing else — there are no repo skills and no repo agents, and adding one is
  the wrong fix.
  - [`.ai/config.toml`](.ai/config.toml): the ordered gates, what counts as user-visible,
    how to boot the stack and sign in (`[dev]`), and the design contract.
  - The `docs/` addons, read when present: [`PROJECT.md`](docs/PROJECT.md) (what this is),
    [`PERSONAS.md`](docs/PERSONAS.md) (who it is for), [`TESTS.md`](docs/TESTS.md) (how it
    is tested), [`DESIGN.md`](docs/DESIGN.md) (how it looks).
- Work you want carried to a PR starts with the `dispatcher` agent. Work that needs more
  than one phase goes to `planner` first, in its own session, which writes
  `.tmp/<source>-PLAN.md` — untracked, and pasted onto the issue.
- Ship only on a green review — the session that wrote the code never signs it off, and
  the `ship` skill opens a **draft** PR. The merge is the human's;
  [`scripts/create-pr-and-merge.sh`](scripts/create-pr-and-merge.sh) is the helper for it.
- Work lives in **GitHub Issues + the Kanban board** (project 4), not markdown —
  labels `bug` / `feature` / `idea` / `cleanup`, an `idea` moves to the Idea column,
  and the PR closes it with `Closes #NN`.
- One off migrations are stored in `node/scripts/<script>.mjs` and be removed before creating a PR.
  - Always dry-run first, then add --apply, finally dry-run again to confirm 0 changes.
