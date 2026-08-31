# CLAUDE.md

Home Backlog: an Expo / React Native web-first PWA on Firebase.
[Setup and scripts](README.md), [Design contract](docs/DESIGN.md)

- Package manager is **yarn**, not npm; imports use the `@/` alias, never relative
  paths; platform splits are `.web.tsx` / `.native.tsx`.
- Reach for a `react-native-paper` component first, else a style prop built from
  `theme/tokens.ts` — no `StyleSheet.create`, and deliberately no Tailwind or NativeWind.
- **No numeric literal in a style prop and no colour literal outside `theme/`** — use
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
  `yarn test` — fix everything they report, including pre-existing failures. e2e is
  targeted per phase: `yarn playwright test --project=setup && yarn playwright test
--no-deps --grep '\b(<claims>):'` after `scripts/dev-stack.sh up`, for the claim numbers
  the phase owns from the spec's `[test]` tags — `--no-deps` because the `writes` project
  depends on the read-only ones and would drag them all in. The full `yarn e2e` runs once
  at the end of implement and once more after review, before ship; CI runs it on the PR.
- `yarn invariants` ([`scripts/check-invariants.sh`](scripts/check-invariants.sh)) is
  where the greppable rules above are enforced; a new rule here that a regex could
  catch goes in that script too.
- Work runs in two sessions. A kickoff — [`/new-feature`](.claude/skills/new-feature/SKILL.md)
  · [`/cleanup`](.claude/skills/cleanup/SKILL.md) · [`/bug`](.claude/skills/bug/SKILL.md) —
  ends at a confirmed plan at `.tmp/<issue-id>-plan.md` (untracked; pasted onto the issue)
  and writes no code. Then
  [`/continue-work`](.claude/skills/continue-work/SKILL.md) takes it to a draft PR:
  [`/implement`](.claude/skills/implement/SKILL.md) →
  [`/review`](.claude/skills/review/SKILL.md) → [`/ship`](.claude/skills/ship/SKILL.md),
  checkpointed in `.tmp/continue-work.state.json`. All three remain callable standalone.
- Everything that writes code is dispatched to GLM through `oc-task`; the spec, the
  dispatch and the PASS/FAIL stay with Claude. `homeowner-review` is the exception and
  stays an Opus subagent.
- `.ai/config.toml` is what a stage reads for the gate commands, what counts as
  user-visible, the design contract and the report and checkpoint paths.
- Ship only on a PASS — the session that wrote the code never signs it off, and
  `/ship` opens a **draft** PR through `scripts/create-pr-and-merge.sh --no-merge`.
- Work lives in **GitHub Issues + the Kanban board** (project 4), not markdown —
  labels `bug` / `feature` / `idea` / `cleanup`, an `idea` moves to the Idea column,
  and the PR closes it with `Closes #NN`.
- One off migrations are stored in `node/scripts/<script>.mjs` and be removed before creating a PR.
  - Always dry-run first, then add --apply, finally dry-run again to confirm 0 changes.
