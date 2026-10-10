const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// Without watchman, Metro watches every directory under the root and dies when
// Playwright deletes one of its artifact folders in .tmp mid-run.
config.resolver.blockList = [
	...config.resolver.blockList,
	/[\\/]\.tmp(?:[\\/]|$)/,
];

module.exports = config;
