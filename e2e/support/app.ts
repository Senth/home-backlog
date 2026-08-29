import type { ConsoleMessage, Locator, Page } from "@playwright/test";
import enUS from "@/i18n/locales/en-US.json";
import svSE from "@/i18n/locales/sv-SE.json";

/**
 * The signed-in routes the cross-cutting specs walk.
 *
 * Expo Router's `(app)` and `(tabs)` are groups, not path segments, so
 * `app/(app)/(tabs)/projects/index.tsx` is served at `/projects`. Parameterised
 * routes are reached by clicking rather than listed here, because their ids
 * come from `.emulator-seed` and hard-coding one would break the moment the
 * fixture is regenerated.
 */
export const ROUTES = [
	{ path: "/homes", ready: { text: "Huset" } },
	{ path: "/projects", ready: { text: "Renovera badrummet" } },
	{ path: "/locations", ready: { key: "screen.locations.empty" } },
	{ path: "/maintenance", ready: { key: "screen.maintenance.empty" } },
	{ path: "/automations", ready: { text: "research agent" } },
	// Appended, never inserted: `ROUTES[0]` and `ROUTES[1]` are read as `/homes`
	// and the board by the specs that need those two by name.
	{ path: "/overview", ready: { key: "overview.ongoing.title" } },
] as const;

/**
 * Console output that is expected on every load and is not a finding.
 *
 * Deliberately short, and deliberately not a list of "known warnings" —
 * `CLAUDE.md` is explicit that the console is 0 errors and 0 warnings, and that
 * the exceptions are a closed list. Everything here is `info` or `log`: Expo's
 * dev runtime announcing itself, and `utils/dev-console.ts` announcing that it
 * is filtering. Nothing at warning level or above belongs in this array; if
 * something needs to be added at that level, it belongs in
 * `docs/specs/platform-offline.md` under "The console" first, with a reason.
 */
const EXPECTED_PREFIXES = [
	"%cDownload the React DevTools",
	'Running application "main"',
	"[dev-console] Filtering known react-native-web warnings",
];

/**
 * The viewports the suite runs at, named rather than repeated as a literal.
 *
 * `phone` is the default and the device this app is used on. `desktop` exists
 * because everything above `compactBreakpoint` — the column border, the heading
 * weight and padding, the flexed column width, the smaller card title — has no
 * other gate: a style that only appears on a wide screen is judged once by eye
 * during review and then never again.
 *
 * Named so a spec can say which width it needs, and so the next desktop change
 * has somewhere to hang its checks. `playwright.config.ts` reads the first two
 * to build the viewport axis that crosses the locale one; the other two are for
 * a spec that sets its own width per test.
 *
 * `laptop` is where the flexed column is tightest — four columns and their five
 * gutters divide 1366 into 321 each, against the 400 they clamp to on a wide
 * monitor. A width check made only at `desktop` would pass on a clamp and prove
 * nothing about the arithmetic.
 *
 * `phoneZoomed` is `phone` at 200% browser zoom. Zoom does not change what a CSS
 * pixel is, it changes how many of them the window holds — so the layout at 200%
 * on a 390x844 phone is exactly the layout in a 195x422 window, and this is how
 * the suite reaches it. It is not the same thing as an OS text-size setting,
 * which react-native-web cannot honour at all while it writes font sizes in px.
 */
export const VIEWPORTS = {
	phone: { width: 390, height: 844 },
	desktop: { width: 1920, height: 1080 },
	laptop: { width: 1366, height: 768 },
	phoneZoomed: { width: 195, height: 422 },
} as const;

/**
 * A board column's box, by the `data-testid` `BoardColumn` puts on it.
 *
 * The column is the one box on the board that no visible string identifies —
 * its heading is not rendered below `compactBreakpoint`, and above it the
 * heading is a child rather than the box itself. The format is
 * `columnTestID(status)` in `components/board/BoardColumn.tsx`, written out here
 * rather than imported: importing a component into a Node test process pulls in
 * react-native, which is a build, not a test.
 */
export function columnSelector(status: string): string {
	return `[data-testid="board-column-${status}"]`;
}

