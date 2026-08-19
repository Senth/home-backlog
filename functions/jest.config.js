/**
 * The function's own suite, run from the root by `yarn test`.
 *
 * Node and ts-jest rather than the app's `jest-expo` preset: nothing under
 * `src/` renders, and the modules that matter most here — `validate.ts` above
 * all — are deliberately pure TypeScript with no Firebase import at all, so they
 * need no emulator and no environment.
 *
 * ESM, because the package is (see `tsconfig.json` for why). That is what the
 * `--experimental-vm-modules` in the `test` script is for, and what the module
 * mapper below is for: the source carries the `.js` extension Node's resolver
 * wants, and jest has to map it back onto the `.ts` file it compiles.
 */
export default {
	preset: "ts-jest/presets/default-esm",
	testEnvironment: "node",
	roots: ["<rootDir>/src"],
	moduleNameMapper: {
		"^(\\.{1,2}/.*)\\.js$": "$1",
	},
	// The suite is the pure modules, not the wiring: `index.ts` and `app.ts` are
	// route tables whose behaviour is the Firestore they talk to. Without this a
	// phase that adds only wiring fails `yarn test` for having nothing to run.
	passWithNoTests: true,
};
