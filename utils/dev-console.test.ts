import { readFileSync } from "node:fs";
import {
	activeWarnings,
	installDevConsoleFilter,
	isKnownFrameworkWarning,
	KNOWN_FRAMEWORK_WARNINGS,
	restoreGlobalConsole,
} from "@/utils/dev-console";

// The only remaining entry is web-only, and the module-scope suite below
// exercises the self-install against the default `activeWarnings()`. jest-expo
// reports `ios` unless told otherwise, so pin the platform the app ships: the
// web.
jest.mock("react-native", () => ({
	Platform: { OS: "web", select: (o: { web: unknown }) => o.web },
}));

// Importing the module is what patches the real `console.warn`. Undo it here,
// or a warning this suite emits for real is swallowed by the thing it is
// testing — and every case below uses a fake console anyway.
restoreGlobalConsole();

/**
 * The message verbatim, as `react-native-web` emits it. It is checked against
 * the installed package below, so a framework release that rewords it fails
 * here rather than silently leaving the filter matching nothing.
 */
const REAL_MESSAGES = {
	useNativeDriver:
		"Animated: `useNativeDriver` is not supported because the native animated module is missing. Falling back to JS-based animation. To resolve this, add `RCTAnimation` module to this app, or remove `useNativeDriver`. Make sure to run `bundle exec pod install` first. Read more about autolinking: https://github.com/react-native-community/cli/blob/master/docs/autolinking.md",
} as const;

/**
 * Where the message is written, in the installed `react-native-web`.
 *
 * Resolved from this file, not from the working directory: a jest run started
 * from a subdirectory, or a package that is not hoisted into the root
 * `node_modules`, must still find the installed source.
 */
const UPSTREAM: Record<keyof typeof REAL_MESSAGES, string> = {
	useNativeDriver: require.resolve(
		"react-native-web/dist/vendor/react-native/Animated/NativeAnimatedHelper.js",
	),
};

/**
 * The file with its string concatenation folded away.
 *
 * The long `useNativeDriver` message is written as five adjacent literals joined
 * by `+`, so searching the source for the message as the browser receives it
 * finds nothing until the joins are removed.
 */