/** A route, plus the thing that proves its data has arrived. */
export type Route = (typeof ROUTES)[number];

export type ConsoleRecording = {
	/** Console errors, uncaught page exceptions, and failed requests. */
	errors: () => string[];
	/** Console warnings. */
	warnings: () => string[];
	/** Everything captured, for a failure message worth reading. */
	all: () => string[];
};

/**
 * Records the console for the lifetime of a page.
 *
 * Attach before navigating: a listener added after `goto` misses the load, and
 * the load is where the interesting noise is.
 */
export function recordConsole(page: Page): ConsoleRecording {
	const errors: string[] = [];
	const warnings: string[] = [];
	const all: string[] = [];

	const expected = (text: string) =>
		EXPECTED_PREFIXES.some((prefix) => text.startsWith(prefix));

	page.on("console", (message: ConsoleMessage) => {
		const text = message.text();
		all.push(`[${message.type()}] ${text}`);
		if (expected(text)) return;
		if (message.type() === "error") errors.push(text);
		if (message.type() === "warning") warnings.push(text);
	});

	// An uncaught exception never reaches `console`, and it is the single most
	// serious thing this recording can catch.
	page.on("pageerror", (error) => {
		const text = `uncaught: ${error.message}`;
		all.push(text);
		errors.push(text);
	});

	return {
		errors: () => [...errors],
		warnings: () => [...warnings],
		all: () => [...all],
	};
}

/**
 * Every translation key, flattened to the dotted form `t()` is called with.
 *
 * Used to prove no raw key is on screen. Matching against the real key list
 * rather than a shape like `/\w+(\.\w+)+/` is what keeps the check free of
 * false positives — an email address and a version number both look like a key
 * to a regular expression.
 */
export function translationKeys(
	source: Record<string, unknown> = enUS as Record<string, unknown>,
	prefix = "",
): string[] {
	return Object.entries(source).flatMap(([key, value]) => {
		const path = prefix ? `${prefix}.${key}` : key;
		return typeof value === "object" && value !== null
			? translationKeys(value as Record<string, unknown>, path)
			: [path];
	});
}

/**
 * Navigates and waits for the app to settle.
 *
 * The splash holds the router until auth resolves, so "the URL changed" is not
 * the same as "the screen is up". Waiting for the network to go quiet is the
 * cheapest proxy that does not need a per-screen selector.
 */
export async function gotoAndSettle(page: Page, route: Route): Promise<void> {
	await page.goto(route.path);
	await page.waitForLoadState("networkidle");

	// `networkidle` is not enough, and the difference is the whole value of this
	// suite. Firestore delivers over a long-lived WebChannel that never makes the
	// network go quiet, so the page is "idle" while the board still shows its
	// empty state. An earlier version of this file asserted against that empty
	// state and passed — measuring a spinner and reporting it as a screen.
	//
	// So every route names something that only exists once its data has arrived,
	// and we wait for that instead.
	await readyLocator(page, route).first().waitFor({
		state: "visible",
		timeout: 30_000,
	});

	// Icon glyphs are the last thing to arrive, and they arrive silently.
	//
	// Paper draws every icon as a character in an icon font, so until that font
	// resolves there is no glyph in the tree to measure or to judge — which is
	// how an unnamed `role="img"` on the app bar's back arrow passed the axe
	// sweep on one route and failed it on the next, in the same run, for months.
	// A sweep that races the font reports whichever half of the app happened to
	// be finished, and a gate that can pass while the thing it guards is broken
	// is worse than no gate.
	await page.evaluate(() => document.fonts.ready);

	// The measurement and assertion sweeps below judge the app's own boxes.
	// See `stripDevToast` for what this removes.
	await stripDevToast(page);

	// Assert we are still where we asked to be.
	//
	// The tab routes live under an active home and bounce to `/homes` without
	// one, silently — which made an earlier version of this suite assert `/homes`
	// five times while reporting five different routes. A redirect is a real
	// result and may be worth testing, but it must never be mistaken for the
	// route that was asked for.
	const landed = new URL(page.url()).pathname;
	if (landed !== route.path) {
		throw new Error(
			`asked for ${route.path} and landed on ${landed} — the app redirected, so any assertion after this would be about the wrong screen`,
		);
	}
}

