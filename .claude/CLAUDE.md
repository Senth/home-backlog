# CLAUDE.md

Home Backlog — an Expo / React Native web-first PWA on Firebase. Vision,
requirements and architecture live in [`docs/PROJECT.md`](../docs/PROJECT.md);
the provisioned cloud state in [`docs/SETUP.md`](../docs/SETUP.md); per-feature
specs in [`docs/specs/`](../docs/specs/).

## Styling — read this before writing any component

There is **no Tailwind and no NativeWind** in this project. That is deliberate:
NativeWind v5 is still a preview release, its React Native Web output needs CSS
specificity hacks to make `flex-1` and `flex-row` behave, and its one real
benefit — utility-class ergonomics for a human author — does not apply to a
codebase written by AI. Do not reintroduce it, and do not add `tailwindcss`,
`postcss` or `react-native-css-interop`.

The order of preference is:

1. **A `react-native-paper` component.** Paper is the design system. Card,
   Button, Chip, Appbar, Snackbar, Dialog, Menu, FAB, TextInput and friends
   already handle elevation, ripple, focus, dark mode and touch targets.
2. **A style prop built from tokens.** `style={{ flexDirection: "row",
   gap: space.sm }}`.
3. Nothing else. No `StyleSheet.create`, no styled-components, no class names.

Two hard rules replace what a utility framework would have enforced:

- **No numeric literal in a style prop.** Spacing, radii and elevation come from
  `theme/tokens.ts` (`space`, `radius`, `elevation`). If a value you need is not
  in the scale, add it to the scale — do not inline it.
- **No colour literal outside `theme/`.** Colours come from
  `useAppTheme().colors`. Use `useAppTheme()` from `@/theme`, never Paper's bare
  `useTheme()`, or `colors.warning` and `colors.success` lose their types.

## Internationalization

Every user-facing string goes through `useTranslation()` and `t()`. Both
`i18n/locales/en-US.json` and `i18n/locales/sv-SE.json` are updated in the same
change — a key present in one and missing from the other renders as the raw key
path, and `i18n/resolve-locale.test.ts` fails the build for it.

## Firebase

- **Local development always uses the emulators.** `config/firebase.ts` connects
  to them whenever `__DEV__` is true. There is no dev project; the alternative
  to the emulators is the household's real data. Start them with
  `yarn emulators` (UI 8060, Auth 8061, Firestore 8062, Storage 8063).
- The Auth emulator intercepts `signInWithPopup`, so Google sign-in works
  locally without a real Google account.
- **Reads must be query-safe, not just rule-safe.** Firestore rejects an entire
  query if any matching document could be denied. A board load runs two
  queries — `visibility == 'shared'` and `participantIds array-contains me` —
  and merges them client-side. Never widen a node read rule past what those two
  can prove.
- **Constrain every listener.** The cost risk in this project is listener
  breadth, not data volume. Never subscribe to a whole collection.
- Changing `firestore.rules` or `storage.rules` means updating
  `tests/rules/` in the same change.

## Testing

- **Must have tests**: everything in `utils/` and `models/`, and every rule in
  `firestore.rules` / `storage.rules`.
- **May have tests**: hooks with real branching.
- **Must not**: snapshot tests, or component render tests that only assert
  layout. Verify visual and interactive changes in the browser instead.
- `yarn test` runs the unit suite; `yarn test:rules` boots the emulators and
  runs `tests/rules/` against them, serially and under the
  `demo-home-backlog-rules` project.

## Conventions

- **Package manager is yarn.** Not npm.
- Imports use the `@/` path alias, never relative paths.
- Platform splits use `.web.tsx` / `.native.tsx` suffixes.
- Icons are generated, not drawn by hand: `yarn icons` regenerates every target
  from `scripts/gen-icons.py`. Change the art there.
- After implementing anything, run `yarn lint --write`, `yarn typecheck` and
  `yarn test`. Fix everything they report, including pre-existing failures.

## Tasks

- Work lives in **GitHub Issues + the Kanban board** (project 4), not in
  markdown. Use `gh issue list/view/create` and `gh project`. Labels: `bug`,
  `feature`, `idea`, `cleanup`.
- Move an issue to "In Progress" when you start on it.
- [`TODO.md`](../TODO.md) is a **generated mirror** of the board. Never
  hand-edit it; regenerate with `yarn todo`.
- Close issues from PRs with `Closes #NN`.