function upstreamText(path: string): string {
	return (
		readFileSync(path, "utf8")
			// `'Animated: … native ' + 'animated module is missing. …'`
			.replace(/(['"])\s*\+\s*\1/g, "")
			// `"\"shadow*\" style props are deprecated."`
			.replace(/\\(['"])/g, "$1")
	);
}

/** The full set, regardless of what platform the test run reports. */
const ON_WEB = activeWarnings("web");

type FakeConsole = Console & {
	warn: jest.Mock;
	error: jest.Mock;
	info: jest.Mock;
};

function fakeConsole(): FakeConsole {
	return {
		warn: jest.fn(),
		error: jest.fn(),
		info: jest.fn(),
	} as unknown as FakeConsole;
}

/**
 * The lines that reached the real `warn`. It takes the original mock rather than
 * the console, because installing replaces `console.warn` with a plain function
 * that has no `.mock`.
 */
function passedThrough(warn: jest.Mock): unknown[][] {
	return warn.mock.calls;
}

function setDev(value: boolean): void {
	(globalThis as unknown as { __DEV__: boolean }).__DEV__ = value;
}

const wasDev = __DEV__;
afterEach(() => setDev(wasDev));

describe("isKnownFrameworkWarning", () => {
	it.each(Object.entries(REAL_MESSAGES))(
		"matches the real %s message",
		(_id, message) => {
			expect(isKnownFrameworkWarning([message], ON_WEB)).toBe(true);
		},
	);

	it.each(Object.entries(UPSTREAM))(
		"still matches what the installed react-native-web writes for %s",
		(id, path) => {
			const known = KNOWN_FRAMEWORK_WARNINGS.find((k) => k.id === id);
			if (!known) throw new Error(`no entry for ${id}`);
			const source = upstreamText(path);

			// The prefix has to be findable in the package, and the fixture has to
			// be the message the package actually builds. Without this the fixture
			// and the prefix drift together and the suite stays green while the
			// filter matches nothing.
			expect(source).toContain(known.prefix);
			expect(source).toContain(REAL_MESSAGES[id as keyof typeof REAL_MESSAGES]);
		},
	);

	it("has a fixture for every entry, and an entry for every fixture", () => {
		expect(KNOWN_FRAMEWORK_WARNINGS.map((known) => known.id).sort()).toEqual(
			Object.keys(REAL_MESSAGES).sort(),
		);
	});

	it("passes an unrelated warning", () => {
		expect(isKnownFrameworkWarning(["Could not save the card:"], ON_WEB)).toBe(
			false,
		);
	});

	it("passes a warning that only contains the phrase", () => {
		// `startsWith`, never `includes` — an app message that quotes a
		// deprecation while reporting something real must still be seen.
		expect(
			isKnownFrameworkWarning(
				[`Board render failed: ${REAL_MESSAGES.useNativeDriver}`],
				ON_WEB,
			),
		).toBe(false);
	});

	it("filters the useNativeDriver message on the web only", () => {
		// Off the web that message is `react-native` reporting a genuinely missing
		// native module, and its own advice is to run `pod install`. Swallowing it
		// on a native build would hide the one line explaining a broken autolink.
		expect(activeWarnings("web").map((k) => k.id)).toContain("useNativeDriver");
		expect(activeWarnings("ios").map((k) => k.id)).not.toContain(
			"useNativeDriver",
		);
		expect(activeWarnings("android").map((k) => k.id)).not.toContain(
			"useNativeDriver",
		);

		const native = activeWarnings("ios");
		expect(
			isKnownFrameworkWarning([REAL_MESSAGES.useNativeDriver], native),
		).toBe(false);
	});

	it("passes a non-string first argument", () => {
		expect(
			isKnownFrameworkWarning([new Error(REAL_MESSAGES.useNativeDriver)]),
		).toBe(false);
		expect(isKnownFrameworkWarning([], ON_WEB)).toBe(false);
	});
});

describe("installDevConsoleFilter", () => {
	beforeEach(() => setDev(true));

	it("swallows the known warnings and keeps everything else", () => {
		const target = fakeConsole();
		const warn = target.warn;
		installDevConsoleFilter(target, ON_WEB);

		for (const message of Object.values(REAL_MESSAGES)) target.warn(message);
		target.warn("Could not reach Firestore");
		target.warn({ reason: "an object nobody stringified" });

		expect(passedThrough(warn)).toEqual([
			["Could not reach Firestore"],
			[{ reason: "an object nobody stringified" }],
		]);
	});

	it("forwards every argument of a warning it lets through", () => {
		const target = fakeConsole();
		const warn = target.warn;
		installDevConsoleFilter(target, ON_WEB);

		const reason = new Error("denied");
		target.warn("Could not save the card:", reason);

		expect(passedThrough(warn)).toEqual([["Could not save the card:", reason]]);
	});

	it("announces itself once, at info level, and only when it suppresses something", () => {
		const target = fakeConsole();
		const warn = target.warn;
		installDevConsoleFilter(target, ON_WEB);

		target.warn("Could not reach Firestore");
		expect(target.info).not.toHaveBeenCalled();

		target.warn(REAL_MESSAGES.useNativeDriver);
		target.warn(REAL_MESSAGES.useNativeDriver);

		// Info, not warn: the review gate counts warnings, and a filter that
		// leaves one behind has traded three lines for one rather than cleaning
		// the console.
		expect(target.info).toHaveBeenCalledTimes(1);
		expect(passedThrough(warn)).toEqual([["Could not reach Firestore"]]);
		// The line has to be findable from the console alone, so it names the
		// file that explains the decision.
		expect(target.info.mock.calls[0][0]).toContain("utils/dev-console.ts");
	});

	it("falls back to warn on a console with no info", () => {
		const target = { warn: jest.fn() } as unknown as FakeConsole;
		const warn = target.warn;
		installDevConsoleFilter(target, ON_WEB);

		target.warn(REAL_MESSAGES.useNativeDriver);

		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain("[dev-console]");
	});

	it("leaves console.error alone", () => {
		const target = fakeConsole();
		installDevConsoleFilter(target, ON_WEB);

		target.error(REAL_MESSAGES.useNativeDriver);

		expect(target.error).toHaveBeenCalledWith(REAL_MESSAGES.useNativeDriver);
	});

	it("restores the original warn", () => {
		const target = fakeConsole();
		const original = target.warn;

		const restore = installDevConsoleFilter(target, ON_WEB);
		expect(target.warn).not.toBe(original);

		restore();
		expect(target.warn).toBe(original);

		target.warn(REAL_MESSAGES.useNativeDriver);
		expect(original).toHaveBeenCalledWith(REAL_MESSAGES.useNativeDriver);
	});

	it("does not wrap twice when Fast Refresh re-runs the module", () => {
		const target = fakeConsole();
		const original = target.warn;

		const restore = installDevConsoleFilter(target, ON_WEB);
		const wrapped = target.warn;
		installDevConsoleFilter(target, ON_WEB);
		expect(target.warn).toBe(wrapped);

		restore();
		expect(target.warn).toBe(original);
	});

	it("does nothing at all in a production bundle", () => {
		setDev(false);
		const target = fakeConsole();
		const original = target.warn;

		const restore = installDevConsoleFilter(target, ON_WEB);

		expect(target.warn).toBe(original);
		target.warn(REAL_MESSAGES.useNativeDriver);
		expect(original).toHaveBeenCalledWith(REAL_MESSAGES.useNativeDriver);
		restore();
		expect(target.warn).toBe(original);
	});
});

describe("module scope", () => {
	beforeEach(() => setDev(true));

	it("patches the real console.warn when imported", () => {
		const original = jest.fn();
		console.warn = original;

		jest.resetModules();
		const fresh =
			require("@/utils/dev-console") as typeof import("@/utils/dev-console");

		// `index.ts` imports the module for the side effect and nothing else, so
		// the self-install is the behavior the app depends on: the import
		// itself must have swapped `console.warn`.
		expect(console.warn).not.toBe(original);

		console.warn(REAL_MESSAGES.useNativeDriver);
		console.warn("Could not reach Firestore");
		expect(original).toHaveBeenCalledTimes(1);
		expect(original).toHaveBeenCalledWith("Could not reach Firestore");

		fresh.restoreGlobalConsole();
		expect(console.warn).toBe(original);
	});
});
