import type { Timestamp } from "firebase/firestore";
import { type CardCondition, type CardSort, sortRows } from "@/models/filter";
import { defaultColumns, type Node } from "@/models/node";
import {
	cardRows,
	exportCard,
	importCard,
	seedCards,
	toCard,
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
		labelIds: [],
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
const ctx = {
	uid: me,
	now,
	roots: new Map([["mine", mine]]),
	blockers: new Map<string, Node | null>(),
};

const seeded = seedCards();

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

		it("widens the coming-up window to the condition's own n", () => {
			const within = (n: number) => [
				{ field: "dueDate", is: "comingUp", n } as CardCondition,
			];

			expect(rowsOf(within(14), dated("2026-08-29"))).toEqual(["node-1"]);
			expect(rowsOf(within(14), dated("2026-08-30"))).toEqual([]);
			// Late is late at any width.
			expect(rowsOf(within(14), dated("2026-08-01"))).toEqual(["node-1"]);
			// A narrower window hides what the default kept.
			expect(rowsOf(within(1), dated("2026-08-17"))).toEqual([]);
			// Storage drops a junk n, which is the default window again.
			expect(
				rowsOf(
					toCard("test", {
						conditions: [{ field: "dueDate", is: "comingUp", n: "soon" }],
					})?.conditions ?? [],
					dated("2026-08-22"),
				),
			).toEqual(["node-1"]);
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
		const scoped = { ...ctx, roots: new Map(ctx.roots).set(root.id, root) };
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

	describe("blockedBy means #66's waiting", () => {
		const waiting = task({ blockedBy: ["blocker-1"] });
		const withBlocker = (blocker: Node | null) =>
			new Map<string, Node | null>([["blocker-1", blocker]]);
		const done = task({ id: "blocker-1", status: "done" });
		const open = task({ id: "blocker-1", status: "backlog" });
		const rowsWith = (
			conditions: CardCondition[],
			blockers: ReturnType<typeof withBlocker>,
		) =>
			cardRows(card(conditions), [waiting], { ...ctx, blockers }).map(
				(each) => each.id,
			);

		it("does not match any when the only blocker is done", () => {
			expect(
				rowsWith([{ field: "blockedBy", is: "any" }], withBlocker(done)),
			).toEqual([]);
		});

		it("matches any while a blocker is open", () => {
			expect(
				rowsWith([{ field: "blockedBy", is: "any" }], withBlocker(open)),
			).toEqual(["node-1"]);
		});

		it("matches any for a blocker absent from the map — the not-yet direction", () => {
			expect(rowsWith([{ field: "blockedBy", is: "any" }], new Map())).toEqual([
				"node-1",
			]);
			// A `null` — the watcher's "server confirmed gone" — waits too.
			expect(
				rowsWith([{ field: "blockedBy", is: "any" }], withBlocker(null)),
			).toEqual(["node-1"]);
		});

		it("answers none the same whatever the map holds, when nothing blocks", () => {
			const unblocked = [task()];
			expect(
				cardRows(card([{ field: "blockedBy", is: "none" }]), unblocked, {
					...ctx,
					blockers: withBlocker(done),
				}).map((each) => each.id),
			).toEqual(["node-1"]);
		});

		it("keeps the raw-length behavior on an empty map", () => {
			expect(rowsWith([{ field: "blockedBy", is: "any" }], new Map())).toEqual([
				"node-1",
			]);
			expect(rowsWith([{ field: "blockedBy", is: "none" }], new Map())).toEqual(
				[],
			);
		});
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

	describe("locationId picker — in or under", () => {
		const picking = (ids: readonly string[]) =>
			[{ field: "locationId", anyOf: ids }] as CardCondition[];
		const rowsPicking = (ids: readonly string[], nodes: Node[]) =>
			rowsOf(picking(ids), nodes);
		// The kitchen sits under the house; the shed stands alone.
		const under = task({
			locationId: "kitchen",
			locationAncestorIds: ["house"],
		});

		it("matches a node by its own location", () => {
			expect(rowsPicking(["kitchen"], [under])).toEqual(["node-1"]);
		});

		it("matches a node under a picked location through the ancestor chain", () => {
			expect(rowsPicking(["house"], [under])).toEqual(["node-1"]);
		});

		it("matches an unknown id by nothing", () => {
			expect(rowsPicking(["boat"], [under])).toEqual([]);
		});

		it("reads none exactly as before, whatever the picker does", () => {
			expect(
				rowsOf([{ field: "locationId", is: "none" }], [under, task()]),
			).toEqual([task().id]);
			expect(
				rowsOf([{ field: "locationId", is: "any" }], [under, task()]),
			).toEqual([under.id]);
		});

		it("matches a card through the place its trail passes down (#290)", () => {
			// The step was never filed; it answers for the kitchen its project
			// carries, with the kitchen's own path as the "under".
			const step = task({ id: "step-1", locationId: null });
			const located = {
				...ctx,
				locations: new Map([
					["step-1", { locationId: "kitchen", locationAncestorIds: ["house"] }],
				]),
			};

			expect(
				cardRows(card(picking(["house"])), [step], located).map(
					(each) => each.id,
				),
			).toEqual(["step-1"]);
			expect(
				cardRows(card(picking(["kitchen"])), [step], located).map(
					(each) => each.id,
				),
			).toEqual(["step-1"]);
			expect(
				cardRows(card(picking(["boat"])), [step], located).map(
					(each) => each.id,
				),
			).toEqual([]);
			expect(
				cardRows(
					card([{ field: "locationId", is: "any" }]),
					[step],
					located,
				).map((each) => each.id),
			).toEqual(["step-1"]);
			expect(
				cardRows(
					card([{ field: "locationId", is: "none" }]),
					[step],
					located,
				).map((each) => each.id),
			).toEqual([]);
		});

		it("answers from the stored fields when no ancestor data rides along", () => {
			const placed = task({ locationId: "kitchen" });

			expect(
				rowsOf([{ field: "locationId", is: "none" }], [placed, task()]),
			).toEqual([task().id]);
			expect(rowsPicking(["kitchen"], [placed])).toEqual(["node-1"]);
		});

		it("decodes the picker form, dropping junk and empty lists to the is-form", () => {
			const read = toCard("p", {
				conditions: [
					{
						field: "locationId",
						anyOf: ["kitchen", 7, null, "boat"],
					},
					{ field: "locationId", anyOf: [] },
					{ field: "locationId", is: "none" },
				],
			});

			expect(read?.conditions).toEqual([
				{ field: "locationId", anyOf: ["kitchen", "boat"] },
				{ field: "locationId", is: "none" },
			]);
		});

		it("travels export → import as ids", () => {
			const card = {
				...seeded.ongoing,
				title: "E2E location card",
				conditions: picking(["kitchen", "boat"]),
			};
			const round = importCard(exportCard(card));

			expect(round?.conditions).toEqual(picking(["kitchen", "boat"]));
		});
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
