import type { Timestamp } from "firebase/firestore";
import { defaultColumns, type Node } from "@/models/node";
import {
	type CardCondition,
	type CardSort,
	cardRows,
	cardScopes,
	conditionForField,
	editorList,
	mergeCards,
	removedSeeds,
	type SeedId,
	seedCards,
	seedTitleKeys,
	sortRows,
	toCard,
	withCondition,
} from "@/models/overview-cards";

/**
 * Pinned like `overview.test.ts`: the `dueDate` conditions compare calendar
 * days, so the boundary has to be proven in a zone the app ships strings for.
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

const me = "uid-me";
const you = "uid-you";
/** The project every seeded task sits under — and the only loaded root. */
const mine = node({ id: "mine", participantIds: [me, you] });
const ctx = { uid: me, now, roots: [mine] };

/** A card with just these conditions, in board order, over the whole scale. */
function card(conditions: CardCondition[], sort: CardSort | null = null) {
	return {
		...seedCards().ongoing,
		id: "test",
		seedId: null,
		conditions,
		sort,
	};
}

function rowsOf(
	conditions: CardCondition[],
	nodes: Node[],
	sort: Parameters<typeof sortRows>[1] = null,
) {
	return cardRows(card(conditions, sort), nodes, ctx).map((each) => each.id);
}

const seeded = seedCards();
const seedIds = Object.keys(seeded);

describe("seedCards", () => {
	it("is the seven seeds, uniquely ranked", () => {
		expect(seedIds).toHaveLength(7);
		expect(new Set(seedIds).size).toBe(7);
		expect(new Set(Object.values(seeded).map((each) => each.rank)).size).toBe(
			7,
		);
	});

	it("titles every seed through i18n, never a stored string", () => {
		for (const id of seedIds) {
			expect(seeded[id].title).toBeNull();
			expect(seeded[id].seedId).toBe(id as SeedId);
			expect(seedTitleKeys[id as SeedId]).toBeTruthy();
		}
	});

	it("keeps Recently done the one completed card, absent when empty", () => {
		expect(seeded.recentlyDone.kind).toBe("completed");
		expect(seeded.recentlyDone.empty).toEqual({ mode: "hide" });
		for (const id of seedIds) {
			if (id !== "recentlyDone") {
				expect(seeded[id].kind).toBe("filter");
				expect(seeded[id].empty.mode).toBe("say");
			}
		}
	});

	/**
	 * The partition: every effort value lands in exactly one of the four
	 * effort cards. The cost of the upper bound on *A few hours* is accepted
	 * in the spec; a hole in the scale is not.
	 */
	it("partitions the effort scale across the four effort cards", () => {
		const effortSeeds = [
			seeded.quickWins,
			seeded.aFewHours,
			seeded.needsSplitting,
			seeded.needsEstimate,
		];
		const values = effortSeeds.flatMap(
			(each) =>
				(
					each.conditions.find(
						(condition) => condition.field === "effort",
					) as Extract<CardCondition, { field: "effort" }>
				).anyOf,
		);

		expect([...values].sort()).toEqual([
			"evening",
			"hours",
			"multi_week",
			"none",
			"quick",
			"weekend",
		]);
		expect(new Set(values).size).toBe(values.length);
	});
});

