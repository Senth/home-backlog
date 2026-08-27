import type { Timestamp } from "firebase/firestore";
import { defaultColumns, type Node } from "@/models/node";
import {
	comingUp,
	comingUpUntil,
	doneSince,
	doneWithinDays,
	hiddenByRoot,
	ongoingProjects,
	recentlyDone,
} from "@/models/overview";

/**
 * Pinned for the same reason `due-date.test.ts` pins it: Coming up compares
 * *calendar days*, so a suite that only proves the boundary in UTC proves
 * nothing about the two zones the app ships strings for.
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

/** The root board as Overview holds it: mine, yours, and one nobody owns. */
const mine = node({ id: "mine", participantIds: [me, you], rank: "a0" });
const yours = node({ id: "yours", participantIds: [you], rank: "a1" });
const roots = [mine, yours];

describe("comingUpUntil", () => {
	it("is today plus the window a card face already uses", () => {
		expect(comingUpUntil(now)).toBe("2026-08-22");
	});

	/**
	 * The bound is a stored `'YYYY-MM-DD'`, and `toCalendarDay` reads local
	 * components — so crossing a month, a year or a DST change must not shift it.
	 */
	it("crosses a month, a year end and a DST change as calendar days", () => {
		expect(comingUpUntil(at(2026, 8, 28))).toBe("2026-09-04");
		expect(comingUpUntil(at(2026, 12, 29))).toBe("2027-01-05");
		// Stockholm falls back on 2026-10-25.
		expect(comingUpUntil(at(2026, 10, 22))).toBe("2026-10-29");
	});
});

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

		expect(hiddenByRoot(everyones, [everyones], me)).toBe(false);
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

describe("ongoingProjects", () => {
	it("is the roots in progress, in the order they are given", () => {
		const backlog = node({ id: "backlog", participantIds: [me], rank: "a0" });
		const first = node({
			id: "first",
			status: "execution",
			participantIds: [me],
			rank: "a1",
		});
		const second = node({
			id: "second",
			status: "execution",
			participantIds: [me],
			rank: "a2",
		});

		expect(
			ongoingProjects([backlog, first, second], me).map((each) => each.id),
		).toEqual(["first", "second"]);
	});

	it("leaves out a project in progress that is not mine", () => {
		const ours = node({
			id: "ours",
			status: "execution",
			participantIds: [me, you],
		});
		const theirs = node({
			id: "theirs",
			status: "execution",
			participantIds: [you],
		});

		expect(ongoingProjects([ours, theirs], me).map((each) => each.id)).toEqual([
			"ours",
		]);
	});

	it("leaves out everything that is not in progress", () => {
		const statuses = (["backlog", "next_up", "done"] as const).map((status) =>
			node({ id: status, status, participantIds: [me] }),
		);

		expect(ongoingProjects(statuses, me)).toEqual([]);
	});
});

describe("comingUp", () => {
	const dated = (id: string, dueDate: string, overrides: Partial<Node> = {}) =>
		node({
			id,
			dueDate,
			parentId: "mine",
			ancestorIds: ["mine"],
			...overrides,
		});

	it("puts what is late above what is merely due", () => {
		const soon = dated("soon", "2026-08-18");
		const late = dated("late", "2026-08-01");
		const later = dated("today", "2026-08-15");

		expect(
			comingUp([soon, late, later], roots, me, now).map((each) => each.id),
		).toEqual(["late", "today", "soon"]);
	});

	it("has no room for a node with no due date", () => {
		const undated = node({
			id: "undated",
			parentId: "mine",
			ancestorIds: ["mine"],
		});

		expect(comingUp([undated], roots, me, now)).toEqual([]);
	});

	/** Both sides of the one boundary the section has. */
	it("holds a date exactly the window out, and not the day after", () => {
		const lastDay = dated("last-day", "2026-08-22");
		const dayAfter = dated("day-after", "2026-08-23");

		expect(
			comingUp([lastDay, dayAfter], roots, me, now).map((each) => each.id),
		).toEqual(["last-day"]);
	});

	it("reaches as far back as the date does", () => {
		const ancient = dated("ancient", "2025-06-01");

		expect(comingUp([ancient], roots, me, now).map((each) => each.id)).toEqual([
			"ancient",
		]);
	});

	it("drops a dated node that is already done", () => {
		const finished = dated("finished", "2026-08-14", {
			status: "done",
			completedAt: stamp(now.getTime()),
		});

		expect(comingUp([finished], roots, me, now)).toEqual([]);
	});

	/**
	 * The contradiction the root-scoped predicate exists to prevent: a step of
	 * somebody else's project carries `[]` and would otherwise show here while
	 * its project was hidden from Ongoing projects one heading above.
	 */
	it("drops a step whose project is somebody else's", () => {
		const step = dated("theirs", "2026-08-16", {
			parentId: "yours",
			ancestorIds: ["yours"],
		});

		expect(comingUp([step], roots, me, now)).toEqual([]);
	});

	/**
	 * The same overdue project said twice in one glance — once under Ongoing
	 * projects with its *26 days late* chip, once here with the same title and
	 * the same chip — is the repetition that turns a summary into a scolding.
	 */
	it("drops a root that Ongoing projects is already showing", () => {
		const running = node({
			id: "running",
			status: "execution",
			participantIds: [me],
			dueDate: "2026-08-01",
		});

		expect(comingUp([running], [running], me, now)).toEqual([]);
	});

	/**
	 * The dedupe compares against what Ongoing projects *shows*, not what it
	 * holds. A sixth in-progress project is behind `+N more`, so dropping it here
	 * too would take an overdue project off the screen entirely — invisible in
	 * Ongoing, and gone from the one section that sorts late-first and would have
	 * put it at the top.
	 */
	it("keeps an overdue project that Ongoing projects has behind +N more", () => {
		const running = (index: number) =>
			node({
				id: `running-${index}`,
				status: "execution",
				participantIds: [me],
				rank: `a${index}`,
				dueDate: "2026-08-01",
			});
		const six = [0, 1, 2, 3, 4, 5].map(running);

		// The first five are on screen under Ongoing projects, so they are
		// duplicates. The sixth is not, so it is the one row Coming up must keep.
		expect(comingUp(six, six, me, now).map((each) => each.id)).toEqual([
			"running-5",
		]);
	});

	/**
	 * Only the root itself is the duplicate. Its dated *step* is a different row
	 * saying a different thing, and Ongoing projects never shows steps.
	 */
	it("keeps a dated step of a project that is in progress", () => {
		const running = node({
			id: "running",
			status: "execution",
			participantIds: [me],
		});
		const step = dated("step", "2026-08-16", {
			parentId: "running",
			ancestorIds: ["running"],
		});

		expect(comingUp([step], [running], me, now).map((each) => each.id)).toEqual(
			["step"],
		);
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
