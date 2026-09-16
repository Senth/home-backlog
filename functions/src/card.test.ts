import { etagForCard, mergeCards, readCard, validateCard } from "./card.js";

/**
 * The mirror's own cases: a card stored by the app reads here exactly as it
 * reads there, a card written here validates against the same vocabulary the
 * app composes from, and the merge orders and shadows the way `editorList`
 * does.
 */

const card = {
	id: "ongoing",
	kind: "filter",
	seedId: "ongoing",
	title: null,
	conditions: [{ field: "status", anyOf: ["execution"] }],
	sort: null,
	shown: 5,
	max: 20,
	empty: { mode: "say", key: "overview.ongoing.empty" },
	rank: "a0",
};

describe("reading a stored card", () => {
	it("reads a seed the app wrote", () => {
		expect(readCard("ongoing", card)).toEqual(card);
	});

	it("reads a card written by the shared-collection shape", () => {
		expect(readCard("custom", { ...card, id: "custom", seedId: null })).toEqual(
			{
				...card,
				id: "custom",
				seedId: null,
			},
		);
	});

	it("falls back on every field, the way toCard does", () => {
		expect(readCard("x", {})).toEqual({
			id: "x",
			kind: "filter",
			seedId: null,
			title: null,
			conditions: [],
			sort: null,
			shown: 5,
			max: 20,
			empty: { mode: "hide" },
			rank: "",
		});
	});

	it("drops a junk condition instead of storing a filter that hides rows", () => {
		expect(
			readCard("x", {
				conditions: [{ field: "planets", anyOf: ["mars"] }, "nope"],
			})?.conditions,
		).toEqual([]);
	});

	it("keeps the comingUp window and drops it from the other filters", () => {
		expect(
			readCard("x", {
				conditions: [
					{ field: "dueDate", is: "comingUp", n: 7 },
					{ field: "dueDate", is: "late", n: 7 },
				],
			})?.conditions,
		).toEqual([
			{ field: "dueDate", is: "comingUp", n: 7 },
			{ field: "dueDate", is: "late" },
		]);
	});

	it("answers null for nothing at all", () => {
		expect(readCard("x", undefined)).toBeNull();
		expect(readCard("x", null)).toBeNull();
		expect(readCard("x", "nope")).toBeNull();
	});
});