describe("matching", () => {
	const task = (overrides: Partial<Node> = {}) =>
		node({
			parentId: "mine",
			ancestorIds: ["mine"],
			participantIds: [me],
			...overrides,
		});

	it("matches status as any-of", () => {
		const conditions: CardCondition[] = [
			{ field: "status", anyOf: ["next_up", "execution"] },
		];

		expect(rowsOf(conditions, [task({ status: "backlog" })])).toEqual([]);
		expect(rowsOf(conditions, [task({ status: "execution" })])).toEqual([
			"node-1",
		]);
	});

	it("reads an unset priority or effort as none, and a set one as itself", () => {
		expect(rowsOf([{ field: "priority", anyOf: ["none"] }], [task()])).toEqual([
			"node-1",
		]);
		expect(
			rowsOf([{ field: "priority", anyOf: ["urgent"] }], [task()]),
		).toEqual([]);
		expect(rowsOf([{ field: "effort", anyOf: ["none"] }], [task()])).toEqual([
			"node-1",
		]);
		expect(
			rowsOf(
				[{ field: "effort", anyOf: ["quick"] }],
				[task({ effort: "quick" })],
			),
		).toEqual(["node-1"]);
	});

	describe("dueDate", () => {
		const dated = (dueDate: string | null) => [task({ dueDate })];
		const only = (is: "comingUp" | "late" | "notLate" | "none") => [
			{ field: "dueDate", is } as CardCondition,
		];

		it("puts late and within the window in coming up, and nothing else", () => {
			expect(rowsOf(only("comingUp"), dated("2026-08-01"))).toEqual(["node-1"]);
			// The last day inside the window: `soonInDays` is inclusive.
			expect(rowsOf(only("comingUp"), dated("2026-08-22"))).toEqual(["node-1"]);
			expect(rowsOf(only("comingUp"), dated("2026-08-23"))).toEqual([]);
			expect(rowsOf(only("comingUp"), dated(null))).toEqual([]);
		});

		it("keeps not late and none apart", () => {
			expect(rowsOf(only("late"), dated("2026-08-14"))).toEqual(["node-1"]);
			expect(rowsOf(only("notLate"), dated("2026-08-15"))).toEqual(["node-1"]);
			expect(rowsOf(only("notLate"), dated("2026-09-30"))).toEqual(["node-1"]);
			expect(rowsOf(only("notLate"), dated("2026-08-01"))).toEqual([]);
			expect(rowsOf(only("none"), dated(null))).toEqual(["node-1"]);
			expect(rowsOf(only("none"), dated("2026-09-30"))).toEqual([]);
		});
	});

	it("asks roots and children about the node, not its title", () => {
		const root = node({ id: "root", childCount: 2, participantIds: [me, you] });
		const childless = task();
		const scoped = { ...ctx, roots: [...ctx.roots, root] };
		const ids = (conditions: CardCondition[]) =>
			cardRows(card(conditions), [root, childless], scoped).map(
				(each) => each.id,
			);

		expect(ids([{ field: "isRoot", is: true }])).toEqual([root.id]);
		expect(ids([{ field: "isRoot", is: false }])).toEqual([childless.id]);
		expect(ids([{ field: "hasChildren", is: true }])).toEqual([root.id]);
		expect(ids([{ field: "hasChildren", is: false }])).toEqual([childless.id]);
	});

	it("reads people conditions with me and none as reserved words", () => {
		const assigned = task({ assigneeIds: [you] });
		const unassigned = task();
		const conditions: CardCondition[] = [
			{ field: "assigneeIds", anyOf: ["me", "none"] },
		];

		expect(rowsOf(conditions, [assigned, unassigned])).toEqual([unassigned.id]);
		expect(
			rowsOf([{ field: "assigneeIds", anyOf: [you] }], [assigned]),
		).toEqual([assigned.id]);
		expect(
			rowsOf([{ field: "participantIds", anyOf: ["me"] }], [assigned]),
		).toEqual([assigned.id]);
	});

	it("answers the boolean conditions off the fields they name", () => {
		const blocked = task({ blockedBy: ["other"] });
		const noted = task({ notes: "brackets first" });
		const conditions: CardCondition[] = [{ field: "blockedBy", is: "none" }];

		expect(rowsOf(conditions, [blocked, noted])).toEqual([noted.id]);
		expect(
			rowsOf(
				[{ field: "visibility", is: "private" }],
				[task({ visibility: "private", participantIds: [me] })],
			),
		).toEqual(["node-1"]);
		expect(
			rowsOf(
				[{ field: "createdVia", is: "api" }],
				[task({ createdVia: "api" })],
			),
		).toEqual(["node-1"]);
		expect(
			rowsOf(
				[{ field: "checklist", is: true }],
				[task({ checklist: [{ id: "c1", text: "x", done: false }] })],
			),
		).toEqual(["node-1"]);
	});

	it("asks locationId about the field the node carries", () => {
		const placed = task({ locationId: "kitchen" });

		expect(
			rowsOf([{ field: "locationId", is: "any" }], [placed, task()]),
		).toEqual([placed.id]);
		expect(rowsOf([{ field: "locationId", is: "none" }], [placed])).toEqual([]);
		expect(rowsOf([{ field: "locationId", is: "none" }], [task()])).toEqual([
			"node-1",
		]);
	});

	/**
	 * The privacy predicate is not a condition and not optional: the pool's
	 * shared arm matches every shared node regardless of participants, so a
	 * card is exactly one more place a root the household hid from me could
	 * leak.
	 */
	it("never shows a node its root hides from the reader", () => {
		const theirs = node({ id: "theirs", participantIds: [you] });
		const ours = node({ id: "ours", participantIds: [me, you] });
		const scoped = { ...ctx, roots: [theirs, ours] };

		expect(
			cardRows(card([]), [theirs, ours], scoped).map((each) => each.id),
		).toEqual(["ours"]);
	});
});

