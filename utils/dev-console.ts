/**
 * The framework warnings this app cannot fix, silenced in development only.
 *
 * Three warnings fired on every load of every screen, none of them from code in
 * this repository: `react-native-paper` hands `react-native-web` a
 * `pointerEvents` prop, a `shadow*` style and an `Animated` config with
 * `useNativeDriver: true`, and `react-native-web` warns about all three. They
 * are pinned to the current versions in the sense that matters — `react-native-web`
 * is at its latest release and `react-native-paper`'s latest still passes all
 * three, so there is no bump that clears them and no change here that avoids
 * them short of not using Paper.
 *
 * A fourth rides along on one screen's path, not every load: opening
 * "Add a date" on a node's details renders `react-native-paper-dates`'s
 * `DatePickerModal`, which mounts `react-native-web`'s deprecated
 * `TouchableWithoutFeedback`. Same shape as the other three — a dependency we
 * do not control handing the web an old prop — so it takes an entry of its own
 * rather than a wider filter.
 *
 * Three of the four are `react-native-web` deprecations and are filtered
 * everywhere; the `useNativeDriver` one is filtered on the web only, because off
 * the web those same words report a genuinely missing native module. See
 * `webOnly` below.
 *
 * They matter because the review gate treats the console as a
 * gate. A console that is never quiet teaches the next reviewer, human or agent,
 * to read past it — which is exactly how a real error gets waved through. The
 * gate is 0 errors and 0 warnings, and the only exceptions are a real network
 * cut and a backend the browser cannot reach while it still believes it is
 * online. Firestore's transport warnings stay in both: `net::ERR_INTERNET_DISCONNECTED`
 * is Chrome's own line, unreachable from JavaScript, and the `WebChannelConnection`
 * warning is the same message a genuinely unreachable backend produces, so
 * silencing it hides the only clue in the failure nobody triggered.
 *
 * The obvious danger of a filter is that it hides a real warning that happens to
 * match, so the matching is deliberately narrow:
 *
 * - **`console.warn` only.** Nothing here is ever logged as an error, and an
 *   error is the thing the checklist most needs to keep seeing.
 * - **A long literal prefix**, not a keyword or a regular expression. Each entry
 *   below is the opening of the message as `react-native-web` spells it.
 * - **Development only.** `__DEV__` is false in an `expo export` bundle, so a
 *   production build never patches `console` at all.
 *
 * The match stops short of each message's trailing advice ("run `bundle exec pod
 * install`", "Use `boxShadow`") on purpose: that tail is the part a framework
 * release rewords, and a filter that fails *open* — noise returns, somebody
 * re-triages it — is the right failure. A filter that fails closed goes on
 * swallowing whatever the message became.
 */

import { Platform } from "react-native";

type KnownWarning = {
	/** Stable name for the summary line and the tests. */
	id: string;
	/** The literal opening of the message, matched with `startsWith`. */
	prefix: string;
	/** Why it cannot be fixed here rather than filtered. */
	why: string;
	/**
	 * Filtered on the web only, because off the web the same words are a real
	 * diagnostic rather than a deprecation.
	 */
	webOnly?: true;
};

export const KNOWN_FRAMEWORK_WARNINGS: readonly KnownWarning[] = [
	{
		id: "pointerEvents",
		prefix: "props.pointerEvents is deprecated",
		why: "react-native-paper passes the prop; every current release still does.",
	},
	{
		id: "shadowStyles",
		prefix: '"shadow*" style props are deprecated',
		why: "react-native-paper's Surface builds its elevation from shadow* styles.",
	},
	{
		id: "useNativeDriver",
		prefix:
			"Animated: `useNativeDriver` is not supported because the native animated module is missing",
		why: "There is no native animated module on the web. Permanent, not pending.",
		// Web only, and the distinction matters. This message is `react-native`'s
		// own `NativeAnimatedHelper`, not a `react-native-web` deprecation, and on
		// iOS or Android it means the native module is *genuinely* missing — its
		// own advice is to run `pod install`. Filtering it there would pre-install
		// a blind spot in the one line that explains a broken autolink, on the
		// native builds this project has not done yet.
		webOnly: true,
	},
	{
		id: "touchableWithoutFeedback",
		prefix: "TouchableWithoutFeedback is deprecated",
		why: "react-native-paper-dates' DatePickerModal renders it; every current release still does.",
	},
];

