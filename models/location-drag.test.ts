import { dropHint, dropTargetAt, moveFor } from "@/models/location-drag";
import {
	childLocations,
	compareLocations,
	type Location,
} from "@/models/locations";

function location(
	id: string,
	ancestorIds: string[] = [],
	rank = "a0",
): Location {
	return {
		id,
		title: id,
		parentId: ancestorIds.at(-1) ?? null,
		ancestorIds,
		rank,
		icon: "crosshairs-gps",
		color: "stone",
		createdAt: null,
		createdBy: "uid-a",
		updatedAt: null,
	};
}

// House → Garden → Shed, and a second root.
// Ranks are the ones `rankAtEnd` really writes — the `V`-integer form the
// base-62 digit set generates — not the opaque "a0" a fixture may spell.
const tree: Location[] = [
	location("house"),
	location("garden", ["house"], "V0"),
	location("shed", ["house", "garden"], "V0"),
	location("bench", ["house", "garden", "shed"], "V0"),
	location("cellar", ["house"], "V2"),
	location("attic"),
];

/** Rows as the tree renders them, one `space.md` (16) tall each at `y`. */
function rows(locations: Location[], y = (index: number) => index * 100) {
	return locations.map((location, index) => ({
		location,
		box: { left: 0, right: 400, top: y(index), bottom: y(index) + 100 },
	}));
}

const house = tree[0];
const garden = tree[1];
const shed = tree[2];

describe("dropTargetAt", () => {
	const list = rows([house, garden, shed]);

	it("reads the middle of a row as re-parenting into it", () => {
		const target = dropTargetAt(list, tree[5], { x: 200, y: 50 });

		expect(target).toEqual({ kind: "reparent", parent: house });
	});

	it("reads a row's top and bottom edges as reorder", () => {
		expect(dropTargetAt(list, tree[5], { x: 200, y: 8 })).toEqual({
			kind: "reorder",
			sibling: house,
			after: false,
		});
		expect(dropTargetAt(list, tree[5], { x: 200, y: 92 })).toEqual({
			kind: "reorder",
			sibling: house,
			after: true,
		});
	});

	it("reads a row's left band as an outdent", () => {
		// The garden's row: it has a parent, so there is a step to outdent to.
		expect(dropTargetAt(list, tree[5], { x: 8, y: 150 })).toEqual({
			kind: "outdent",
			target: garden,
		});
	});

	it("refuses a re-parent into the dragged place's own subtree", () => {
		expect(dropTargetAt(list, garden, { x: 200, y: 350 })).toBeNull();
	});

	it("refuses reordering against the dragged place or its subtree", () => {
		expect(dropTargetAt(list, garden, { x: 200, y: 308 })).toBeNull();
	});

	it("refuses an outdent off a root, and off the dragged place's own row", () => {
		// A root has no parent to outdent to.
		expect(dropTargetAt(list, tree[5], { x: 8, y: 50 })).toBeNull();
		// Outdenting off the dragged place itself is a no-op dressed as a move.
		expect(dropTargetAt(list, garden, { x: 8, y: 150 })).toBeNull();
	});

	it("answers nothing off every row", () => {
		expect(dropTargetAt(list, tree[5], { x: 200, y: 999 })).toBeNull();
	});
});

describe("dropHint", () => {
	it("highlights the row a re-parent drops into", () => {
		expect(dropHint({ kind: "reparent", parent: garden }, tree)).toEqual({
			kind: "highlight",
			id: "garden",
		});
	});

	it("draws the gap before the sibling a reorder lands above", () => {
		expect(
			dropHint({ kind: "reorder", sibling: house, after: false }, tree),
		).toEqual({ kind: "gap", beforeId: "house", afterId: null });
	});

	it("draws the gap after the sibling a reorder lands below", () => {
		expect(
			dropHint({ kind: "reorder", sibling: house, after: true }, tree),
		).toEqual({
			kind: "gap",
			beforeId: null,
			afterId: "house",
		});
	});

	it("draws an outdent after the target's parent, where it lands", () => {
		// Shed outdents to after garden, among the house's children.
		expect(dropHint({ kind: "outdent", target: shed }, tree)).toEqual({
			kind: "gap",
			beforeId: null,
			afterId: "garden",
		});
	});

	it("promises nothing for an outdent the plan would refuse", () => {
		// Garden's parent is the root house — one step shallower is the top
		// level, which `moveFor` refuses, so the tree must not draw a line.
		expect(dropHint({ kind: "outdent", target: garden }, tree)).toBeNull();
	});
});

describe("moveFor", () => {
	it("appends a re-parent at the end of the parent's children", () => {
		const plan = moveFor({ kind: "reparent", parent: garden }, tree[5], tree);

		expect(plan).not.toBeNull();
		expect(plan?.parent?.id).toBe("garden");
		expect(plan?.rank).toBe("V1");
	});

	it("lands a reorder between the neighbours it dropped between", () => {
		const plan = moveFor(
			{ kind: "reorder", sibling: garden, after: true },
			tree[5],
			tree,
		);

		expect(plan?.parent?.id).toBe("house");
		// Between garden (V0) and cellar (V2) — after the dragged place is
		// taken out of the arithmetic, which it never was in for this drop.
		expect(plan?.rank).toBe("V1");
	});

	it("takes the dragged place out of its own sibling set first", () => {
		// Shed dropped just before its older sibling garden: the neighbours are
		// read with shed itself out of the list.
		const plan = moveFor(
			{ kind: "reorder", sibling: garden, after: false },
			shed,
			tree,
		);

		expect(plan?.rank).toBe("Uz");
	});

	it("lands an outdent one step shallower, after the row's parent", () => {
		const plan = moveFor({ kind: "outdent", target: shed }, tree[5], tree);

		expect(plan?.parent?.id).toBe("house");
		// After garden among the house's children.
		expect(plan?.rank).toBe("V1");
	});

	it("writes nothing for a target the tree cannot resolve", () => {
		expect(
			moveFor(
				{ kind: "outdent", target: location("ghost", ["nowhere"]) },
				tree[5],
				tree,
			),
		).toBeNull();
	});

	it("sorts a parent's children the way the tree draws them", () => {
		const children = childLocations(tree, "house").sort(compareLocations);
		expect(children.map((location) => location.id)).toEqual([
			"garden",
			"cellar",
		]);
	});
});
