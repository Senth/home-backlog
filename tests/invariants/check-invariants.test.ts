// Black-box tests for scripts/check-invariants.sh, driven the way CI drives it:
// the real script is spawned against a throwaway git repository per case, built
// from the fixtures under tests/invariants/fixtures — a `clean/` skeleton every
// case starts from, plus one directory per check that violates exactly that
// check. Fixture files carry a `.txt` suffix so the suite never scans itself: a
// fixture's whole job is to contain violations the gate must catch.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execScript = promisify(execFile);
const SCRIPT = path.join(
	__dirname,
	"..",
	"..",
	"scripts",
	"check-invariants.sh",
);
const FIXTURES = path.join(__dirname, "fixtures");

// Every check the script reports. The clean-fixture test asserts this list
// exhausts the summary, so a new check without a case here fails the suite.
const CHECKS = [
	"style literals",
	"color literals",
	"useAppTheme",
	"@/ alias imports",
	"no StyleSheet/Tailwind",
	"en-US / sv-SE parity",
	"rules -> rules tests",
	"domain modules tested",
	"one console filter",
	"skill.md version",
	"t() keys exist",
	"no Appbar.BackAction",
	"e2e spec budget",
	"emulators via dev-stack",
	"icon names generated",
	"button hierarchy",
	"DueChip warning-only",
	"label glyph named",
	"Menu only via AppMenu",
];

type Case = {
	name: string;
	check: string;
	args?: string[];
	files?: (sandbox: string) => Promise<void>;
};

// The two generated cases never touch fixtures/: one needs eleven files, and
// the other's content must not land in this repository at all, since check 14
// greps every file in the tree — test sources included.
const CASES: Case[] = [
	{ name: "style-literals", check: "style literals" },
	{ name: "color-literals", check: "color literals" },
	{ name: "use-app-theme", check: "useAppTheme" },
	{ name: "relative-imports", check: "@/ alias imports" },
	{ name: "stylesheet-create", check: "no StyleSheet/Tailwind" },
	{ name: "locale-parity", check: "en-US / sv-SE parity" },
	{
		name: "rules-without-tests",
		check: "rules -> rules tests",
		args: ["--base", "main"],
	},
	{ name: "untested-domain-module", check: "domain modules tested" },
	{ name: "console-filter", check: "one console filter" },
	{ name: "skill-version", check: "skill.md version" },
	{ name: "appbar-backaction", check: "no Appbar.BackAction" },
	{
		name: "e2e-budget",
		check: "e2e spec budget",
		files: async (sandbox) => {
			for (let i = 1; i <= 11; i += 1) {
				const spec = path.join(sandbox, "e2e", `spec-${i}.spec.ts`);
				await fs.promises.mkdir(path.dirname(spec), { recursive: true });
				await fs.promises.writeFile(spec, "");
			}
		},
	},
	{
		name: "emulator-boot",
		check: "emulators via dev-stack",
		files: async (sandbox) => {
			const command = ["firebase", "emulators:start"].join(" ");
			const rogue = path.join(sandbox, "scripts", "rogue.sh");
			await fs.promises.mkdir(path.dirname(rogue), { recursive: true });
			await fs.promises.writeFile(rogue, `#!/bin/sh\n${command}\n`);
		},
	},
	{ name: "icon-names", check: "icon names generated" },
	{ name: "button-hierarchy", check: "button hierarchy" },
	{ name: "duechip-warning", check: "DueChip warning-only" },
	{ name: "label-glyph-named", check: "label glyph named" },
	{ name: "menu-via-appmenu", check: "Menu only via AppMenu" },
];

type Run = { code: number; stdout: string; stderr: string };

// Spawned under a UTF-8 collation on purpose: the script's own LC_ALL=C must
// override it, so dropping that export flips the parity check's sort order and
// the clean fixture fails. The fixture's `a.b` and `a1` keys sort in opposite
// order under C and en_US.UTF-8 — the mismatch jq | sort vs comm once had.
const UTF8_ENV = { ...process.env, LC_ALL: "en_US.UTF-8" };

async function run(cwd: string, args: string[] = []): Promise<Run> {
	try {
		const { stdout } = await execScript(SCRIPT, args, { cwd, env: UTF8_ENV });
		return { code: 0, stdout, stderr: "" };
	} catch (error) {
		const e = error as { code?: number; stdout?: string; stderr?: string };
		return {
			code: e.code ?? -1,
			stdout: e.stdout ?? "",
			stderr: e.stderr ?? "",
		};
	}
}

// The summary block on stdout: `<number>  <name padded>  <ok|FAIL|skip ...>`,
// with the FAIL rows wrapped in ANSI color, which is stripped before parsing.
// The escape character is assembled at runtime: a regex literal containing it
// is a lint error here.
const ANSI_COLOR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function statuses(stdout: string): Map<string, string> {
	const map = new Map<string, string>();
	const text = stdout.replace(ANSI_COLOR, "");
	for (const line of text.split("\n")) {
		const row = line.match(/^\s*\d+\s{2,}(.+?)\s{2,}(ok|FAIL|skip.*)$/);
		if (row) map.set(row[1], row[2]);
	}
	return map;
}

