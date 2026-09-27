import { execFileSync } from "node:child_process";
import path from "node:path";

const MODULE = path.join(
	__dirname,
	"..",
	"scripts",
	"icon-keywords-normalize.mjs",
);

const normalize = (value: string): string =>
	JSON.parse(
		execFileSync(
			"node",
			[
				"--input-type=module",
				"-e",
				`import { normalizeKeywords } from ${JSON.stringify(MODULE)}; console.log(JSON.stringify(normalizeKeywords(process.argv[1])));`,
				value,
			],
			{ encoding: "utf8" },
		),
	);

describe("normalizeKeywords", () => {
	it("drops an inflected form of a present base, then a prefix of another word", () => {
		expect(normalize("kylskåp kyl kylskåpet kök")).toBe("kylskåp kök");
	});

	it("drops a word that is a prefix of another word in the entry", () => {
		expect(normalize("toalett toa wc badrum")).toBe("toalett wc badrum");
	});

	it("lowercases, trims, collapses whitespace and duplicates", () => {
		expect(normalize("  Kök\tSPIS  kök \n spis ")).toBe("kök spis");
	});

	it("keeps an empty entry empty", () => {
		expect(normalize("")).toBe("");
		expect(normalize("   ")).toBe("");
	});
});
