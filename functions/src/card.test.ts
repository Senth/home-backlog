import {
	type ApiCard,
	apiCard,
	blockRanks,
	editorRows,
	etagForCard,
	genericEmptyKey,
	overviewLimit,
	rowsPerSection,
	validateCard,
} from "./card.js";

/**
 * The card model the overview-card verbs stand on, pure and tested plain:
 * what a stored card reads back as, what hash `If-Match` checks, the bounds a
 * written card must satisfy, and the three-scope merge the editor renders.
 */

function aCard(overrides: Partial<ApiCard> = {}): ApiCard {
	return {
		id: "card-1",
		kind: "filter",
		seedId: null,
		title: "Bathroom this month",
		conditions: [{ field: "status", anyOf: ["backlog"] }],
		sort: null,
		shown: rowsPerSection,
		max: overviewLimit,
		empty: { mode: "say", key: genericEmptyKey },
		rank: "V0",
		...overrides,
	};
}

describe("apiCard", () => {
	it("reads a stored card as it stands", () => {
		const card = apiCard("card-1", {
			kind: "filter",
			seedId: null,
			title: "Bathroom",
			conditions: [{ field: "status", anyOf: ["backlog"] }],
			sort: { field: "priority", direction: "desc" },
			shown: 3,
			max: 10,
			empty: { mode: "say", key: genericEmptyKey },
			rank: "V1",
		});
		expect(card.title).toBe("Bathroom");
		expect(card.sort).toEqual({ field: "priority", direction: "desc" });
		expect(card.shown).toBe(3);
		expect(card.max).toBe(10);
	});

	it("falls back the way the app's own defensive read does", () => {
		const card = apiCard("card-1", {});
		expect(card.kind).toBe("filter");
		expect(card.seedId).toBeNull();
		expect(card.title).toBeNull();
		expect(card.conditions).toEqual([]);
		expect(card.sort).toBeNull();
		expect(card.shown).toBe(rowsPerSection);
		expect(card.max).toBe(overviewLimit);
		expect(card.empty).toEqual({ mode: "hide" });
		expect(card.rank).toBe("");
	});

	it("never throws on junk, and keeps nothing that is not a condition object", () => {
		const card = apiCard("card-1", {
			conditions: [{ field: "status", anyOf: ["backlog"] }, "junk", 7, null],
			sort: "nope",
			shown: -4,
		});
		expect(card.conditions).toEqual([{ field: "status", anyOf: ["backlog"] }]);
		expect(card.sort).toBeNull();
		expect(card.shown).toBe(rowsPerSection);
	});
});

describe("etagForCard", () => {
	it("is quoted and stable for the same content", () => {
		expect(etagForCard(aCard())).toBe(etagForCard(aCard()));
		expect(etagForCard(aCard())).toMatch(/^"[0-9a-f]{40}"$/);
	});

	it("changes when any field the write would clobber changes", () => {
		const base = etagForCard(aCard());
		expect(etagForCard(aCard({ title: "Renamed" }))).not.toBe(base);
		expect(etagForCard(aCard({ rank: "V1" }))).not.toBe(base);
		expect(
			etagForCard(aCard({ conditions: [{ field: "isRoot", is: true }] })),
		).not.toBe(base);
	});
});

