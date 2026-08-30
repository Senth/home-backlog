import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Acceptance claims 1–2 of `docs/specs/wip/171-worktree-parallel-emulators.md`,
 * and the only specs here that need no browser: the thing under test is
 * `scripts/alloc-ports.mjs`, driven exactly the way `dev-stack.sh` drives it —
 * spawned with `node`, with `DEV_STACK_REGISTRY` pointed at a fresh, throwaway
 * registry under `.tmp/`. Nothing in this file ever touches the shared book of
 * claims the running stack holds.
 */

const SCRIPT = path.join(process.cwd(), "scripts", "alloc-ports.mjs");
const FIRST_PORT = 7000;
const SERVICES = [
	"ui",
	"auth",
	"firestore",
	"storage",
	"functions",
	"hub",
	"logging",
];

const portFree = (port: number) =>
	new Promise<boolean>((resolve) => {
		const probe = net.createServer();
		probe.once("error", () => resolve(false));
		probe.once("listening", () => probe.close(() => resolve(true)));
		probe.listen(port, "127.0.0.1");
	});

let root: string;
let registry: string;

test.beforeEach(() => {
	root = fs.mkdtempSync(path.join(process.cwd(), ".tmp", "port-alloc-"));
	registry = path.join(root, "registry");
});

test.afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

function alloc(services: string[]): Record<string, number> {
	const out = spawnSync(process.execPath, [SCRIPT, "alloc", ...services], {
		cwd: process.cwd(),
		encoding: "utf8",
		env: { ...process.env, DEV_STACK_REGISTRY: registry },
	});
	if (out.status !== 0) {
		throw new Error(`alloc-ports failed: ${out.stderr}`);
	}
	return JSON.parse(out.stdout) as Record<string, number>;
}

// Plant a claim the way a live allocator leaves one behind.
function plantClaim(port: number, pid: number): void {
	const dir = path.join(registry, String(port));
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "pid"), String(pid));
	fs.writeFileSync(path.join(dir, "worktree"), "/some/other/worktree");
}

test("1: two allocations against one fresh registry return disjoint port sets", () => {
	const first = Object.values(alloc(SERVICES));
	// The first allocation's claims still record a live pid (this playwright
	// worker, the spawned allocator's parent), so the second one has to route
	// around them rather than hand the same ports out twice.
	const second = Object.values(alloc(SERVICES));
	expect(new Set([...first, ...second]).size).toBe(
		first.length + second.length,
	);
});

test("2: a claim whose owning pid is dead is reclaimed by the next allocation; one whose pid is alive is skipped", async () => {
	// The first two ports the scan can reach, so the planted claims sit exactly
	// where the scan arrives — no reliance on which ports happen to be free on
	// this machine beyond these two.
	const reachable: number[] = [];
	for (let port = FIRST_PORT; reachable.length < 2; port += 1) {
		if (fs.existsSync(path.join(registry, String(port)))) continue;
		if (await portFree(port)) reachable.push(port);
	}
	const [deadPort, livePort] = reachable;

	const dead = spawnSync(process.execPath, ["-e", ""]);
	plantClaim(deadPort, dead.pid ?? 0);
	plantClaim(livePort, process.pid);

	const ports = alloc(["firestore", "storage"]);

	// The live claim is never handed out, whatever else happens.
	expect(Object.values(ports)).not.toContain(livePort);
	if (Object.values(ports).includes(deadPort)) {
		// The reclaimed claim now names the allocator that took it over.
		expect(
			fs.readFileSync(path.join(registry, String(deadPort), "pid"), "utf8"),
		).not.toBe(`${dead.pid}`);
	} else {
		// The 7000-7999 range is shared with sibling worktrees, so another
		// stack may bind deadPort between our probe and this alloc; the
		// allocator routing around it is correct. What must never happen is
		// the port coming back neither reclaimed nor bound.
		expect(await portFree(deadPort)).toBe(false);
	}
});