describe("sortRows", () => {
	const row = (id: string, rank: string, overrides: Partial<Node> = {}) =>
		node({ id, rank, ...overrides });

	it("is board order when the card does not sort", () => {
		const rows = [row("b", "a1"), row("a", "a0")];

		expect(sortRows(rows, null).map((each) => each.id)).toEqual(["a", "b"]);
	});

	it("sorts asc and desc by the ordinal, never the id's spelling", () => {
		const rows = [
			row("low", "a0", { priority: "low" }),
			row("high", "a1", { priority: "high" }),
		];

		expect(
			sortRows(rows, { field: "priority", direction: "asc" }).map(
				(each) => each.id,
			),
		).toEqual(["low", "high"]);
		expect(
			sortRows(rows, { field: "priority", direction: "desc" }).map(
				(each) => each.id,
			),
		).toEqual(["high", "low"]);
	});

	/**
	 * "Unknown" is not "lowest": a null value sits at the bottom in both
	 * directions, and still on the board — the card renders, it just cannot
	 * rank what was never set.
	 */
	it("sorts a null value last whatever the direction", () => {
		const rows = [
			row("unset", "a2"),
			row("high", "a0", { priority: "urgent" }),
			row("low", "a1", { priority: "low" }),
		];

		expect(
			sortRows(rows, { field: "priority", direction: "desc" }).map(
				(each) => each.id,
			),
		).toEqual(["high", "low", "unset"]);
		expect(
			sortRows(rows, { field: "priority", direction: "asc" }).map(
				(each) => each.id,
			),
		).toEqual(["low", "high", "unset"]);
	});

	it("sorts a calendar-day dueDate chronologically", () => {
		const rows = [
			row("late", "a0", { dueDate: "2026-08-01" }),
			row("soon", "a1", { dueDate: "2026-08-20" }),
		];

		expect(
			sortRows(rows, { field: "dueDate", direction: "asc" }).map(
				(each) => each.id,
			),
		).toEqual(["late", "soon"]);
	});

	it("sorts completions newest first by the timestamp", () => {
		const rows = [
			row("older", "a0", { completedAt: stamp(now.getTime() - dayInMs) }),
			row("newer", "a1", { completedAt: stamp(now.getTime()) }),
		];

		expect(
			sortRows(rows, { field: "completedAt", direction: "desc" }).map(
				(each) => each.id,
			),
		).toEqual(["newer", "older"]);
	});

	it("breaks ties on (rank, id)", () => {
		const rows = [row("b", "a1"), row("a", "a1"), row("a", "a0")];

		expect(
			sortRows(rows, { field: "priority", direction: "asc" }).map(
				(each) => each.id + each.rank,
			),
		).toEqual(["aa0", "aa1", "ba1"]);
	});
});

describe("cardRows", () => {
	it("never hands rows to the completed card, which the done pair feeds", () => {
		expect(cardRows(seeded.recentlyDone, [node()], ctx)).toEqual([]);
	});

	it("slices to nothing here — the renderer owns shown and max", () => {
		const nodes = ["a", "b", "c", "d"].map((id, index) =>
			node({ id, rank: `a${index}`, parentId: "mine", ancestorIds: ["mine"] }),
		);

		expect(cardRows(card([]), nodes, ctx)).toHaveLength(4);
	});
});

describe("mergeCards", () => {
	const made = (id: string, rank: string) =>
		({ ...seeded.ongoing, id, rank }) as ReturnType<
			typeof seedCards
		>[keyof ReturnType<typeof seedCards>];

	it("merges the three scopes and orders by (rank, id)", () => {
		const merged = mergeCards(
			[made("global", "a5")],
			[made("home", "a1")],
			[made("shared", "a3")],
			[],
		);

		expect(merged.map((each) => each.id)).toEqual(["home", "shared", "global"]);
	});

	it("lets a later scope win an id collision", () => {
		const merged = mergeCards(
			[made("same", "a1")],
			[made("same", "a2")],
			[],
			[],
		);

		expect(merged).toHaveLength(1);
		expect(merged[0].rank).toBe("a2");
	});

	it("drops a shared card this member hid, and only shared ones", () => {
		const merged = mergeCards(
			[made("global", "a1")],
			[made("home", "a2")],
			[made("shared", "a3")],
			["shared", "global"],
		);

		expect(merged.map((each) => each.id)).toEqual(["global", "home"]);
	});
});

