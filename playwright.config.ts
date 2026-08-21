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
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI
		? [["github"], ["html", { outputFolder: ".tmp/e2e/report", open: "never" }]]
		: [["list"], ["html", { outputFolder: ".tmp/e2e/report", open: "never" }]],
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

	webServer: {
		command: "scripts/dev-stack.sh up",
		url: WEB,
		reuseExistingServer: true,
		// Expo's first web bundle is slow, and a cold emulator start compiles the
		// functions first.
		timeout: 300_000,
		stdout: "pipe",
		stderr: "pipe",
	},
});
