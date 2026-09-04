import { readFileSync } from "node:fs";

/**
 * The ports of the stack `scripts/dev-stack.sh up` started in this worktree.
 *
 * Every `up` that actually boots something allocates a fresh block in
 * 7000–7999 and records it in gitignored `.tmp/dev-stack/stack.json`, so two
 * worktrees can each run a full stack at once. Nothing here may fall back to
 * a literal: a literal is exactly the collision this file exists to kill.
 */
type StackPorts = {
	ui: number;
	auth: number;
	firestore: number;
	storage: number;
	functions: number;
	hub: number;
	logging: number;
	web: number;
};

/** Reads the allocation `dev-stack.sh` wrote, and refuses to guess. */
export function stackPorts(): StackPorts {
	let raw: string;
	try {
		raw = readFileSync(".tmp/dev-stack/stack.json", "utf8");
	} catch {
		throw new Error(
			"no stack state at .tmp/dev-stack/stack.json — start the stack with scripts/dev-stack.sh up",
		);
	}
	const ports = (JSON.parse(raw) as { ports: StackPorts }).ports;
	if (
		!ports.auth ||
		!ports.firestore ||
		!ports.storage ||
		!ports.functions ||
		!ports.web
	) {
		throw new Error(
			"stack.json has no usable ports — the stack was started with --no-web, or is stale: run scripts/dev-stack.sh up",
		);
	}
	return ports;
}
