# CLAUDE.md

Home Backlog: an Expo / React Native web-first PWA on Firebase.
[Setup and scripts](README.md) · [Vision and architecture](docs/PROJECT.md) ·
[Infra and deploy](docs/OPERATIONS.md) · [Feature specs](docs/specs/)

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
  exist, and a one-line wrapper around an SDK call is not a domain module.
- Local development is always the emulators (`yarn emulators`) — there is no dev
  project, and the alternative is real household data.
- Firestore queries must be provably safe, not just rule-safe — one deniable document
  rejects the whole query ([how a board load does it](docs/specs/boards-and-nodes.md)).
- Constrain every listener; never subscribe to a whole collection — the cost risk here
  is breadth, not volume.
- Changing `firestore.rules` or `storage.rules` means updating `tests/rules/` in the
  same change.
- The console is clean and its exceptions are a closed list — see "The console" in
  [`platform-offline.md`](docs/specs/platform-offline.md).
- After implementing: `yarn lint --write`, `yarn invariants`, `yarn typecheck`,
  `yarn test` — fix everything they report, including pre-existing failures.
- `yarn invariants` ([`scripts/check-invariants.sh`](scripts/check-invariants.sh)) is
  where the greppable rules above are enforced; a new rule here that a regex could
  catch goes in that script too.
- Then [`/review`](.claude/skills/review/SKILL.md) and ship only on a PASS — the
  session that wrote the code never signs it off.
- Features start with [`/new-feature`](.claude/skills/new-feature/SKILL.md), whose
  cleanup phase folds its wip spec into [`docs/specs/`](docs/specs/INDEX.md).
- Work lives in **GitHub Issues + the Kanban board** (project 4), not markdown —
  labels `bug` / `feature` / `idea` / `cleanup`, an `idea` moves to the Idea column,
  and the PR closes it with `Closes #NN`.
- Pushing to `main` deploys to production, so gate every merge on CI
  ([why](docs/OPERATIONS.md#merging-a-pr)).
