import { locationCounts } from "@/models/location-counts";
import type { Location } from "@/models/locations";
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

function location(
	id: string,
	parentId: string | null,
	ancestorIds: string[] = [],
): Location {
	return {
		id,
		title: id,
		parentId,
		ancestorIds,
		rank: "a0",
		icon: "home",
		color: "stone",
		createdAt: null,
		createdBy: "uid-a",
		updatedAt: null,
	};
}

describe("locationCounts", () => {
	const tree = [
		location("garden", null),
		location("shed", "garden", ["garden"]),
		location("basement", null),
		location("mancave", "basement", ["basement"]),
	];

	it("counts a card for the place it is filed in", () => {
		const pool = [
			node({ locationId: "shed", locationAncestorIds: ["garden"] }),
		];

		expect(locationCounts(pool, tree).get("shed")).toBe(1);
	});

	it("rolls a card up through every place above it", () => {
		const pool = [
			node({ locationId: "shed", locationAncestorIds: ["garden"] }),
		];

		expect(locationCounts(pool, tree).get("garden")).toBe(1);
	});

	it("rolls up from the tree, not the card's stored crumb", () => {
		// A crumb the card never carried (the seed's, or one a write
		// dropped) must not collapse the roll-up to the card's own place:
		// the human's case is one card in Basement plus two in Mancave
		// under it, and Basement says 3.
		const pool = [
			node({ id: "a", locationId: "basement", locationAncestorIds: [] }),
			node({ id: "b", locationId: "mancave", locationAncestorIds: [] }),
			node({ id: "c", locationId: "mancave", locationAncestorIds: [] }),
		];

		const counts = locationCounts(pool, tree);
		expect(counts.get("basement")).toBe(3);
		expect(counts.get("mancave")).toBe(2);
	});

	it("counts a card under the place its project passes down (#290)", () => {
		const project = node({
			id: "project",
			locationId: "shed",
			locationAncestorIds: ["garden"],
		});
		const step = node({ id: "step", ancestorIds: ["project"] });
		const pool = [project, step];

		const counts = locationCounts(pool, tree);
		expect(counts.get("shed")).toBe(2);
		expect(counts.get("garden")).toBe(2);
	});

	it("rolls a place whose count comes entirely from its children", () => {
		const pool = [
			node({ id: "a", locationId: "workshop" }),
			node({ id: "b", locationId: "boiler" }),
			node({ id: "c", locationId: "boiler" }),
		];

		expect(locationCounts(pool, tree).get("boiler")).toBe(2);
	});

	it("says nothing for a place with nothing under it", () => {
		const pool = [node({ locationId: "shed", locationAncestorIds: [] })];

		expect(locationCounts(pool, tree).has("attic")).toBe(false);
	});

	it("says nothing for a card filed nowhere", () => {
		const pool = [node({})];

		expect(locationCounts(pool, tree).size).toBe(0);
	});

	it("counts a place the list does not hold for itself alone", () => {
		const pool = [node({ locationId: "ghost", locationAncestorIds: [] })];

		const counts = locationCounts(pool, tree);
		expect(counts.get("ghost")).toBe(1);
		expect(counts.size).toBe(1);
	});

	it("counts a done parent's filing nothing — the pool is the open set", () => {
		// The pool pair carries open nodes; a crumb it does not hold
		// contributes nothing, so an open step under a *done* project is
		// unfiled as far as this count can know.
		const step = node({ id: "step", ancestorIds: ["done-project"] });

		expect(locationCounts([step], tree).size).toBe(0);
	});
});
