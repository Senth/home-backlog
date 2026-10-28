import { readFileSync } from "node:fs";
import { accountDeletionPathManifest } from "./account-plan.js";

function extractMatchPaths(source: string) {
	const paths: string[] = [];
	const stack: { depth: number; path: string }[] = [];
	let depth = 0;

	const code = source.replace(/\/\/[^\r\n]*|'[^']*'|"[^"]*"/g, "");
	for (const token of code.matchAll(/\bmatch\s+(\/[^\s]+)\s*\{|[{}]/g)) {
		if (token[1]) {
			const parent = stack.at(-1)?.path ?? "";
			const path = `${parent}${token[1]}`;
			paths.push(path);
			stack.push({ depth, path });
			depth += 1;
		} else if (token[0] === "{") depth += 1;
		else {
			depth -= 1;
			while (stack.at(-1)?.depth === depth) stack.pop();
		}
	}

	return paths;
}

describe("account deletion path coverage", () => {
	it("includes inline match declarations and their nested paths", () => {
		expect(
			extractMatchPaths(`match /databases/{database}/documents {
          match /reviewDummy/{id} { allow read: if true; }
          match /parent/{id} { match /child/{childId} { allow read: if true; } }
        }`),
		).toEqual([
			"/databases/{database}/documents",
			"/databases/{database}/documents/reviewDummy/{id}",
			"/databases/{database}/documents/parent/{id}",
			"/databases/{database}/documents/parent/{id}/child/{childId}",
		]);
	});
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