describe("validating a card to be written", () => {
	it("accepts a well-formed card", () => {
		expect(validateCard(card)).toEqual([]);
	});

	it("accepts every condition shape the editor can compose", () => {
		const issues = validateCard({
			...card,
			seedId: null,
			title: "Everything",
			conditions: [
				{ field: "status", anyOf: ["backlog", "execution"] },
				{ field: "priority", anyOf: ["high", "none"] },
				{ field: "effort", anyOf: ["quick", "none"] },
				{ field: "dueDate", is: "comingUp", n: 30 },
				{ field: "isRoot", is: true },
				{ field: "hasChildren", is: false },
				{ field: "assigneeIds", anyOf: ["me", "none", "uidAnna"] },
				{ field: "participantIds", anyOf: ["me", "uidAnna"] },
				{ field: "blockedBy", is: "none" },
				{ field: "locationId", anyOf: ["locKitchen"] },
				{ field: "visibility", is: "private" },
				{ field: "createdVia", is: "api" },
				{ field: "notes", is: true },
			],
			// One per field, so nothing here duplicates.
		});
		expect(issues).toEqual([]);
	});

	it("refuses a condition outside the vocabulary", () => {
		const issues = validateCard({
			...card,
			seedId: null,
			title: "x",
			conditions: [{ field: "status", anyOf: ["archived"] }],
		});
		expect(issues[0]).toMatchObject({
			field: "conditions",
			code: "invalid_condition",
		});
	});

	it("refuses an empty any-of — an unticked chip group is no condition", () => {
		const issues = validateCard({
			...card,
			seedId: null,
			title: "x",
			conditions: [{ field: "status", anyOf: [] }],
		});
		expect(issues[0]?.code).toBe("invalid_condition");
	});

	it("refuses two conditions on one field — the chips could not show the state", () => {
		const issues = validateCard({
			...card,
			seedId: null,
			title: "x",
			conditions: [
				{ field: "status", anyOf: ["backlog"] },
				{ field: "status", anyOf: ["done"] },
			],
		});
		expect(issues[0]?.code).toBe("duplicate_condition");
	});

	it("refuses a comingUp window outside the editor's stepper range", () => {
		const issues = validateCard({
			...card,
			seedId: null,
			title: "x",
			conditions: [{ field: "dueDate", is: "comingUp", n: 4000 }],
		});
		expect(issues[0]?.code).toBe("invalid_condition");
	});

	it("refuses none among participants — every node has someone", () => {
		const issues = validateCard({
			...card,
			seedId: null,
			title: "x",
			conditions: [{ field: "participantIds", anyOf: ["none"] }],
		});
		expect(issues[0]?.code).toBe("invalid_condition");
	});

	it("refuses an unnamed card that is not a seed", () => {
		const issues = validateCard({ ...card, seedId: null, title: null });
		expect(issues[0]).toMatchObject({ field: "title", code: "title_required" });
	});

	it("allows an unnamed seed", () => {
		expect(validateCard({ ...card, title: null })).toEqual([]);
	});

	it("refuses shown past max, and a max past the overview limit", () => {
		expect(
			validateCard({ ...card, seedId: null, title: "x", shown: 21, max: 20 }),
		).toEqual([
			expect.objectContaining({ field: "shown", code: "invalid_shown" }),
		]);
		expect(
			validateCard({ ...card, seedId: null, title: "x", shown: 2, max: 21 }),
		).toEqual([expect.objectContaining({ field: "max", code: "invalid_max" })]);
	});

	it("refuses a sort the app cannot draw", () => {
		const issues = validateCard({
			...card,
			seedId: null,
			title: "x",
			sort: { field: "priority", direction: "sideways" },
		});
		expect(issues[0]?.code).toBe("invalid_sort");
	});
});

describe("the merged editor list", () => {
	const global = { ...card, id: "a", rank: "a0" };
	const home = { ...card, id: "b", rank: "a8" };
	const shared = {
		...card,
		id: "c",
		rank: "b0",
		seedId: null,
		title: "Shared",
	};

	it("merges all three scopes in rank order", () => {
		expect(
			mergeCards([global], [home], [shared], []).map((row) => row.card.id),
		).toEqual(["a", "b", "c"]);
	});

	it("lets the later scope win on an id collision", () => {
		const shadowed = mergeCards(
			[{ ...card, id: "a", rank: "a0", title: "global copy" }],
			[{ ...card, id: "a", rank: "a2", title: "home copy" }],
			[],
			[],
		);
		expect(shadowed).toHaveLength(1);
		expect(shadowed[0].scope).toBe("home");
		expect(shadowed[0].card.title).toBe("home copy");
	});

	it("flags only the shared cards the caller hid", () => {
		const rows = mergeCards([global], [], [shared], ["c"]);
		expect(rows.find((row) => row.card.id === "c")?.hidden).toBe(true);
		expect(rows.find((row) => row.card.id === "a")?.hidden).toBe(false);
	});

	it("breaks rank ties on id, as the board does", () => {
		expect(
			mergeCards(
				[{ ...card, id: "b", rank: "a0" }],
				[{ ...card, id: "a", rank: "a0" }],
				[],
				[],
			).map((row) => row.card.id),
		).toEqual(["a", "b"]);
	});
});

describe("a card's etag", () => {
	it("is stable while the card is", () => {
		expect(etagForCard(card)).toBe(etagForCard(card));
	});

	it("changes when any stored field changes", () => {
		const others = [
			{ ...card, title: "Renamed" },
			{ ...card, rank: "a1" },
			{ ...card, shown: 3 },
			{ ...card, conditions: [] },
		];
		for (const other of others) {
			expect(etagForCard(other)).not.toBe(etagForCard(card));
		}
	});
});