describe("validateCard", () => {
	it("accepts a plain custom card", () => {
		expect(validateCard(aCard())).toEqual([]);
	});

	it("accepts a seed with no title of its own", () => {
		expect(validateCard(aCard({ seedId: "ongoing", title: null }))).toEqual([]);
	});

	it("refuses a titleless card that is not a seed", () => {
		const issues = validateCard(aCard({ title: null }));
		expect(issues[0]).toMatchObject({ field: "title", code: "title_required" });
		expect(validateCard(aCard({ title: "   " }))[0]).toMatchObject({
			code: "title_required",
		});
	});

	it("caps the title where the app caps it", () => {
		expect(validateCard(aCard({ title: "x".repeat(201) }))[0]).toMatchObject({
			field: "title",
			code: "title_too_long",
		});
		expect(validateCard(aCard({ title: "x".repeat(200) }))).toEqual([]);
	});

	it("takes each condition field exactly once", () => {
		const issues = validateCard(
			aCard({
				conditions: [
					{ field: "status", anyOf: ["backlog"] },
					{ field: "status", anyOf: ["done"] },
				],
			}),
		);
		expect(issues[0]).toMatchObject({ code: "duplicate_condition" });
	});

	it("refuses a condition field the app does not match with", () => {
		const issues = validateCard(
			aCard({ conditions: [{ field: "labelIds", anyOf: ["x"] }] }),
		);
		expect(issues[0]).toMatchObject({ code: "unknown_condition_field" });
	});

	it("refuses an empty any-of: no condition is how a card says nothing", () => {
		const issues = validateCard(
			aCard({ conditions: [{ field: "priority", anyOf: [] }] }),
		);
		expect(issues[0]).toMatchObject({ code: "empty_any_of" });
	});

	it("holds the vocabulary each field matches with", () => {
		const issues = (conditions: unknown[]) =>
			validateCard(aCard({ conditions: conditions as ApiCard["conditions"] }));
		expect(issues([{ field: "status", anyOf: ["queued"] }])[0]).toMatchObject({
			code: "invalid_condition_value",
		});
		expect(issues([{ field: "priority", anyOf: ["none", "urgent"] }])).toEqual(
			[],
		);
		expect(issues([{ field: "effort", anyOf: ["multi_week"] }])).toEqual([]);
		expect(issues([{ field: "dueDate", is: "soon" }])[0]).toMatchObject({
			code: "invalid_condition_value",
		});
		expect(issues([{ field: "blockedBy", is: "sometimes" }])[0]).toMatchObject({
			code: "invalid_condition_value",
		});
		expect(issues([{ field: "notes", is: "yes" }])[0]).toMatchObject({
			code: "invalid_condition_value",
		});
		expect(issues([{ field: "isRoot", is: true }])).toEqual([]);
		expect(issues([{ field: "assigneeIds", anyOf: ["me", "none"] }])).toEqual(
			[],
		);
		expect(issues([{ field: "locationId", is: "none" }])).toEqual([]);
		expect(issues([{ field: "locationId", anyOf: ["loc-1"] }])).toEqual([]);
	});

	it("carries the comingUp window only, and only within the app's bounds", () => {
		const issues = (conditions: unknown[]) =>
			validateCard(aCard({ conditions: conditions as ApiCard["conditions"] }));
		expect(issues([{ field: "dueDate", is: "comingUp", n: 14 }])).toEqual([]);
		expect(
			issues([{ field: "dueDate", is: "comingUp", n: 0 }])[0],
		).toMatchObject({
			code: "invalid_condition_value",
		});
		expect(
			issues([{ field: "dueDate", is: "comingUp", n: 31 }])[0],
		).toMatchObject({
			code: "invalid_condition_value",
		});
		expect(issues([{ field: "dueDate", is: "late", n: 14 }])[0]).toMatchObject({
			code: "invalid_condition_value",
		});
	});

	it("bounds shown and max the way the editor clamps them", () => {
		expect(validateCard(aCard({ max: 0 }))[0]).toMatchObject({
			field: "max",
			code: "invalid_max",
		});
		expect(validateCard(aCard({ max: overviewLimit + 1 }))[0]).toMatchObject({
			code: "invalid_max",
		});
		expect(validateCard(aCard({ shown: 0 }))[0]).toMatchObject({
			field: "shown",
			code: "invalid_shown",
		});
		expect(
			validateCard(aCard({ shown: overviewLimit, max: rowsPerSection }))[0],
		).toMatchObject({ field: "shown", code: "invalid_shown" });
	});

	it("keeps the empty mode on the app's own message", () => {
		expect(validateCard(aCard({ empty: { mode: "hide" } }))).toEqual([]);
		expect(
			validateCard(aCard({ empty: { mode: "say", key: "made.up.key" } }))[0],
		).toMatchObject({ field: "empty", code: "invalid_empty" });
	});
});

describe("editorRows", () => {
	const global = aCard({ id: "g-1", rank: "V0" });
	const home = aCard({ id: "h-1", rank: "V2" });
	const shared = aCard({ id: "s-1", rank: "V1" });
	const sharedTwo = aCard({ id: "s-2", rank: "V3" });

	it("orders the merge by (rank, id) and names each scope", () => {
		const rows = editorRows([global], [home], [shared, sharedTwo], []);
		expect(rows.map((row) => row.id)).toEqual(["g-1", "s-1", "h-1", "s-2"]);
		expect(rows.map((row) => row.scope)).toEqual([
			"global",
			"shared",
			"home",
			"shared",
		]);
	});

	it("marks only the shared cards the member hid", () => {
		const rows = editorRows([], [], [shared, sharedTwo], ["s-1"]);
		expect(rows.find((row) => row.id === "s-1")?.hidden).toBe(true);
		expect(rows.find((row) => row.id === "s-2")?.hidden).toBe(false);
	});

	it("lets a later scope win on an id collision, as the merge does", () => {
		const shadowed = aCard({ id: "dup", rank: "V0" });
		const rows = editorRows(
			[shadowed],
			[aCard({ id: "dup", rank: "V1" })],
			[],
			[],
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ scope: "home", rank: "V1" });
	});

	it("carries an etag per row, and a hidden flag never on the per-user scopes", () => {
		const rows = editorRows([global], [], [shared], ["s-1"]);
		expect(rows[0].etag).toBe(etagForCard(global));
		expect(rows[1].hidden).toBe(true);
		expect(rows[0].hidden).toBe(false);
	});
});

describe("blockRanks", () => {
	it("fills a block between its neighbours, in order", () => {
		const ranks = blockRanks("V0", "V5", 3);
		expect(ranks).toHaveLength(3);
		expect(ranks[0] > "V0").toBe(true);
		expect(ranks[2] < "V5").toBe(true);
		for (let index = 1; index < ranks.length; index++) {
			expect(ranks[index] > ranks[index - 1]).toBe(true);
		}
	});

	it("opens at the end when there is no bound", () => {
		const ranks = blockRanks(null, null, 2);
		expect(ranks[0] < ranks[1]).toBe(true);
		expect(blockRanks("V3", null, 1)[0] > "V3").toBe(true);
	});

	// `"a0"` is the old alphabet's shape — a rank nothing in this system
	// produced. It puts the block at an end rather than failing the request.
	it("survives a rank nothing produced, the way rankAfter does", () => {
		expect(() => blockRanks("a0", "V5", 2)).not.toThrow();
	});
});