/**
 * Removes Expo's dev-only fast-refresh toast, if it is on screen.
 *
 * `expo`'s `DevLoadingView` slides a dark `.__expo_fast_refresh` bubble in from
 * the bottom-left whenever Metro pushes a refresh, and it can still be
 * animating when a measurement runs. It is bundler chrome, not the app: its
 * fill and border are not theme colours, and a sweep that catches it reports
 * a finding about the dev server, not the household's UI. Stripped at the
 * same point the sweeps consider the page settled.
 */
export async function stripDevToast(page: Page): Promise<void> {
	await page.evaluate(() => {
		document.querySelector(".__expo_fast_refresh")?.remove();
	});
}

/**
 * A locator for the route's readiness marker, in whichever locale is running.
 *
 * A marker given as `text` is data — a home name, a seeded card — and reads the
 * same in both locales. A marker given as `key` is a translated string, and
 * rather than asking which locale this project runs under, both renderings are
 * accepted with `.or()`: either one proves the data arrived, which is all this
 * is for.
 *
 * `.or()` rather than a comma-joined selector string. Playwright reads
 * `"text=A, text=B"` as a single CSS selector list, so it matches nothing and
 * every wait burns its full 30-second timeout instead of failing loudly.
 */
function readyLocator(page: Page, route: Route): Locator {
	if ("text" in route.ready) return page.getByText(route.ready.text);

	const key = route.ready.key;
	return page
		.getByText(String(translate(enUS, key)))
		.or(page.getByText(String(translate(svSE, key))));
}

function translate(source: unknown, key: string): unknown {
	return key
		.split(".")
		.reduce<unknown>(
			(value, part) =>
				typeof value === "object" && value !== null
					? (value as Record<string, unknown>)[part]
					: undefined,
			source,
		);
}

/**
 * Opens a Paper `Menu` from its anchor and clicks one of its items, retrying
 * the whole open if the item never shows up.
 *
 * Discovered by #102's phase-6 pass, the first e2e claims ever to click into
 * `CardMenu`, `BoardMenu` or the details app-bar menu: Paper's `Menu` has a
 * race under a Playwright-synthetic click; on some fraction of opens it
 * closes again before the item locator resolves, the same click that opened
 * it apparently read as the "close on outside click" that dismisses it.
 * A real tap, spread across a touchstart and a touchend with a person's
 * reaction time between them, is not the same event Playwright fires. Retried
 * here rather than in the component: this is the automation working around a
 * timing quirk in a dependency, not a product bug — see `CLAUDE.md` on
 * fixing pre-existing issues, which this is not one of.
 */
export async function clickMenuItem(
	page: Page,
	anchor: Locator,
	itemName: string | RegExp,
	attempts = 4,
): Promise<void> {
	// A settle window before the first attempt, not a marker-based wait, because
	// there is no on-screen marker for what it is waiting out: a click on a
	// freshly-navigated screen was seen opening the menu and having it close
	// again within the same tick, every time, for up to ~2s after the screen's
	// own readiness marker (a title, a card) was already on screen — something in
	// that screen's own listeners was still resolving a further snapshot
	// underneath it. A card made by `CardMenu` (already open before this helper
	// existed) never showed it; a card reached by a hard navigation into its own
	// board or details always did.
	//
	// The retry loop below does *not* subsume this. Removing the wait and leaving
	// the retries was tried: 12 tests failed across `details`, `invite` and
	// `offline`, and because the projects share one emulator, the half-finished
	// state they left behind failed tests that had nothing to do with menus.
	//
	// ponytail: a fixed wait standing in for a marker nobody could find. Replace
	// it the day a screen exposes one for "my listeners have stopped arriving".
	await page.waitForTimeout(2_500);

	for (let attempt = 1; attempt <= attempts; attempt++) {
		await anchor.click();
		try {
			await page
				.getByRole("menuitem", { name: itemName })
				.click({ timeout: 4_000 });
			return;
		} catch (reason) {
			if (attempt === attempts) throw reason;
		}
	}
}
