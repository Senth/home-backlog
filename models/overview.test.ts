import { defaultColumns, type Node } from "@/models/node";
import {
	doneSince,
	doneWindow,
	doneWithinDays,
	hiddenByRoot,
	maxDoneWithinDays,
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
		labelIds: [],
		notes: "",
		checklist: [],
		effort: null,
		attachments: [],
		attachmentCount: 0,
		attachmentDisplay: "count",
		heroAttachmentId: null,
		archived: false,
		createdVia: "app",
		completedAt: null,
		createdAt: null,
		createdBy: "uid-a",
		updatedAt: null,
		...overrides,
	};
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

	it("reaches back the window it is given", () => {
		expect(now.getTime() - doneSince(now, 100).getTime()).toBe(100 * dayInMs);
	});
});

describe("doneWindow", () => {
	it("is the widest window any card asks for", () => {
		expect(doneWindow([30, 90])).toBe(90);
	});

	/** The ceiling the plan pins: a card asking for 500 gets 365. */
	it("clamps a card asking for 500 days at the 365-day ceiling", () => {
		expect(maxDoneWithinDays).toBe(365);
		expect(doneWindow([500])).toBe(maxDoneWithinDays);
	});

	it("floors at the seed window when no done card asks for anything", () => {
		expect(doneWindow([])).toBe(doneWithinDays);
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
