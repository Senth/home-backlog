/**
 * The app's entry point, ahead of `expo-router/entry`.
 *
 * It exists for one import. `@/utils/dev-console` replaces `console.warn` so the
 * `react-native-web` deprecations `react-native-paper` provokes stop drowning
 * the console that `/review` treats as a gate — and a filter only ever catches
 * what is warned *after* it is installed.
 *
 * `app/_layout.tsx` is not early enough, and that is not a detail worth
 * rediscovering: a module's imports are all evaluated before its own first
 * statement, and `expo-router/entry` evaluates the router, its dependencies and
 * whatever they touch before it ever reaches the root layout. The `shadow*`
 * warning fires in there. This file is the only place upstream of all of it.
 *
 * Nothing else belongs here. `package.json`'s `main` points at this file rather
 * than at `expo-router/entry`; see `docs/specs/platform-offline.md` — "The
 * console".
 */
import "@/utils/dev-console";

import "expo-router/entry";