function expectOnly(result: Run, check: string): void {
	const summary = statuses(result.stdout);
	expect(summary.get(check)).toBe("FAIL");
	for (const [name, status] of summary) {
		if (name !== check) expect(`${name}: ${status}`).toBe(`${name}: ok`);
	}
}

async function copyTree(from: string, to: string): Promise<void> {
	if (!fs.existsSync(from)) return;
	const entries = await fs.promises.readdir(from, {
		recursive: true,
		withFileTypes: true,
	});
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const source = path.join(entry.parentPath, entry.name);
		const target = path.join(
			to,
			path.relative(from, source).replace(/\.txt$/, ""),
		);
		await fs.promises.mkdir(path.dirname(target), { recursive: true });
		await fs.promises.copyFile(source, target);
	}
}

let sandbox: string;

async function git(...args: string[]): Promise<void> {
	await execScript("git", ["-C", sandbox, ...args]);
}

async function commitAll(): Promise<void> {
	await git("add", "-A");
	await git(
		"-c",
		"user.name=fixture",
		"-c",
		"user.email=fixture@example.com",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-m",
		"fixture",
	);
}

async function plant(c: Case, tracked: boolean): Promise<void> {
	await copyTree(path.join(FIXTURES, c.name), sandbox);
	await c.files?.(sandbox);
	if (!tracked) return;
	// Commit on a side branch: committing onto main would make main the
	// merge-base of itself and HEAD, and check 7 would see an empty diff.
	await git("switch", "-c", "case");
	await commitAll();
}

beforeEach(async () => {
	sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "check-invariants-"));
	await copyTree(path.join(FIXTURES, "clean"), sandbox);
	await git("init", "-b", "main");
	await commitAll();
});

afterEach(() => {
	fs.rmSync(sandbox, { recursive: true, force: true });
});

test("a clean fixture passes every check", async () => {
	const result = await run(sandbox);
	expect(result.code).toBe(0);
	const summary = statuses(result.stdout);
	expect([...summary.keys()].sort()).toEqual([...CHECKS].sort());
	for (const check of CHECKS) expect(summary.get(check)).toBe("ok");
}, 20000);

test.each(CASES)(
	"$name: the check it violates fails, tracked",
	async (c) => {
		await plant(c, true);
		const result = await run(sandbox, c.args ?? []);
		expect(result.code).toBe(1);
		expectOnly(result, c.check);
	},
	20000,
);

test.each(CASES)(
	"$name: the check it violates fails, untracked",
	async (c) => {
		await plant(c, false);
		const result = await run(sandbox, c.args ?? []);
		expect(result.code).toBe(1);
		expectOnly(result, c.check);
	},
	20000,
);

test("comment-only mentions are stripped, not violations", async () => {
	await copyTree(path.join(FIXTURES, "comment-only"), sandbox);
	const result = await run(sandbox);
	expect(result.code).toBe(0);
	for (const [name, status] of statuses(result.stdout)) {
		expect(`${name}: ${status}`).toBe(`${name}: ok`);
	}
}, 20000);

test("a bare --base is a usage error, not a hang", async () => {
	const result = await run(sandbox, ["--base"]);
	expect(result.code).toBe(2);
	expect(result.stderr).toContain("--base needs a ref");
}, 20000);

test.each([
	["origin/nope", "cannot resolve --base 'origin/nope'"],
	["origin/", "cannot resolve --base 'origin/'"],
])(
	"--base %s unresolvable against HEAD is a hard error",
	async (ref, message) => {
		const result = await run(sandbox, ["--base", ref]);
		expect(result.code).toBe(2);
		expect(result.stderr).toContain(message);
	},
	20000,
);

test("no resolvable base skips check 7 and still passes", async () => {
	await git("branch", "-m", "trunk");
	const result = await run(sandbox);
	expect(result.code).toBe(0);
	expect(statuses(result.stdout).get("rules -> rules tests")).toMatch(/^skip/);
}, 20000);

test("a tree with no TypeScript refuses to report a pass", async () => {
	fs.rmSync(path.join(sandbox, "components"), {
		recursive: true,
		force: true,
	});
	await git("add", "-A");
	const result = await run(sandbox);
	expect(result.code).toBe(2);
	expect(result.stderr).toContain("no TypeScript sources");
}, 20000);

test("outside a repository it exits 2", async () => {
	const nowhere = fs.mkdtempSync(
		path.join(os.tmpdir(), "check-invariants-nowhere-"),
	);
	try {
		const result = await run(nowhere);
		expect(result.code).toBe(2);
		expect(result.stderr).toContain("not inside a git repository");
	} finally {
		fs.rmSync(nowhere, { recursive: true, force: true });
	}
}, 20000);
