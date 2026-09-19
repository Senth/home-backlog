import { locationCounts } from "@/models/location-counts";
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
		columns: ["backlog", "execution", "done"],
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

describe("locationCounts", () => {
	it("counts a card for the place it is filed in", () => {
		const pool = [
			node({ locationId: "shed", locationAncestorIds: ["garden"] }),
		];

		expect(locationCounts(pool).get("shed")).toBe(1);
	});

	it("rolls a card up through every place above it", () => {
		const pool = [
			node({ locationId: "shed", locationAncestorIds: ["garden"] }),
		];

		expect(locationCounts(pool).get("garden")).toBe(1);
	});

	it("counts a card under the place its project passes down (#290)", () => {
		const project = node({
			id: "project",
			locationId: "shed",
			locationAncestorIds: ["garden"],
		});
		const step = node({ id: "step", ancestorIds: ["project"] });
		const pool = [project, step];

		const counts = locationCounts(pool);
		expect(counts.get("shed")).toBe(2);
		expect(counts.get("garden")).toBe(2);
	});

	it("rolls a place whose count comes entirely from its children", () => {
		const pool = [
			node({ id: "a", locationId: "workshop" }),
			node({ id: "b", locationId: "boiler" }),
			node({ id: "c", locationId: "boiler" }),
		];

		expect(locationCounts(pool).get("boiler")).toBe(2);
	});

	it("says nothing for a place with nothing under it", () => {
		const pool = [node({ locationId: "shed", locationAncestorIds: [] })];

		expect(locationCounts(pool).has("attic")).toBe(false);
	});

	it("says nothing for a card filed nowhere", () => {
		const pool = [node({})];

		expect(locationCounts(pool).size).toBe(0);
	});

	it("counts a done parent's filing nothing — the pool is the open set", () => {
		// The pool pair carries open nodes; a crumb it does not hold
		// contributes nothing, so an open step under a *done* project is
		// unfiled as far as this count can know.
		const step = node({ id: "step", ancestorIds: ["done-project"] });

		expect(locationCounts([step]).size).toBe(0);
	});
});