describe("editorList", () => {
	const made = (id: string, rank: string) =>
		({ ...seeded.ongoing, id, rank }) as ReturnType<
			typeof seedCards
		>[keyof ReturnType<typeof seedCards>];

	it("keeps a hidden shared card, badged, where the screen's list drops it", () => {
		const list = editorList([], [], [made("shared", "a1")], ["shared"]);

		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({ scope: "shared", hidden: true });

		expect(mergeCards([], [], [made("shared", "a1")], ["shared"])).toEqual([]);
	});

	it("names the winning scope of an id collision", () => {
		const list = editorList([made("same", "a1")], [made("same", "a2")], [], []);

		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({ scope: "home" });
	});

	it("never marks a global or home card hidden, whatever a stale hide id says", () => {
		const list = editorList([made("global", "a1")], [], [], ["global"]);

		expect(list[0]).toMatchObject({ scope: "global", hidden: false });
	});
});

describe("cardScopes", () => {
	it("answers per card, later scope winning", () => {
		const global = seeded.ongoing;
		const home = { ...seeded.comingUp, id: "home-card" };
		const shared = { ...seeded.quickWins, id: "shared-card" };

		expect(
			cardScopes([global], [home], [shared, { ...global, rank: "zz" }]),
		).toEqual({
			[global.id]: "shared",
			[home.id]: "home",
			[shared.id]: "shared",
		});
	});
});

describe("removedSeeds", () => {
	it("lists the seeds the cards no longer hold, with their original settings", () => {
		const kept = [seeded.ongoing, seeded.comingUp];

		expect(removedSeeds(kept).map((seed) => seed.id)).toEqual([
			"quickWins",
			"aFewHours",
			"needsSplitting",
			"needsEstimate",
			"recentlyDone",
		]);
	});

	it("finds a seed held in any scope, including one somebody hid", () => {
		const shared = { ...seeded.quickWins, id: "shared-copy", rank: "zz" };

		expect(removedSeeds([shared])).not.toContainEqual(
			expect.objectContaining({ id: "quickWins" }),
		);
	});

	it("lists every seed when nothing is held", () => {
		expect(removedSeeds([])).toHaveLength(7);
	});
});

describe("editing conditions", () => {
	it("answers the one condition a field carries, or none", () => {
		const conditions: CardCondition[] = [
			{ field: "effort", anyOf: ["quick"] },
			{ field: "isRoot", is: true },
		];

		expect(conditionForField(conditions, "effort")).toEqual({
			field: "effort",
			anyOf: ["quick"],
		});
		expect(conditionForField(conditions, "dueDate")).toBeNull();
	});

	it("replaces a field's condition and keeps the others", () => {
		const next = withCondition(
			[
				{ field: "effort", anyOf: ["quick"] },
				{ field: "isRoot", is: true },
			],
			{ field: "effort", anyOf: ["hours", "evening"] },
		);

		expect(next).toEqual([
			{ field: "isRoot", is: true },
			{ field: "effort", anyOf: ["hours", "evening"] },
		]);
	});

	it("removes a field's condition when it is unticked entirely", () => {
		const next = withCondition(
			[
				{ field: "effort", anyOf: ["quick"] },
				{ field: "isRoot", is: true },
			],
			{ field: "effort", anyOf: [] },
		);

		expect(next).toEqual([{ field: "isRoot", is: true }]);

		const nothing = withCondition([{ field: "isRoot", is: true }], null);
		expect(nothing).toEqual([{ field: "isRoot", is: true }]);
	});
});

describe("toCard", () => {
	it("reads a stored seed back whole", () => {
		const stored = seeded.quickWins;
		const read = toCard(
			stored.id,
			stored as unknown as Record<string, unknown>,
		);

		expect(read).toEqual(stored);
	});

	it("falls back field by field instead of crashing the screen", () => {
		const read = toCard("junk", {
			kind: "filter",
			conditions: [
				"not-a-condition",
				{ field: "no-such-field" },
				{ field: "effort", anyOf: ["quick"] },
				{ field: "dueDate", is: "yesterday" },
			],
			sort: { field: "priority", direction: "sideways" },
			shown: -3,
			max: "many",
			rank: 7,
		});

		expect(read).toMatchObject({
			id: "junk",
			conditions: [{ field: "effort", anyOf: ["quick"] }],
			sort: null,
			shown: 5,
			max: 20,
			empty: { mode: "hide" },
			rank: "",
		});
	});

	it("keeps a say-empty whose key is really a string", () => {
		const read = toCard("said", {
			empty: { mode: "say", key: "overview.due.empty" },
		});

		expect(read?.empty).toEqual({ mode: "say", key: "overview.due.empty" });
	});

	it("reads nothing out of nothing", () => {
		expect(toCard("gone", undefined)).toBeNull();
		expect(toCard("gone", null)).toBeNull();
		expect(
			toCard("gone", "junk" as unknown as Record<string, unknown>),
		).toBeNull();
	});
});
