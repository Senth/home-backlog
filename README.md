# Home Backlog

A home improvement project manager built around nested kanban boards, with a
second, independent hierarchy of places (rooms, floors, garden areas) that
projects are anchored to.

Web-first PWA via Expo + React Native Web; Android and iOS builds later.

- **Vision, requirements, decisions, architecture** — [`docs/PROJECT.md`](docs/PROJECT.md)
- **Working agreements for AI assistants** — [`CLAUDE.md`](CLAUDE.md)
- **User personas** — [`docs/PERSONAS.md`](docs/PERSONAS.md), the cast used by the
  `homeowner-review` agent at spec time
- **Review gate** — [`/review`](.claude/skills/review/SKILL.md) hands every change to
  `code-review`, then `browser-review` in a real browser — agents that did not write it
- **Tasks** — GitHub Issues + the Kanban board

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
yarn emulators   # UI 8060, Auth 8061, Firestore 8062, Storage 8063, Functions 8064
yarn web         # http://localhost:8081
```

The REST API lives in `functions/`, a sibling npm package that `yarn install`
sets up through the root `postinstall`. Against the emulators it answers at
`http://127.0.0.1:8064/home-backlog/europe-west1/api/v1/health`; in production
Hosting rewrites `/api/**` to it, so it is `https://hb.senth.org/api/v1/health`.

Its contract is [`functions/SKILL.md`](functions/SKILL.md), which the deployment
serves at `/api/v1/skill.md` — an agent fetches the one it is actually talking
to rather than a vendored copy. Editing that file **is** editing the published
contract.

Google sign-in works against the Auth emulator's own account picker, so no real
Google account is needed locally.

## Scripts

|                                          |                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `yarn web` / `yarn android` / `yarn ios` | Start the dev server                                                   |
| `yarn emulators`                         | Firebase emulator suite                                                |
| `yarn emulators:seed`                    | Emulator suite with the `.emulator-seed/` review fixture               |
| `yarn emulators:export`                  | Overwrite `.emulator-seed/` from the running suite                     |
| `yarn lint` / `yarn lint --write`        | Biome check / autofix                                                  |
| `yarn invariants`                        | The grep-shaped `CLAUDE.md` invariants (`scripts/check-invariants.sh`) |
| `yarn typecheck`                         | `tsc --noEmit`                                                         |
| `yarn test`                              | Unit tests                                                             |
| `yarn test:rules`                        | Security rules against the emulators                                   |
| `yarn build:web`                         | Static web export to `dist/`                                           |
| `yarn icons`                             | Regenerate every app and PWA icon                                      |

## Deployment

Pushing to `main` runs `.github/workflows/deploy.yml`, which authenticates via
Workload Identity Federation and deploys hosting, Firestore rules and indexes,
and Storage rules to <https://hb.senth.org>. Service accounts, secrets and the
rest of the infrastructure detail live in
[`docs/OPERATIONS.md`](docs/OPERATIONS.md).
