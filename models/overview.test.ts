import type { Timestamp } from "firebase/firestore";
import { defaultColumns, type Node } from "@/models/node";
import {
	doneSince,
	doneWithinDays,
	hiddenByRoot,
	recentlyDone,
} from "@/models/overview";

/**
 * Pinned for the same reason `due-date.test.ts` pins it: Recently done's
 * window is a wall-clock window, and the hide predicate reads the same `now`.
 */
const originalTz = process.env.TZ;

beforeAll(() => {
	process.env.TZ = "Europe/Stockholm";
});

afterAll(() => {
	process.env.TZ = originalTz;
});

function at(year: number, month: number, day: number, hour = 12): Date {
	return new Date(year, month - 1, day, hour, 0);
}

const now = at(2026, 8, 15);
const dayInMs = 24 * 60 * 60 * 1000;

/**
 * A `Timestamp` stand-in, built rather than imported for the same reason
 * `live-query.test.ts` builds its own snapshots: the modular SDK does not load
 * as a *value* under jest-expo. These selectors ask a completion one question.
 */
function stamp(ms: number): Timestamp {
	return { toMillis: () => ms } as unknown as Timestamp;
}

function node(overrides: Partial<Node> = {}): Node {
	return {
		id: "node-1",
		title: "Fix the gutter",
		status: "backlog",
		rank: "a0",
		parentId: null,
		ancestorIds: [],
		locationId: null,
		locationAncestorIds: [],
		participantIds: [],
		assigneeIds: [],
		visibility: "shared",
		columns: [...defaultColumns],
		childCount: 0,
		doneCount: 0,
		dueDate: null,
		priority: null,
		blockedBy: [],
		notes: "",
		checklist: [],
		effort: null,
		photos: [],
		archived: false,
		createdVia: "app",
		completedAt: null,
		createdAt: null,
		createdBy: "uid-a",
		updatedAt: null,
		...overrides,
	};
}

/** A node finished `daysAgo` before `now`. */
function done(
	id: string,
	daysAgo: number,
	overrides: Partial<Node> = {},
): Node {
	return node({
		id,
		status: "done",
		completedAt: stamp(now.getTime() - daysAgo * dayInMs),
		parentId: "mine",
		ancestorIds: ["mine"],
		...overrides,
	});
}

const me = "uid-me";
const you = "uid-you";

/** The roots map as Overview holds it, keyed by id. */
const mine = node({ id: "mine", participantIds: [me, you], rank: "a0" });
const yours = node({ id: "yours", participantIds: [you], rank: "a1" });
const roots = new Map([
	["mine", mine],
	["yours", yours],
]);

describe("doneSince", () => {
	it("reaches back exactly the window the section holds", () => {
		expect(now.getTime() - doneSince(now).getTime()).toBe(
			doneWithinDays * dayInMs,
		);
	});
});

describe("hiddenByRoot", () => {
	it("resolves a step through the root of its subtree, not through itself", () => {
		// A shared step carries `[]`, which per node would read as everybody's.
		const step = node({
			id: "step",
			parentId: "task",
			ancestorIds: ["yours", "task"],
			participantIds: [],
		});

		expect(hiddenByRoot(step, roots, me)).toBe(true);
		expect(hiddenByRoot(step, roots, you)).toBe(false);
	});

	it("hides a root that does not name me, and shows one that does", () => {
		expect(hiddenByRoot(mine, roots, me)).toBe(false);
		expect(hiddenByRoot(yours, roots, me)).toBe(true);
	});

	it("shows a root nobody is named on", () => {
		const everyones = node({ id: "everyones", participantIds: [] });

		expect(
			hiddenByRoot(everyones, new Map([["everyones", everyones]]), me),
		).toBe(false);
	});

	/**
	 * The branch that should not be reachable — the roots pair is answered before
	 * a section renders — except for a private step I am on whose private root I
	 * am not on and so cannot read. Leaking somebody's private work is the worse
	 * of the two failures.
	 */
	it("hides a node whose root is not among the loaded roots", () => {
		const orphan = node({
			id: "orphan",
			parentId: "gone",
			ancestorIds: ["gone"],
			participantIds: [me],
		});

		expect(hiddenByRoot(orphan, roots, me)).toBe(true);
	});
});

describe("recentlyDone", () => {
	it("is newest first", () => {
		const nodes = [done("older", 10), done("newest", 1), done("middle", 4)];

		expect(recentlyDone(nodes, roots, me, now).map((each) => each.id)).toEqual([
			"newest",
			"middle",
			"older",
		]);
	});

	/** Both sides of the window, to the millisecond. */
	it("holds a completion exactly the window ago, and not one a moment older", () => {
		const edge = done("edge", 0, {
			completedAt: stamp(doneSince(now).getTime()),
		});
		const past = done("past", 0, {
			completedAt: stamp(doneSince(now).getTime() - 1),
		});

		expect(
			recentlyDone([edge, past], roots, me, now).map((each) => each.id),
		).toEqual(["edge"]);
	});

	it("leaves out a node that was never completed", () => {
		const open = node({ id: "open", parentId: "mine", ancestorIds: ["mine"] });

		expect(recentlyDone([open], roots, me, now)).toEqual([]);
	});

	it("drops a finished step of somebody else's project", () => {
		const step = done("theirs", 2, {
			parentId: "yours",
			ancestorIds: ["yours"],
		});

		expect(recentlyDone([step], roots, me, now)).toEqual([]);
	});
});
