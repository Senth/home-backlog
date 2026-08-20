/**
 * Security rules run against the real Firestore and Storage emulators, not
 * jsdom, so they need their own Jest project. Driven by `yarn test:rules`,
 * which wraps this in `firebase emulators:exec`.
 */
module.exports = {
	testEnvironment: "node",
	testMatch: ["<rootDir>/tests/rules/**/*.test.ts"],
	// This project has no preset, so nothing teaches it the `@/` alias that
	// tsconfig.json declares and the whole codebase imports by.
	moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
	// Every suite talks to the same emulator project, and each one calls
	// clearFirestore() between tests. Run in parallel and they delete each
	// other's fixtures mid-assertion, which fails at random.
	maxWorkers: 1,
	// The emulator handshake plus a 20 MB upload is slower than Jest's default.
	testTimeout: 30000,
};
