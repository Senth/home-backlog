# Home Backlog

A home improvement project manager built around nested kanban boards, with a
second, independent hierarchy of places (rooms, floors, garden areas) that
projects are anchored to.

Web-first PWA via Expo + React Native Web; Android and iOS builds later.

- **Vision, requirements, decisions, architecture** — [`docs/PROJECT.md`](docs/PROJECT.md)
- **Working agreements for AI assistants** — [`CLAUDE.md`](CLAUDE.md)
- **User personas** — [`docs/PERSONAS.md`](docs/PERSONAS.md), the cast used by the
  `homeowner-review` and `ux-review` agents
- **Review gate** — [`/review`](.claude/skills/review/SKILL.md) hands every change to
  `code-review`, `ux-review` and `qa-review`, three agents that did not write it
- **Tasks** — GitHub Issues + the Kanban board; [`TODO.md`](TODO.md) is a generated mirror

## Stack

Expo · React Native · expo-router · react-native-paper (Material 3) ·
TypeScript · Firebase (Auth, Firestore, Storage, Hosting) · i18next.

There is deliberately **no Tailwind or NativeWind** — see
[`CLAUDE.md`](CLAUDE.md) for the styling rules that replace it.

## Getting started

```bash
yarn install
cp .env.example .env.local   # fill in from Firebase Console > Project Settings
```

Local development always targets the Firebase emulators — there is no dev
project, and the alternative is the live household data. Run them in one
terminal and the app in another:

```bash
yarn emulators   # UI 8060, Auth 8061, Firestore 8062, Storage 8063
yarn web         # http://localhost:8081
```

Google sign-in works against the Auth emulator's own account picker, so no real
Google account is needed locally.

## Scripts

| | |
|---|---|
| `yarn web` / `yarn android` / `yarn ios` | Start the dev server |
| `yarn emulators` | Firebase emulator suite |
| `yarn emulators:seed` | Emulator suite with the `.emulator-seed/` review fixture |
| `yarn emulators:export` | Overwrite `.emulator-seed/` from the running suite |
| `yarn lint` / `yarn lint --write` | Biome check / autofix |
| `yarn typecheck` | `tsc --noEmit` |
| `yarn test` | Unit tests |
| `yarn test:rules` | Security rules against the emulators |
| `yarn build:web` | Static web export to `dist/` |
| `yarn icons` | Regenerate every app and PWA icon |
| `yarn todo` | Regenerate `TODO.md` from the board |

## Deployment

Pushing to `main` runs `.github/workflows/deploy.yml`, which authenticates via
Workload Identity Federation and deploys hosting, Firestore rules and indexes,
and Storage rules to <https://hb.senth.org>. Service accounts, secrets and the
rest of the infrastructure detail live in
[`docs/OPERATIONS.md`](docs/OPERATIONS.md).
