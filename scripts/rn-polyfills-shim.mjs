/**
 * react-native 0.87 removed `rn-get-polyfills`, which Expo's Metro config and
 * CLI still require by name (`react-native/rn-get-polyfills`) on every web
 * bundle. Restore the shim RN 0.86 shipped — a one-line forward to
 * `@react-native/js-polyfills` — and register it in the package's `exports`
 * map, until Expo resolves the path itself. Best effort: a future Expo or
 * react-native release that fixes the resolution must not fail installs here.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

try {
	const rnDir = path.dirname(require.resolve("react-native/package.json"));
	const shim = path.join(rnDir, "rn-get-polyfills.js");
	if (!existsSync(shim)) {
		writeFileSync(
			shim,
			"module.exports = require('@react-native/js-polyfills');\n",
		);
	}
	const pkgPath = path.join(rnDir, "package.json");
	const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
	pkg.exports ??= {};
	if (!pkg.exports["./rn-get-polyfills"]) {
		pkg.exports["./rn-get-polyfills"] = "./rn-get-polyfills.js";
		writeFileSync(pkgPath, `${JSON.stringify(pkg, null, "\t")}\n`);
	}
} catch {
	// The app can boot without it whenever Expo stops requiring the path.
}
