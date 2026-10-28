import { readFileSync } from "node:fs";
import { accountDeletionPathManifest } from "./account-plan.js";

function extractMatchPaths(source: string) {
	const paths: string[] = [];
	const stack: { depth: number; path: string }[] = [];
	let depth = 0;

	for (const line of source.split(/\r?\n/)) {
		const code = line.replace(/\/\/.*$/, "").replace(/'[^']*'|"[^"]*"/g, "");
		const match = code.match(/^(\s*)match\s+(\/.+?)\s*\{\s*$/);
		if (match) {
			const parent = stack.at(-1)?.path ?? "";
			const path = `${parent}${match[2]}`;
			paths.push(path);
			stack.push({ depth, path });
		}

		const braces = match ? code.replace(match[0], "match {") : code;
		for (const character of braces) {
			if (character === "{") depth += 1;
			if (character === "}") {
				depth -= 1;
				while (stack.at(-1)?.depth === depth) stack.pop();
			}
		}
	}

	return paths;
}

describe("account deletion path coverage", () => {
	it("classifies every Firestore and Storage match path", () => {
		const rulePaths = [
			{
				file: "firestore.rules",
				paths: extractMatchPaths(
					readFileSync(
						new URL("../../firestore.rules", import.meta.url),
						"utf8",
					),
				),
			},
			{
				file: "storage.rules",
				paths: extractMatchPaths(
					readFileSync(new URL("../../storage.rules", import.meta.url), "utf8"),
				),
			},
		];
		const manifestPaths = new Set(
			accountDeletionPathManifest.map(({ file, path }) => `${file}:${path}`),
		);
		const rulePathKeys = new Set(
			rulePaths.flatMap(({ file, paths }) =>
				paths.map((path) => `${file}:${path}`),
			),
		);
		const unclassified = rulePaths.flatMap(({ file, paths }) =>
			paths
				.filter((path) => !manifestPaths.has(`${file}:${path}`))
				.map((path) => `Unclassified ${file} path: ${path}`),
		);
		const stale = accountDeletionPathManifest
			.filter(({ file, path }) => !rulePathKeys.has(`${file}:${path}`))
			.map(
				({ file, path }) =>
					`Manifest path has no matching rule in ${file}: ${path}`,
			);

		if (unclassified.length || stale.length) {
			throw new Error([...unclassified, ...stale].join("\n"));
		}
	});
});
