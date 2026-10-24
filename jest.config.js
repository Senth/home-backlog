const shared = {
	clearMocks: true,
	testPathIgnorePatterns: [
		"<rootDir>/node_modules/",
		"<rootDir>/tests/rules/",
		"<rootDir>/e2e/",
		"<rootDir>/functions/",
	],
	setupFiles: ["<rootDir>/tests/jest-setup.ts"],
	transformIgnorePatterns: [
		"node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@react-native-firebase|firebase|react-native-paper|fractional-indexing))",
	],
};

/**
 * Tests that need a real DOM are named `*.dom.test.*` and run under the web preset:
 * jsdom's `window` is non-configurable, so the native preset's setup cannot
 * redefine it under a `@jest-environment jsdom` docblock.
 */
module.exports = {
	projects: [
		{
			...shared,
			displayName: "native",
			preset: "jest-expo",
			testPathIgnorePatterns: [
				...shared.testPathIgnorePatterns,
				"\\.dom\\.test\\.tsx?$",
			],
		},
		{
			...shared,
			displayName: "web",
			preset: "jest-expo/web",
			testMatch: ["<rootDir>/**/*.dom.test.ts?(x)"],
		},
	],
};
