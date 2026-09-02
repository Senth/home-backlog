import { defineConfig, devices } from "@playwright/test";
import { VIEWPORTS } from "@/e2e/support/app";
import { stackPorts } from "@/e2e/support/stack";

/**
 * The end-to-end suite: the checks that used to be a browser agent's checklist.
 *
 * Everything here is something a machine can decide — a console message, a
 * bounding box, a contrast ratio, whether a write survived a reload. It runs on
 * every PR, for free, forever. What is left for `browser-review` is the half a
 * machine cannot decide: whether the wording sounds like a person, whether the
 * density overwhelms, whether an empty state is honest.
 *
 * These are **behaviour and craft specs driven through a real browser**, which
 * is a different thing from the component render tests `CLAUDE.md` forbids. The
 * rule there bans asserting layout against a mounted component tree, because
 * that tests React rather than the app. Asserting that a real button in a real
 * browser is at least 48 dp is the opposite: it is the visual check being made
 * exact instead of eyeballed.
 *
 * The stack comes from `scripts/dev-stack.sh`, which is also what you and the
 * `/review` skill use. It is idempotent, so a suite run against a stack you
 * already had open reuses it untouched.
 */

// The web port is the one this worktree's `dev-stack.sh up` allocated, read
// from its state file — never a literal, so two worktrees can run suites at
// once. `yarn e2e` boots the stack before Playwright loads this config.
const WEB = `http://localhost:${stackPorts().web}`;

/** Where the signed-in browser state from `auth.setup.ts` is kept. */
export const AUTH_STATE = ".tmp/e2e/auth.json";

/**
 * Two axes, crossed: viewport × locale. Nothing else.
 *
 * The locale axis exists because Swedish words are longer. The viewport axis
 * exists for the same reason the locale one does — what is not measured drifts,
 * and until this was added every craft assertion in the suite was made at
 * 390 px, so every style that only appears above `compactBreakpoint` shipped
 * behind no gate at all.
 *
 * A desktop project mirrors its phone twin exactly, down to which specs it
 * runs, so the rule stays "viewport × locale" with nothing new to learn.
 * `VIEWPORTS` lives in `e2e/support/app.ts` so a spec that needs a specific
 * width names it rather than repeating a literal.
 */

