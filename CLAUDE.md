# CLAUDE.md

Home Backlog — an Expo / React Native web-first PWA on Firebase.
Setup and scripts: [`README.md`](README.md) · vision and architecture:
[`docs/PROJECT.md`](docs/PROJECT.md) · infra and deploy:
[`docs/OPERATIONS.md`](docs/OPERATIONS.md) · feature specs:
[`docs/specs/`](docs/specs/).

- Package manager is **yarn**, not npm. Imports use the `@/` alias, never
  relative paths. Platform splits use `.web.tsx` / `.native.tsx`.
- Styling order: a `react-native-paper` component first, else a style prop
  built from `theme/tokens.ts`. No `StyleSheet.create`, no styled-components.
  There is deliberately **no Tailwind and no NativeWind** — do not reintroduce
  them (rationale in `docs/PROJECT.md`).
- **No numeric literal in a style prop** — spacing, radii and elevation come
  from `space` / `radius` / `elevation`; extend the scale rather than inlining.
- **No colour literal outside `theme/`** — use `useAppTheme()` from `@/theme`,
  never Paper's bare `useTheme()`, or `colors.warning` / `colors.success` lose
  their types.
- Every user-facing string goes through `t()`, and `i18n/locales/en-US.json`
  and `sv-SE.json` are updated in the same change.
- Local development always uses the emulators (`yarn emulators`); `__DEV__`
  wires them up. There is no dev project — the alternative is real household
  data.
- Firestore reads must be **query-safe, not just rule-safe**: a query is
  rejected entirely if any matching document could be denied. A board load runs
  `visibility == 'shared'` and `participantIds array-contains me` and merges
  client-side; never widen a node read rule past what those two can prove.
- Constrain every listener — never subscribe to a whole collection. The cost
  risk here is listener breadth, not data volume.
- Changing `firestore.rules` or `storage.rules` means updating `tests/rules/`
  in the same change.
- Must have tests: everything in `utils/` and `models/`, and every rule. Must
  not: snapshot tests, or component render tests that only assert layout —
  verify visuals in the browser instead.
- After implementing anything, run `yarn lint --write`, `yarn typecheck` and
  `yarn test`. Fix everything they report, including pre-existing failures.
- Icons are generated: change the art in `scripts/gen-icons.py` and run
  `yarn icons`. `TODO.md` is generated too — never hand-edit it, run `yarn
  todo`.
- Work lives in **GitHub Issues + the Kanban board** (project 4), not markdown.
  Labels: `bug`, `feature`, `idea`, `cleanup`. Move an issue to "In Progress"
  when you start it; close it from the PR with `Closes #NN`.
- Pushing to `main` deploys to production. There is only one cloud project.
