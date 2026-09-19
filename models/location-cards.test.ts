import { cardsAtPlace, maxLocationCards } from "@/models/location-cards";
import type { Node } from "@/models/node";

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
		columns: ["backlog", "next_up", "execution", "done"],
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

describe("cardsAtPlace", () => {
	it("draws the card filed exactly at the place", () => {
		const pool = [
			node({ id: "a", locationId: "shed", locationAncestorIds: [] }),
		];

		expect(cardsAtPlace(pool, "shed")?.cards.map((n) => n.id)).toEqual(["a"]);
	});

	it("excludes a card filed under the place — the list does not roll up", () => {
		const pool = [
			node({ id: "a", locationId: "workshop", locationAncestorIds: ["shed"] }),
		];

		expect(cardsAtPlace(pool, "shed")).toBeNull();
	});

	it("includes a card the project passes the place down to (#290)", () => {
		const project = node({
			id: "project",
			locationId: "shed",
			// A project with a step in it is not a leaf — and is not drawn here
			// even when it is filed at the place itself.
			childCount: 1,
		});
		const step = node({ id: "step", ancestorIds: ["project"] });
		const pool = [project, step];

		expect(cardsAtPlace(pool, "shed")?.cards.map((n) => n.id)).toEqual([
			"step",
		]);
	});

	it("excludes a card that is itself a board", () => {
		const pool = [node({ id: "a", locationId: "shed", childCount: 2 })];

		expect(cardsAtPlace(pool, "shed")).toBeNull();
	});

	it("falls through to next up, then to do, and the heading names the chain", () => {
		expect(
			cardsAtPlace(
				[node({ id: "a", status: "next_up", ...{}, locationId: "shed" })],
				"shed",
			)?.source,
		).toBe("next_up");
		expect(
			cardsAtPlace(
				[node({ id: "a", status: "backlog", locationId: "shed" })],
				"shed",
			)?.source,
		).toBe("backlog");
	});

	it("prefers execution over anything later in the chain", () => {
		const pool = [
			node({ id: "todo", status: "backlog", locationId: "shed" }),
			node({ id: "doing", status: "execution", locationId: "shed" }),
		];

		const drawn = cardsAtPlace(pool, "shed");
		expect(drawn?.source).toBe("execution");
		expect(drawn?.cards.map((n) => n.id)).toEqual(["doing"]);
	});

	it("caps at five, by priority", () => {
		const pool = Array.from({ length: 7 }, (_, index) =>
			node({
				id: `card-${index}`,
				status: "backlog",
				locationId: "shed",
				priority: index === 6 ? "urgent" : null,
				rank: `a${index}`,
			}),
		);
		const drawn = cardsAtPlace(pool, "shed");

		expect(drawn?.cards).toHaveLength(maxLocationCards);
		expect(drawn?.cards[0].id).toBe("card-6");
		expect(drawn?.more).toBe(2);
	});

	it("orders an equal-priority chain by rank", () => {
		const pool = [
			node({ id: "b", locationId: "shed", rank: "a2" }),
			node({ id: "a", locationId: "shed", rank: "a1" }),
		];

		expect(cardsAtPlace(pool, "shed")?.cards.map((n) => n.id)).toEqual([
			"a",
			"b",
		]);
	});

	it("draws nothing for a place with no cards", () => {
		expect(cardsAtPlace([], "shed")).toBeNull();
	});
});
