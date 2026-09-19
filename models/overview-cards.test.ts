import type { Timestamp } from "firebase/firestore";
import type { CardCondition, CardSort } from "@/models/filter";
import { defaultColumns, type Node } from "@/models/node";
import { doneWithinDays } from "@/models/overview";
import {
	cardRows,
	cardScopes,
	conditionForField,
	editorList,
	exportCard,
	importCard,
	removedSeeds,
	type SeedId,
	seedCards,
	seedTitleKeys,
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
/** The project every seeded task sits under — and the only loaded root. */
const mine = node({ id: "mine", participantIds: [me, you] });
const ctx = {
	uid: me,
	now,
	roots: new Map([["mine", mine]]),
	blockers: new Map<string, Node | null>(),
};

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

	it("keeps Recently done the one done card, absent when empty", () => {
		expect(seeded.recentlyDone.kind).toBe("done");
		expect(seeded.recentlyDone.empty).toEqual({ mode: "hide" });
		expect(seeded.recentlyDone.sort).toEqual({
			field: "completedAt",
			direction: "desc",
		});
		expect(seeded.recentlyDone.conditions).toEqual([
			{ field: "completedAt", is: "within" },
		]);
		for (const id of seedIds) {
			if (id !== "recentlyDone") {
				expect(seeded[id].kind).toBe("open");
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

	it("shows the wins cards a task waiting on an open blocker, never (#212)", () => {
		const waiting = (effort: Node["effort"]) =>
			node({
				id: "waiting",
				parentId: "mine",
				ancestorIds: ["mine"],
				participantIds: [me],
				effort,
				blockedBy: ["blocker-1"],
			});
		const blockers = (status: Node["status"]) =>
			new Map([["blocker-1", node({ id: "blocker-1", status })]]);

		for (const [seed, effort] of [
			[seeded.quickWins, "quick"],
			[seeded.aFewHours, "hours"],
		] as const) {
			const task = waiting(effort);
			expect(
				cardRows(seed, [task], { ...ctx, blockers: blockers("backlog") }),
			).toEqual([]);
			// A done blocker is inert history — the task is a win again.
			expect(
				cardRows(seed, [task], {
					...ctx,
					blockers: blockers("done"),
				}).map((each) => each.id),
			).toEqual(["waiting"]);
		}
	});

	it("keeps Needs an estimate to tasks without children (#212)", () => {
		const under = (overrides: Partial<Node> = {}) =>
			node({
				parentId: "mine",
				ancestorIds: ["mine"],
				participantIds: [me],
				...overrides,
			});

		expect(
			cardRows(seeded.needsEstimate, [under({ childCount: 2 })], ctx),
		).toEqual([]);
		expect(
			cardRows(seeded.needsEstimate, [under()], ctx).map((each) => each.id),
		).toEqual(["node-1"]);
	});
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
	const scoped = {
		...ctx,
		roots: new Map([
			["theirs", theirs],
			["ours", ours],
		]),
	};

	expect(
		cardRows(card([]), [theirs, ours], scoped).map((each) => each.id),
	).toEqual(["ours"]);
});

describe("cardRows", () => {
	/**
	 * The done card is ordinary now (#229): the done pair feeds it and
	 * `cardRows` does the rest — the same predicate, sort and privacy every
	 * other card answers to. An open node matches nothing on it, however it
	 * was fed: the mode carries the predicate its conditions cannot say.
	 */
	it("renders the done card from the pair it is fed, and never from the open pool", () => {
		const finished = (id: string, rank: string, msAgo: number) =>
			node({
				id,
				rank,
				status: "done",
				parentId: "mine",
				ancestorIds: ["mine"],
				participantIds: [me],
				completedAt: stamp(now.getTime() - msAgo),
			});
		const open = node({ id: "open", parentId: "mine", ancestorIds: ["mine"] });

		expect(
			cardRows(
				seeded.recentlyDone,
				[finished("a", "a0", dayInMs), open],
				ctx,
			).map((each) => each.id),
		).toEqual(["a"]);
		expect(
			cardRows(seeded.recentlyDone, [open], ctx).map((each) => each.id),
		).toEqual([]);
	});

	it("is newest first, to the millisecond at the window's edge", () => {
		const finished = (id: string, rank: string, msAgo: number) =>
			node({
				id,
				rank,
				status: "done",
				parentId: "mine",
				ancestorIds: ["mine"],
				participantIds: [me],
				completedAt: stamp(now.getTime() - msAgo),
			});

		expect(
			cardRows(
				seeded.recentlyDone,
				[
					finished("older", "a0", 10 * dayInMs),
					finished("newest", "a1", dayInMs),
					finished("middle", "a2", 4 * dayInMs),
					// Exactly the window ago is in; a moment older is out.
					finished("edge", "a3", doneWithinDays * dayInMs),
					finished("past", "a4", doneWithinDays * dayInMs + 1),
				],
				ctx,
			).map((each) => each.id),
		).toEqual(["newest", "middle", "older", "edge"]);
	});

	it("drops a finished step of somebody else's project", () => {
		const step = node({
			id: "theirs",
			status: "done",
			parentId: "yours",
			ancestorIds: ["yours"],
			participantIds: [me],
			completedAt: stamp(now.getTime() - dayInMs),
		});

		expect(cardRows(seeded.recentlyDone, [step], ctx)).toEqual([]);
	});

	it("slices to nothing here — the renderer owns shown and max", () => {
		const nodes = ["a", "b", "c", "d"].map((id, index) =>
			node({ id, rank: `a${index}`, parentId: "mine", ancestorIds: ["mine"] }),
		);

		expect(cardRows(card([]), nodes, ctx)).toHaveLength(4);
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

	it("reads a stored done seed back whole", () => {
		const stored = seeded.recentlyDone;
		const read = toCard(
			stored.id,
			stored as unknown as Record<string, unknown>,
		);

		expect(read).toEqual(stored);
	});

	it("decodes a done card with its open-work questions dropped", () => {
		const read = toCard("done", {
			kind: "done",
			conditions: [
				{ field: "status", anyOf: ["execution"] },
				{ field: "dueDate", is: "late" },
				{ field: "blockedBy", is: "none" },
				{ field: "completedAt", is: "within", n: 14 },
			],
			sort: { field: "completedAt", direction: "desc" },
		});

		expect(read?.conditions).toEqual([
			{ field: "completedAt", is: "within", n: 14 },
		]);
		expect(read?.sort).toEqual({ field: "completedAt", direction: "desc" });
	});

	it("decodes an open card with its completed questions dropped", () => {
		const read = toCard("open", {
			kind: "open",
			conditions: [
				{ field: "effort", anyOf: ["quick"] },
				{ field: "completedAt", is: "within" },
			],
			sort: { field: "completedAt", direction: "desc" },
		});

		expect(read?.conditions).toEqual([{ field: "effort", anyOf: ["quick"] }]);
		// A completed-at ranking is a done-card question too.
		expect(read?.sort).toBeNull();
	});

	it("falls back field by field instead of crashing the screen", () => {
		const read = toCard("junk", {
			kind: "open",
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

describe("exportCard / importCard", () => {
	it("round-trips a card whole, including conditions, sort, shown/max and empty", () => {
		const source = {
			...seeded.quickWins,
			title: null,
		};
		// A seed's title is resolved at the surface before export — the
		// importer's own i18n never travels.
		const text = exportCard({ ...source, title: "Quick wins" });
		const back = importCard(text);

		expect(back).toEqual({
			kind: "open",
			seedId: null,
			title: "Quick wins",
			conditions: source.conditions,
			sort: source.sort,
			shown: source.shown,
			max: source.max,
			empty: source.empty,
		});
	});

	it("carries member references inside the string", () => {
		const text = exportCard({
			...seeded.ongoing,
			title: "Mine",
			conditions: [
				{ field: "assigneeIds", anyOf: ["me", "uid-nadia"] },
				{ field: "participantIds", anyOf: ["uid-someone-else"] },
			],
		});
		const back = importCard(text);

		expect(back?.conditions).toEqual([
			{ field: "assigneeIds", anyOf: ["me", "uid-nadia"] },
			{ field: "participantIds", anyOf: ["uid-someone-else"] },
		]);
	});

	it("leaves the id, rank and seedId behind — the importer mints their own", () => {
		const text = exportCard({ ...seeded.comingUp, title: "Coming up" });
		const payload = JSON.parse(text) as Record<string, unknown>;
		expect(Object.keys(payload).sort()).toEqual([
			"conditions",
			"empty",
			"kind",
			"max",
			"shown",
			"sort",
			"title",
		]);
	});

	it("declares nothing about a string that is not a card", () => {
		expect(importCard("not json at all")).toBeNull();
		expect(importCard("")).toBeNull();
		expect(importCard("42")).toBeNull();
		expect(importCard('"a string"')).toBeNull();
		expect(importCard("[]")).toBeNull();
	});

	it("refuses the built-in completed card and a card with no name", () => {
		expect(
			importCard(
				exportCard({ ...seeded.recentlyDone, title: "Recently done" }),
			),
		).toBeNull();
		expect(importCard('{"kind":"filter"}')).toBeNull();
	});

	it("defaults what it cannot understand instead of throwing", () => {
		const back = importCard(
			JSON.stringify({
				title: "Hand-made",
				conditions: [
					{ field: "no-such-field", is: true },
					{ field: "dueDate", is: "yesterday" },
					{ field: "effort", anyOf: ["quick"] },
				],
				sort: { field: "priority", direction: "sideways" },
				shown: "many",
				surprise: true,
			}),
		);

		expect(back).toEqual({
			kind: "open",
			seedId: null,
			title: "Hand-made",
			conditions: [{ field: "effort", anyOf: ["quick"] }],
			sort: null,
			shown: 5,
			max: 20,
			empty: { mode: "hide" },
		});
	});
});
