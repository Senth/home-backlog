# Home Backlog

A home improvement project manager built around nested kanban boards, with a
second, independent hierarchy of places (rooms, floors, garden areas) that
projects are anchored to.

Web-first PWA via Expo + React Native Web; Android and iOS builds later.

- **Vision, requirements, decisions, architecture** — [`docs/PROJECT.md`](docs/PROJECT.md)
- **Working agreements for AI assistants** — [`CLAUDE.md`](CLAUDE.md)
- **User personas** — [`docs/PERSONAS.md`](docs/PERSONAS.md), the cast a review judges as
- **Testing policy** — [`docs/TESTS.md`](docs/TESTS.md): unit tests by default, ten e2e
  specs at most, the rest hand-checked
- **Workflow** — not in this repo. The stages live in the global agents; the repo carries
  [`.ai/config.toml`](.ai/config.toml) and the `docs/` addons. Hand work to `dispatcher`,
  or to `planner` first when it needs more than one phase
- **Review gate** — the gates in `[gates]` run first, then a code review and, when the
  change is user-visible, a browser review in a real browser — agents that did not write it
- **Tasks** — GitHub Issues + the Kanban board

## Stack

Expo · React Native · expo-router · react-native-paper (Material 3) ·
TypeScript · Firebase (Auth, Firestore, Storage, Hosting) · i18next.

## Getting started

```bash
yarn install
cp .env.example .env.local   # fill in from Firebase Console > Project Settings
```

Local development always targets the Firebase emulators — there is no dev
project, and the alternative is the live household data. Run them in one
terminal and the app in another:

```bash
scripts/dev-stack.sh up      # emulators + web, idempotent, imports .emulator-seed
scripts/dev-stack.sh status  # what is listening, and whether it is yours
scripts/dev-stack.sh down    # stops only what it started
```

Every `up` allocates a fresh block of ports in 7000–7999, so two worktrees can
each run their own stack at once. Or just the emulators, with the web server
as a second step:

```bash
yarn emulators               # emulators only, detached; ports via scripts/dev-stack.sh status
scripts/dev-stack.sh up      # adds the web server and prints its URL
```

The REST API lives in `functions/`, a sibling npm package that `yarn install`
sets up through the root `postinstall`. Against the emulators it answers at
`http://127.0.0.1:<functions port>/home-backlog/europe-west1/api/v1/health`,
with the port from `scripts/dev-stack.sh status`; in production
Hosting rewrites `/api/**` to it, so it is `https://hb.senth.org/api/v1/health`.

Its contract is [`functions/SKILL.md`](functions/SKILL.md), an installable agent
skill that the deployment also serves at `/api/v1/skill.md`, stamped with the
`api-version` it is actually running. A vendored copy stays usable and re-fetches
itself only when that version and the `X-Api-Version` header disagree. Editing
that file **is** editing the published contract, and `yarn invariants` holds its
frontmatter to `functions/src/version.ts`.

Google sign-in works against the Auth emulator's own account picker, so no real
Google account is needed locally.

## Scripts

|                                          |                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `yarn web` / `yarn android` / `yarn ios` | Start the dev server                                                   |
| `yarn emulators`                         | Emulators only, detached (`scripts/dev-stack.sh up --no-web`)          |
| `yarn emulators:export`                  | Overwrite `.emulator-seed/` from the running stack                     |
| `yarn lint` / `yarn lint --write`        | Biome check / autofix                                                  |
| `yarn invariants`                        | The grep-shaped `CLAUDE.md` invariants (`scripts/check-invariants.sh`) |
| `yarn typecheck`                         | `tsc --noEmit`                                                         |
| `yarn test`                              | Unit tests                                                             |
| `yarn test:rules`                        | Security rules against the emulators                                   |
| `yarn e2e`                               | End-to-end + craft suite (Playwright + axe); needs the stack up        |
| `yarn e2e:report`                        | Open the last `yarn e2e` HTML report                                   |
| `yarn build:web`                         | Static web export to `dist/`                                           |
| `yarn icons`                             | Regenerate every app and PWA icon from `scripts/gen-icons.py`          |
