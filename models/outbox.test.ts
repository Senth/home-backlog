import type { Location } from "@/models/locations";
import {
	classifyReplayError,
	enqueue,
	hiddenNodeIds,
	type Intent,
	pendingFlip,
	projectLocations,
	removeIntent,
	waitingCountFor,
} from "@/models/outbox";

const metadata = {
	homeId: "home",
	queuedAt: 1,
	title: "Subject",
	sourceParentId: null,
	sourceAncestorIds: [],
};
function move(
	id: string,
	overrides: Partial<Extract<Intent, { kind: "reparentNode" }>> = {},
): Intent {
	return {
		...metadata,
		id,
		kind: "reparentNode",
		nodeId: "node",
		parentId: "target",
		rank: "a1",
		...overrides,
	};
}
function place(
	id: string,
	parentId: string | null = null,
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
		updatedAt: null,
		createdBy: "uid",
	};
}
function locationMove(
	id: string,
	locationId: string,
	parentId: string | null,
): Intent {
	return {
		...metadata,
		id,
		kind: "moveLocation",
		locationId,
		parentId,
		rank: "a2",
	};
}
const flip: Intent = {
	...metadata,
	id: "flip",
	kind: "flipVisibility",
	nodeId: "node",
	target: "private",
	participantIds: ["uid"],
};

describe("enqueue", () => {
	it("replaces node moves in their FIFO slot without changing input", () => {
		const queue = [move("first"), move("other", { nodeId: "other" })];
		const replacement = move("last", { parentId: "elsewhere", rank: "a9" });
		expect(enqueue(queue, replacement)).toEqual([replacement, queue[1]]);
		expect(queue[0].id).toBe("first");
	});
	it("replaces location moves and flips, keeping chosen participants", () => {
		const replacement = locationMove("second", "room", null);
		expect(
			enqueue([locationMove("first", "room", "floor")], replacement),
		).toEqual([replacement]);
		const next: Intent = { ...flip, id: "next", target: "shared" };
		expect(enqueue([flip], next)).toEqual([next]);
	});
	it("keeps distinct subjects, homes, trees and kinds", () => {
		const queue = [
			move("first"),
			move("away", { homeId: "other" }),
			locationMove("place", "node", null),
			flip,
		];
		expect(enqueue(queue, move("second", { nodeId: "new" }))).toHaveLength(5);
		expect(enqueue(queue, move("last"))).toEqual([
			move("last"),
			...queue.slice(1),
		]);
	});
	it("node delete removes subject and subtree moves, flips and redundant deletes only", () => {
		const child = move("child", {
			nodeId: "child",
			sourceAncestorIds: ["node"],
		});
		const childFlip: Intent = {
			...flip,
			id: "child-flip",
			nodeId: "child",
			sourceAncestorIds: ["node"],
		};
		const deletion: Intent = {
			...metadata,
			id: "delete",
			kind: "deleteNode",
			nodeId: "node",
		};
		const unrelated = move("other", { nodeId: "other" });
		const foreign = move("foreign", { homeId: "other" });
		const location = locationMove("location", "node", null);
		expect(
			enqueue(
				[
					move("move"),
					flip,
					child,
					childFlip,
					{ ...deletion, id: "old" },
					unrelated,
					foreign,
					location,
				],
				deletion,
			),
		).toEqual([unrelated, foreign, location, deletion]);
	});
	it("location delete removes subtree moves while keeping node intents", () => {
		const deletion: Intent = {
			...metadata,
			id: "delete",
			kind: "deleteLocation",
			locationId: "floor",
		};
		const child: Intent = {
			...locationMove("child", "room", null),
			sourceAncestorIds: ["floor"],
		};
		expect(
			enqueue(
				[locationMove("floor", "floor", null), child, move("node")],
				deletion,
			),
		).toEqual([move("node"), deletion]);
	});
	it("appends offline-created subjects and removes only the Undo id", () => {
		const queue = enqueue([flip], move("new", { nodeId: "offline-created" }));
		expect(queue.map((intent) => intent.id)).toEqual(["flip", "new"]);
		expect(removeIntent(queue, "new")).toEqual([flip]);
		expect(removeIntent(queue, "missing")).toEqual(queue);
	});
});

