#!/usr/bin/env node
//
// Port allocation for the local dev stack, shared by every worktree of this
// repository. Scans 7000-7999 with a bind-probe and claims each port with an
// atomic mkdir in the MAIN repo's registry — found via
// `git rev-parse --git-common-dir`, so every worktree resolves the same
// directory and two worktrees can never hand out the same port (or moved with
// DEV_STACK_REGISTRY, for tests and sandboxed runs). A claim
// records the pid and worktree that own it; a claim whose pid is dead is
// reclaimed by the next allocation, which is how a crashed stack's ports come
// back without a sweep. A foreign process squatting in the range is simply
// skipped, and if that eats the whole range the failure is loud rather than a
// silent adoption of someone else's stack.
//
// Usage: node scripts/alloc-ports.mjs alloc <service>...
//
// Prints one JSON object mapping each service name to its port, and nothing
// else, on stdout. The pid a fresh claim carries is the *caller's*
// (`process.ppid`), because the process that will actually hold the ports does
// not exist yet; `dev-stack.sh up` rewrites it to the emulator's pid once that
// process is up. The claim is meant to live exactly as long as the stack.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const FIRST_PORT = 7000;
const LAST_PORT = 7999;

// `DEV_STACK_REGISTRY` moves the book of claims — used by the allocator's own
// tests and by sandboxed smoke runs, which must not touch the real registry.
// Unset, the registry lives next to the main worktree's `.git`, so every
// worktree of this repository shares one book and nothing outside it races us.
function registryDir() {
	if (process.env.DEV_STACK_REGISTRY) {
		return path.resolve(process.env.DEV_STACK_REGISTRY);
	}
	const common = execFileSync("git", ["rev-parse", "--git-common-dir"], {
		cwd: process.cwd(),
		encoding: "utf8",
	}).trim();
	const mainRoot = path.resolve(process.cwd(), common, "..");
	return path.join(mainRoot, ".tmp", "dev-stack", "registry");
}

// True when nothing is listening on 127.0.0.1:<port> right now.
function portFree(port) {
	return new Promise((resolve) => {
		const probe = net.createServer();
		probe.once("error", () => resolve(false));
		probe.once("listening", () => probe.close(() => resolve(true)));
		probe.listen(port, "127.0.0.1");
	});
}

function claimPid(dir) {
	try {
		return Number.parseInt(fs.readFileSync(path.join(dir, "pid"), "utf8"), 10);
	} catch {
		return 0;
	}
}

function pidAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === "EPERM";
	}
}

// Bind-probe, then claim with an atomic mkdir — the mkdir is the whole
// concurrency story: two allocators racing for one port resolve to exactly one
// winner. An existing claim is honoured while its owner lives and removed when
// it does not; if another allocator re-claims between our removal and our
// mkdir, we lose that port and move on.
async function claimPort(port, registry) {
	if (!(await portFree(port))) return undefined;
	const dir = path.join(registry, String(port));
	try {
		fs.mkdirSync(dir);
	} catch {
		if (pidAlive(claimPid(dir))) return undefined;
		fs.rmSync(dir, { recursive: true, force: true });
		try {
			fs.mkdirSync(dir);
		} catch {
			return undefined;
		}
	}
	fs.writeFileSync(path.join(dir, "pid"), String(process.ppid));
	fs.writeFileSync(path.join(dir, "worktree"), process.cwd());
	return port;
}

const [cmd, ...services] = process.argv.slice(2);
if (cmd !== "alloc" || services.length === 0) {
	console.error("usage: node scripts/alloc-ports.mjs alloc <service>...");
	process.exit(2);
}
if (new Set(services).size !== services.length) {
	console.error(`alloc-ports: duplicate service names: ${services.join(" ")}`);
	process.exit(2);
}

const registry = registryDir();
fs.mkdirSync(registry, { recursive: true });

const pending = [...services];
const ports = {};
for (
	let port = FIRST_PORT;
	port <= LAST_PORT && pending.length > 0;
	port += 1
) {
	const claimed = await claimPort(port, registry);
	if (claimed === undefined) continue;
	ports[pending.shift()] = claimed;
}

if (pending.length > 0) {
	console.error(
		`alloc-ports: no free ports in ${FIRST_PORT}-${LAST_PORT} for: ${pending.join(" ")}`,
	);
	process.exit(1);
}

console.log(JSON.stringify(ports));
