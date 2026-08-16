/**
 * The function's own suite, run from the root by `yarn test`.
 *
 * Node and ts-jest rather than the app's `jest-expo` preset: nothing under
 * `src/` renders, and the modules that matter most here — `validate.ts` above
 * all — are deliberately pure TypeScript with no Firebase import at all, so they
 * need no emulator and no environment.
 */
module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	roots: ["<rootDir>/src"],
	// The suite is the pure modules, not the wiring: `index.ts` and `app.ts` are
	// route tables whose behaviour is the Firestore they talk to. Without this a
	// phase that adds only wiring fails `yarn test` for having nothing to run.
	passWithNoTests: true,
};
