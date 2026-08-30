#!/usr/bin/env node
//
// `yarn test:rules`: the security-rules suite on emulators of its own.
//
// Allocates a fresh block of ports through `scripts/alloc-ports.mjs` —
// firestore and storage for the tests, plus the hub and the logging emulator,
// which run beside whatever `--only` names and would otherwise collide on
// their defaults (4400/4500) between two parallel runs — writes a generated
// `firebase.rules-tests.json` at the worktree root, and runs jest inside
// `firebase emulators:exec` with the ports in the `EMULATOR_*_PORT`
// environment, which `tests/rules/helpers.ts` reads (deliberately not the
// web bundle's `EXPO_PUBLIC_*` names — see helpers.ts). Nothing here is a
// fixed port, so two worktrees can run the suite at the same time.
//
// The generated config is not the running stack's `firebase.dev-stack.json`:
// a rules run and a stack in one worktree each need their own file, or an
// `export` would fire at the wrong ports. It lives at the root, not beside
// state, because firebase-tools pins the project root to the config file's
// directory — the rules paths and the command's working directory both
// resolve from there.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CONFIG_PATH = "firebase.rules-tests.json";

// The registry root, derived exactly as scripts/alloc-ports.mjs derives it.
// ponytail: duplicated because alloc-ports.mjs is a CLI that exports nothing;
// export registryDir() from it if a third consumer ever appears.
function registryDir() {
	if (process.env.DEV_STACK_REGISTRY) {
		return path.resolve(process.env.DEV_STACK_REGISTRY);
	}
	const common = execFileSync("git", ["rev-parse", "--git-common-dir"], {
		cwd: process.cwd(),
		encoding: "utf8",
	}).trim();
	return path.join(
		path.resolve(process.cwd(), common, ".."),
		".tmp",
		"dev-stack",
		"registry",
	);
}

const ports = JSON.parse(
	execFileSync(
		"node",
		[
			"scripts/alloc-ports.mjs",
			"alloc",
			"firestore",
			"storage",
			"hub",
			"logging",
		],
		{ encoding: "utf8" },
	),
);

// The committed firebase.json with only the emulators block replaced — the
// UI is off (nobody watches a rules run), the two emulators under test are
// pinned to their allocated ports, and the hub and logging emulator are
// pinned so parallel runs cannot collide.
const config = JSON.parse(fs.readFileSync("firebase.json", "utf8"));
config.emulators = {
	ui: { enabled: false },
	firestore: { port: ports.firestore },
	storage: { port: ports.storage },
	hub: { port: ports.hub },
	logging: { port: ports.logging },
	singleProjectMode: true,
};
fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, "\t")}\n`);

// Java's emulators and firebase-tools both write temp files, and a
// locked-down machine does not always offer them /tmp — so they are pointed
// into the worktree like everything else this script makes.
const tmp = path.resolve(".tmp/dev-stack/tmp");
fs.mkdirSync(tmp, { recursive: true });

try {
	const run = spawnSync(
		"firebase",
		[
			"emulators:exec",
			"--only",
			"firestore,storage",
			"--project",
			"demo-home-backlog-rules",
			"--config",
			CONFIG_PATH,
			// jest.config's cwd is the project root — the config file's directory.
			"jest --config jest.rules.config.js",
		],
		{
			stdio: "inherit",
			env: {
				...process.env,
				TMPDIR: tmp,
				TMP: tmp,
				TEMP: tmp,
				EMULATOR_FIRESTORE_PORT: String(ports.firestore),
				EMULATOR_STORAGE_PORT: String(ports.storage),
			},
		},
	);
	process.exitCode = run.status ?? 1;
} finally {
	// A killed run leaves its claims behind; the allocator's dead-pid reclaim
	// picks those up. This only makes the ports usable again immediately.
	for (const port of Object.values(ports)) {
		fs.rmSync(path.join(registryDir(), String(port)), {
			recursive: true,
			force: true,
		});
	}
}
