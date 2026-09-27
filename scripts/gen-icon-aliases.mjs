#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

const GLYPHMAP =
	"node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json";
const META = "node_modules/@mdi/svg/meta.json";
const TARGET = "i18n/icon-keywords/en-US.json";

const aliases = new Map(
	JSON.parse(readFileSync(META, "utf8")).map((icon) => [
		icon.name,
		[...new Set(icon.aliases.flatMap((alias) => alias.split("-")))].join(" "),
	]),
);
const names = Object.keys(JSON.parse(readFileSync(GLYPHMAP, "utf8"))).sort();
const index = Object.fromEntries(
	names.map((name) => [name, aliases.get(name) ?? ""]),
);
const file = `${JSON.stringify(index, null, "\t")}\n`;

if (process.argv.includes("--check")) {
	if (readFileSync(TARGET, "utf8") !== file) {
		console.error(
			`${TARGET} is out of step with @mdi/svg and the installed glyphmap. Run \`yarn icon-aliases\` and commit the result.`,
		);
		process.exit(1);
	}
	console.log(`${TARGET} is in step with @mdi/svg and the glyphmap.`);
} else {
	writeFileSync(TARGET, file);
	console.log(`Wrote ${TARGET} with ${names.length} glyph names.`);
}