export default defineConfig({
	testDir: "e2e",
	// The unit of parallelism is the **file** by default, and `fullyParallel` is
	// raised to the test on the read-only projects below. What makes any of it
	// safe is the `writes` project: the emulator is one shared mutable backend,
	// so every spec that writes to it is penned into that one project, it runs a
	// single worker, and it runs *after* everything else. Nothing ever executes
	// beside a writer.
	fullyParallel: false,
	// Two on CI because a private-repo `ubuntu-latest` runner is 2 vCPU, and the
	// emulators and the Expo dev server are already on it. Four locally, which is
	// where the single Expo bundler stops being the bottleneck rather than the
	// core count.
	workers: process.env.CI ? 2 : 4,
	// Well above the default 30s, for two reasons. The readiness waits in
	// `e2e/support/app.ts` are themselves 30s, so at the default a test would die
	// before its own wait could report which marker never appeared — the useful
	// half of the failure. And on a cold CI machine the first navigation is what
	// triggers Expo's initial web bundle, which is far slower than any assertion
	// here.
	timeout: 120_000,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	// `line` everywhere, because this suite takes minutes and silence for minutes
	// reads as a hang. It prints `[12/107] e2e/craft.spec.ts:34:3 › a title` per
	// test — one updating line in a terminal, one timestamped line per test in the
	// Actions log, since Playwright drops the cursor escapes when stdout is not a
	// TTY. `github` prints nothing to stdio (it only emits annotations), so it
	// needs a stdio reporter beside it rather than instead of it.
	reporter: [
		...(process.env.CI ? [["github"] as const] : []),
		["line"],
		["html", { outputFolder: ".tmp/e2e/report", open: "never" }],
	],
	outputDir: ".tmp/e2e/results",

	use: {
		baseURL: WEB,
		viewport: VIEWPORTS.phone,
		// Kept only for failures. Traces are large, and a green run does not need
		// evidence — the assertion was the evidence.
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "off",
	},

	projects: [
		{
			// Both setup files, and every other project depends on this one: the
			// suite needs a signed-in browser and a board that matches the seed
			// before its first assertion.
			name: "setup",
			testMatch: /.*\.setup\.ts/,
		},
		{
			// The read-only English phone pass, and the only project that runs
			// `navigation`, `i18n` and `board-desktop`. The router is the same
			// router at every width, a raw translation key is raw at every width,
			// and `board-desktop.spec.ts` sets its own two viewports per test — so
			// a second run of any of them at another width measures nothing new.
			name: "en-US",
			dependencies: ["setup"],
			fullyParallel: true,
			testMatch: /(craft|console|navigation|i18n|board-desktop)\.spec\.ts/,
			use: {
				...devices["Desktop Chrome"],
				viewport: VIEWPORTS.phone,
				locale: "en-US",
				storageState: AUTH_STATE,
			},
		},
		{
			// The board is a different layout above `compactBreakpoint` — every
			// column on screen at once, each with its own add row — so this is not
			// the phone pass repeated at a wider window. Only the two specs whose
			// answer can differ come along: `craft` measures that layout, and
			// `console` renders it, and a warning from a component that only exists
			// up here would have no other gate.
			name: "en-US-desktop",
			dependencies: ["setup"],
			fullyParallel: true,
			testMatch: /(craft|console)\.spec\.ts/,
			use: {
				...devices["Desktop Chrome"],
				viewport: VIEWPORTS.desktop,
				locale: "en-US",
				storageState: AUTH_STATE,
			},
		},
		{
			// Swedish runs the craft and i18n specs only, and never in the dark. A
			// second full pass would re-assert behaviour that has nothing to do with
			// locale; what Swedish actually risks is longer words — a clipped label,
			// a wrapped button, a key that was never translated — and a word is the
			// same length in either scheme. `@dark` is the tag `craft.spec.ts` puts
			// on its contrast pass, which English already makes.
			name: "sv-SE",
			dependencies: ["setup"],
			fullyParallel: true,
			testMatch: /(craft|i18n)\.spec\.ts/,
			grepInvert: /@dark/,
			use: {
				...devices["Desktop Chrome"],
				viewport: VIEWPORTS.phone,
				locale: "sv-SE",
				storageState: AUTH_STATE,
			},
		},
		{
			// Swedish on desktop, and the pairing is not redundant: the desktop
			// column header and add button are the widest translated strings the app
			// renders, in the layout that gives them the least room per column.
			name: "sv-SE-desktop",
			dependencies: ["setup"],
			fullyParallel: true,
			testMatch: /(craft|i18n)\.spec\.ts/,
			grepInvert: /@dark/,
			use: {
				...devices["Desktop Chrome"],
				viewport: VIEWPORTS.desktop,
				locale: "sv-SE",
				storageState: AUTH_STATE,
			},
		},
		{
			// Everything that writes to the emulator. One worker, so the writers
			// never collide with each other, and *last*, so they never collide with
			// anyone else — read-only specs assert numbers the fixture fixes
			// (`i18n.spec.ts`'s column chips), and those are wrong the moment a
			// foreign card exists. That ordering is also why such a reader does
			// *not* belong here: it is already safe. Phases rather than a
			// contamination graph is what keeps the rule statable.
			//
			// `fab.spec.ts` brings its own locale axis: it is a craft claim that
			// happens to need a full column built first, so it lives here rather
			// than in the Swedish projects. `overview.spec.ts` joins it for the
			// same reason `details.spec.ts` does — its claims need fixture nodes
			// `createFixtureNode` writes straight past the UI.
			name: "writes",
			dependencies: ["en-US", "en-US-desktop", "sv-SE", "sv-SE-desktop"],
			workers: 1,
			testMatch:
				/(blocked-by|board|details|fab|invite|locations|offline|overview|overview-cards|rest-api)\.spec\.ts/,
			use: {
				...devices["Desktop Chrome"],
				viewport: VIEWPORTS.phone,
				locale: "en-US",
				storageState: AUTH_STATE,
			},
		},
	],

	// No `webServer` block. Playwright expects that command to *stay running* and
	// treats its exit as the server dying — but `dev-stack.sh up` starts the
	// emulators and Expo detached and returns as soon as they answer, which is
	// what makes it idempotent and safe to call against a stack you already have
	// open. The two models cannot be reconciled without giving the script a
	// foreground mode that exists only to satisfy a config block.
	//
	// So `yarn e2e` boots the stack and then runs the tests. Use that rather than
	// `npx playwright test`, which assumes the stack is already up.
});
