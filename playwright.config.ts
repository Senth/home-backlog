import { defineConfig, devices } from "@playwright/test";

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

const WEB = "http://localhost:8081";

/** Where the signed-in browser state from `auth.setup.ts` is kept. */
export const AUTH_STATE = ".tmp/e2e/auth.json";

/**
 * The phone. This app is used on one, and every craft assertion is made at this
 * width because that is where a Swedish label runs out of room first.
 */
const PHONE = { width: 390, height: 844 };

export default defineConfig({
	testDir: "e2e",
	// The emulator is one shared mutable backend, so specs that write cannot run
	// beside each other. Serial is also what makes a failure reproducible by
	// hand, which matters more here than wall-clock time on a suite this size.
	fullyParallel: false,
	workers: 1,
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
		viewport: PHONE,
		// Kept only for failures. Traces are large, and a green run does not need
		// evidence — the assertion was the evidence.
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "off",
	},

	projects: [
		{
			name: "setup",
			testMatch: /auth\.setup\.ts/,
		},
		{
			name: "en-US",
			dependencies: ["setup"],
			testIgnore: /auth\.setup\.ts/,
			use: {
				...devices["Desktop Chrome"],
				viewport: PHONE,
				locale: "en-US",
				storageState: AUTH_STATE,
			},
		},
		{
			// Swedish runs the craft and i18n specs only. A second full pass would
			// re-assert behaviour that has nothing to do with locale; what Swedish
			// actually risks is longer words — a clipped label, a wrapped button, a
			// key that was never translated.
			name: "sv-SE",
			dependencies: ["setup"],
			testMatch: /(craft|i18n)\.spec\.ts/,
			use: {
				...devices["Desktop Chrome"],
				viewport: PHONE,
				locale: "sv-SE",
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