/**
 * The warnings filtered on this platform.
 *
 * Takes the platform rather than reading it, so the native behaviour is
 * reachable from a test running under jest-expo's web-ish environment.
 */
export function activeWarnings(
	platform: string = Platform.OS,
): readonly KnownWarning[] {
	return KNOWN_FRAMEWORK_WARNINGS.filter(
		(known) => !known.webOnly || platform === "web",
	);
}

/**
 * Whether a `console.warn` call is one of the known framework warnings.
 *
 * Exported for the tests, and because the predicate is the whole risk: it is
 * the only thing standing between "three lines of known noise" and "a warning
 * this app needed to see".
 */
export function isKnownFrameworkWarning(
	args: readonly unknown[],
	warnings: readonly KnownWarning[] = activeWarnings(),
): boolean {
	const [first] = args;
	if (typeof first !== "string") return false;
	return warnings.some((known) => first.startsWith(known.prefix));
}

/**
 * A console whose `warn` this module has already replaced.
 *
 * Fast Refresh re-runs module scope, and a second install would wrap the first
 * wrapper — harmless in behaviour, but it makes `restore` a lie and the stack a
 * ladder. The marker rides on the function so it survives a module reload,
 * which a module-scoped boolean would not.
 */
const PATCHED = Symbol.for("home-backlog.dev-console.patched");

type PatchedWarn = Console["warn"] & { [PATCHED]?: true };

/**
 * Replace `console.warn` so the known framework warnings do not reach it.
 *
 * The first one that is actually suppressed logs a single line naming the
 * filter, so the console says that it is filtered rather than simply being
 * quiet — a reviewer who finds three warnings missing should be able to find out
 * why from the console itself. That line goes out at *info* level on purpose:
 * the review gate counts errors and warnings, and a filter that leaves a warning
 * behind has only traded one for three.
 *
 * `warnings` defaults to what this platform filters; the tests pass it
 * explicitly so they do not depend on the `Platform.OS` the runner reports.
 *
 * Returns a function that puts the original `console.warn` back. Nothing in the
 * app calls it; the tests do.
 */
export function installDevConsoleFilter(
	target: Console = console,
	warnings: readonly KnownWarning[] = activeWarnings(),
): () => void {
	if (!__DEV__) return () => {};

	const original = target.warn as PatchedWarn;
	if (original[PATCHED]) return () => {};

	let announced = false;

	const filtered: PatchedWarn = (...args: unknown[]) => {
		if (isKnownFrameworkWarning(args, warnings)) {
			if (!announced) {
				announced = true;
				const ids = warnings.map((known) => known.id).join(", ");
				const line = `[dev-console] Filtering known react-native-web warnings (${ids}). See utils/dev-console.ts.`;
				// `info` where there is one, so the announcement does not itself
				// count against the console gate. A console without `info` is not
				// worth losing the line over.
				if (typeof target.info === "function") target.info(line);
				else original.call(target, line);
			}
			return;
		}
		original.apply(target, args);
	};
	filtered[PATCHED] = true;

	target.warn = filtered;
	return () => {
		target.warn = original;
	};
}

/**
 * Installed on import, not from a function call somewhere in `app/`.
 *
 * A module's imports are all evaluated before the first statement of its body,
 * so a call anywhere in `app/` runs *after* the router, its dependencies and
 * whatever they touch — and the `shadow*` warning fires in there, before the
 * root layout is ever reached. `index.ts` imports this module and then
 * `expo-router/entry`, which is the only ordering that catches it, and this is
 * why `package.json`'s `main` is a file in this repository.
 *
 * `installDevConsoleFilter` is a no-op unless `__DEV__`, so a production bundle
 * evaluates this line and changes nothing.
 *
 * Exported because the tests need the real `console` back: importing this module
 * is what patches it, and a test file that then warns for real would be filtered
 * by the thing it is testing.
 */
export const restoreGlobalConsole = installDevConsoleFilter();