describe("projectLocations", () => {
	const locations = [
		place("old"),
		place("new"),
		place("room", "old", ["old"]),
		place("shelf", "room", ["old", "room"]),
		place("box", "shelf", ["old", "room", "shelf"]),
	];
	it("moves a nested subtree, preserves descendant rank and parent, and leaves input untouched", () => {
		const result = projectLocations(
			locations,
			[locationMove("move", "room", "new")],
			"home",
		);
		expect(result.locations[2]).toMatchObject({
			parentId: "new",
			ancestorIds: ["new"],
			rank: "a2",
		});
		expect(result.locations[3]).toMatchObject({
			parentId: "room",
			ancestorIds: ["new", "room"],
			rank: "a0",
		});
		expect(result.locations[4].ancestorIds).toEqual(["new", "room", "shelf"]);
		expect(result.waitingIds).toEqual(new Set(["room"]));
		expect(locations[2].parentId).toBe("old");
	});
	it("moves to root and projects successive moves against the projected tree", () => {
		const result = projectLocations(
			locations,
			[
				locationMove("first", "room", null),
				locationMove("second", "new", "room"),
			],
			"home",
		);
		expect(result.locations[2].ancestorIds).toEqual([]);
		expect(result.locations[1].ancestorIds).toEqual(["room"]);
	});
	it.each(["shelf", "room", "missing"])(
		"leaves invalid target %s unprojected but waiting",
		(target) => {
			const result = projectLocations(
				locations,
				[locationMove("move", "room", target)],
				"home",
			);
			expect(result.locations).toEqual(locations);
			expect(result.waitingIds).toEqual(new Set(["room"]));
		},
	);
	it("refuses a cycle introduced by an earlier projected move", () => {
		const result = projectLocations(
			locations,
			[
				locationMove("first", "new", "room"),
				locationMove("second", "room", "new"),
			],
			"home",
		);
		expect(result.locations[2].parentId).toBe("old");
	});
	it("deletes the current subtree and clears deleted waiting markers", () => {
		const deletion: Intent = {
			...metadata,
			id: "delete",
			kind: "deleteLocation",
			locationId: "room",
		};
		const result = projectLocations(
			locations,
			[locationMove("move", "room", "new"), deletion],
			"home",
		);
		expect(result.locations.map((location) => location.id)).toEqual([
			"old",
			"new",
		]);
		expect(result.waitingIds.size).toBe(0);
	});
	it("ignores other homes, node intents and missing subjects", () => {
		const result = projectLocations(
			locations,
			[
				{ ...locationMove("foreign", "room", null), homeId: "other" },
				move("node"),
				locationMove("gone", "missing", null),
			],
			"home",
		);
		expect(result.locations).toEqual(locations);
		expect(result.waitingIds.size).toBe(0);
	});
});

describe("node markers", () => {
	const deletion: Intent = {
		...metadata,
		id: "delete",
		kind: "deleteNode",
		nodeId: "child",
		sourceParentId: "node",
	};
	it("hides deletes and moves away, not reorder-only moves or flips", () => {
		expect(
			hiddenNodeIds(
				[
					move("move"),
					deletion,
					flip,
					move("same", { nodeId: "same", parentId: null }),
					move("foreign", { homeId: "other", nodeId: "foreign" }),
				],
				"home",
			),
		).toEqual(new Set(["node", "child"]));
	});
	it("counts incoming moves, direct-child deletes and own flip only", () => {
		const intents = [
			move("incoming", { parentId: "node", nodeId: "incoming" }),
			deletion,
			flip,
			move("outgoing"),
			{ ...deletion, id: "grandchild", sourceParentId: "child" },
			{ ...flip, id: "foreign", homeId: "other" },
			locationMove("place", "room", "node"),
		];
		expect(waitingCountFor("node", intents, "home")).toBe(3);
		expect(waitingCountFor("absent", intents, "home")).toBe(0);
	});
	it("returns latest pending flip target without projecting it", () => {
		expect(
			pendingFlip("node", [flip, { ...flip, id: "later", target: "shared" }]),
		).toBe("shared");
		expect(pendingFlip("other", [flip])).toBeNull();
	});
});

describe("classifyReplayError", () => {
	it.each([
		[{ code: "unavailable" }, "retry"],
		[new TypeError("Failed to fetch"), "retry"],
		[new TypeError("Network request failed"), "retry"],
		[new TypeError("Load failed"), "retry"],
		[{ code: "subject-not-found" }, "drop"],
		[{ code: "already-at-target" }, "drop"],
		[{ code: "move-own-subtree" }, { refused: "error.moveOwnSubtree" }],
		[{ code: "move-visibility" }, { refused: "error.moveVisibility" }],
		[{ code: "subtree-too-large" }, { refused: "error.subtreeTooLarge" }],
		[{ code: "target-not-found" }, { refused: "error.saveFailed" }],
		[{ code: "permission-denied" }, { refused: "error.saveFailed" }],
		[new TypeError("Programming error"), { refused: "error.saveFailed" }],
		[null, { refused: "error.saveFailed" }],
		["unknown", { refused: "error.saveFailed" }],
	])("maps %p to %p", (reason, expected) => {
		expect(classifyReplayError(reason)).toEqual(expected);
	});
});
