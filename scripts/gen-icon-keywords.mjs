#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { normalizeKeywords } from "./icon-keywords-normalize.mjs";

const GLYPHMAP =
	"node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json";
const META = "node_modules/@mdi/svg/meta.json";
const ALIASES = "i18n/icon-keywords/en-US.json";
const BATCH = 300;

const locale = process.argv[2];
if (!locale) {
	console.error("Usage: yarn icon-keywords <locale>, e.g. sv-SE");
	process.exit(1);
}
const target = `i18n/icon-keywords/${locale}.json`;
const language = new Intl.DisplayNames(["en"], { type: "language" }).of(locale);

const tags = new Map(
	JSON.parse(readFileSync(META, "utf8")).map((icon) => [icon.name, icon.tags]),
);
const aliases = JSON.parse(readFileSync(ALIASES, "utf8"));
const glyphs = Object.keys(JSON.parse(readFileSync(GLYPHMAP, "utf8"))).sort();
const existing = existsSync(target)
	? JSON.parse(readFileSync(target, "utf8"))
	: {};
const keywords = Object.fromEntries(
	glyphs
		.filter((name) => name in existing)
		.map((name) => [name, existing[name]]),
);
const missing = glyphs.filter((name) => !(name in keywords));

const prompt = (
	names,
) => `You write ${language} search keywords for Material Design Icons in a home-maintenance app. A user types a word in ${language} and should find the icon.

Return only a JSON object, no prose and no code fence. It has exactly one key per icon listed below, spelled exactly as given, and each value is one string of space-separated lowercase ${language} words.

Rules for each value:
- The direct translation of what the icon shows, real synonyms, and the room or category where that fits.
- Base forms only. No inflections: no definite forms, no plurals when the singular is there.
- No word that is a prefix of another word in the same value, because search already matches prefixes.
- Use "" (the empty string) when there is nothing to translate: brands, logos, company and product names, single letters and digits.
- Keep it short. Two to five words is typical.

Swedish examples: fridge → "kylskåp kök", not "kylskåp kyl kylskåpet kök". toilet → "toalett wc badrum", not "toalett toa wc badrum". microsoft → "".

Each line below is: icon name | English aliases | categories.

${names.map((name) => `${name} | ${aliases[name] ?? ""} | ${(tags.get(name) ?? []).join(", ")}`).join("\n")}`;

const ask = (names) => {
	const reply = JSON.parse(
		execFileSync(
			"claude",
			["-p", "--model", "sonnet", "--output-format", "json"],
			{ input: prompt(names), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
		),
	);
	if (reply.is_error) throw new Error(reply.result);
	const text = reply.result;
	const batch = JSON.parse(
		text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1),
	);
	const extra = Object.keys(batch).filter((name) => !names.includes(name));
	const absent = names.filter((name) => typeof batch[name] !== "string");
	if (extra.length || absent.length) {
		throw new Error(
			`${absent.length} missing or non-string (${absent.slice(0, 5).join(", ")}), ${extra.length} extra (${extra.slice(0, 5).join(", ")})`,
		);
	}
	return batch;
};

const write = () => {
	const sorted = Object.fromEntries(
		Object.keys(keywords)
			.sort()
			.map((name) => [name, keywords[name]]),
	);
	writeFileSync(target, `${JSON.stringify(sorted, null, "\t")}\n`);
};

write();
console.log(`${missing.length} glyphs missing from ${target}.`);
for (let start = 0; start < missing.length; start += BATCH) {
	const names = missing.slice(start, start + BATCH);
	const label = `Batch ${start / BATCH + 1} of ${Math.ceil(missing.length / BATCH)}`;
	let batch;
	for (let attempt = 1; !batch; attempt++) {
		try {
			batch = ask(names);
		} catch (error) {
			console.error(`${label}, attempt ${attempt}: ${error.message}`);
			if (attempt === 2) {
				console.error(
					`${label} failed twice. ${target} keeps every earlier batch; run again to resume.`,
				);
				process.exit(1);
			}
		}
	}
	for (const name of names) keywords[name] = normalizeKeywords(batch[name]);
	write();
	console.log(`${label}: wrote ${names.length} glyphs to ${target}.`);
}
