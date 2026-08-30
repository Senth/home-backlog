// Black-box tests for scripts/alloc-ports.mjs, driven exactly the way
// dev-stack.sh drives it: spawned with `node`, with DEV_STACK_REGISTRY pointed
// at a scratch directory inside this worktree — no test ever touches the real
// registry. These are the behavioural proof for acceptance claims 1-2 of
// docs/specs/wip/171-worktree-parallel-emulators.md.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const SCRIPT = path.join(__dirname, "..", "scripts", "alloc-ports.mjs");
const FIRST_PORT = 7000;
const SERVICES = [
	"ui",
	"auth",
	"firestore",
	"storage",
	"functions",
	"hub",
	"logging",
	"web",
];

let root: string;
let registry: string;

const portFree = (port: number) =>
	new Promise<boolean>((resolve) => {
		const probe = net.createServer();
		probe.once("error", () => resolve(false));
		probe.once("listening", () => probe.close(() => resolve(true)));
		probe.listen(port, "127.0.0.1");
	});

beforeEach(() => {
	root = fs.mkdtempSync(path.join(__dirname, "..", ".tmp", "alloc-ports-"));
	registry = path.join(root, "registry");
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

function alloc(services: string[]): Record<string, number> {
	const out = execFileSync(process.execPath, [SCRIPT, "alloc", ...services], {
		cwd: root,
		encoding: "utf8",
		env: { ...process.env, DEV_STACK_REGISTRY: registry },
	});
	return JSON.parse(out) as Record<string, number>;
}

// Plant a claim the way a live allocator leaves one behind.
function plantClaim(port: number, pid: number): void {
	const dir = path.join(registry, String(port));
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "pid"), String(pid));
	fs.writeFileSync(path.join(dir, "worktree"), "/some/other/worktree");
}

test("two allocations against one fresh registry return disjoint port sets", () => {
	const first = Object.values(alloc(SERVICES));
	// The first allocation's claims still record a live pid (this jest worker,
	// the spawned allocator's parent), so the second one has to route around
	// them rather than hand the same ports out twice.
	const second = Object.values(alloc(SERVICES));
	expect(new Set([...first, ...second]).size).toBe(
		first.length + second.length,
	);
});

test("a dead pid's claim is reclaimed by the next allocation; a live pid's is skipped", async () => {
	// The first two ports the next allocation can reach, so the planted claims
	// sit exactly where the scan arrives — no reliance on which ports happen
	// to be free on this machine beyond these two.
	const reachable: number[] = [];
	for (let port = FIRST_PORT; reachable.length < 2; port += 1) {
		if (fs.existsSync(path.join(registry, String(port)))) continue;
		if (await portFree(port)) reachable.push(port);
	}
	const [deadPort, livePort] = reachable;

	const deadChild = spawn(process.execPath, ["-e", ""]);
	await new Promise((resolve) => deadChild.on("exit", resolve));
	plantClaim(deadPort, deadChild.pid ?? 0);
	plantClaim(livePort, process.pid);

	const ports = alloc(["firestore", "storage"]);

	expect(Object.values(ports)).toContain(deadPort);
	expect(Object.values(ports)).not.toContain(livePort);
	// The reclaimed claim now names the allocator that took it over.
	expect(
		fs.readFileSync(path.join(registry, String(deadPort), "pid"), "utf8"),
	).not.toBe(`${deadChild.pid}`);
});
