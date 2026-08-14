import type { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";
import {
	childAncestorIds,
	columnsForDepth,
	compareNodes,
	completionChange,
	fullColumns,
	mergeNodeResults,
	movedAncestorIds,
	type Node,
	newNodeData,
	rankAtEnd,
	rankBetween,
	rankSequence,
	rootColumns,
	simpleColumns,
	titleError,
	toNode,
	visibleColumns,
} from "@/models/node";

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
		visibility: "shared",
		columns: [...fullColumns],
		dueDate: null,
		priority: null,
		blockedBy: [],
		notes: "",
		checklist: [],
		effort: null,
		photos: [],
		archived: false,
		completedAt: null,
		createdAt: null,
		createdBy: "uid-a",
		updatedAt: null,
		...overrides,
	};
}

/** A snapshot with only the fields a test names — everything else absent. */
function snapshot(
	id: string,
	data: Record<string, unknown>,
): QueryDocumentSnapshot<DocumentData> {
	return {
		id,
		data: () => data,
	} as unknown as QueryDocumentSnapshot<DocumentData>;
}

describe("rank", () => {
	/**
	 * The whole reason `rank` is a string. If this ever stops holding, cards
	 * reorder themselves on other people's screens.
	 */
	it("puts a new key strictly between its neighbours", () => {
		const first = rankBetween(null, null);
		const second = rankAtEnd(first);
		const middle = rankBetween(first, second);

		expect(first < middle).toBe(true);
		expect(middle < second).toBe(true);
	});

	it("survives repeated midpoint inserts at the same spot", () => {
		// Around fifty of these exhaust double precision if rank is a float,
		// which is why it is not. A fractional key just grows a character.
		let low = rankBetween(null, null);
		const high = rankAtEnd(low);

		for (let index = 0; index < 60; index += 1) {
			const next = rankBetween(low, high);
			expect(low < next).toBe(true);
			expect(next < high).toBe(true);
			low = next;
		}
	});

	it("appends at the end of a column", () => {
		const first = rankAtEnd(null);
		const second = rankAtEnd(first);

		expect(first < second).toBe(true);
	});

	it("generates a whole sequence in order, for a bulk create", () => {
		const keys = rankSequence(null, null, 5);

		expect(keys).toHaveLength(5);
		expect([...keys].sort()).toEqual(keys);
	});
});

describe("compareNodes", () => {
	it("orders by rank", () => {
		const a = node({ id: "b", rank: "a0" });
		const b = node({ id: "a", rank: "a1" });

		expect([b, a].sort(compareNodes)).toEqual([a, b]);
	});

	/**
	 * Two people offline can produce the same rank between the same neighbours.
	 * Without the id tiebreak the two devices draw the board in different
	 * orders, and neither is wrong.
	 */
	it("breaks a tied rank on the id, so every device agrees", () => {
		const first = node({ id: "aaa", rank: "a1" });
		const second = node({ id: "bbb", rank: "a1" });

		expect([second, first].sort(compareNodes)).toEqual([first, second]);
		expect([first, second].sort(compareNodes)).toEqual([first, second]);
	});
});

describe("mergeNodeResults", () => {
	/**
	 * A *shared* node I participate in matches both board queries. Drawing it
	 * twice is what this prevents — the dedupe is required, not defensive.
	 */
	it("keeps one copy of a node both queries returned", () => {
		const mine = node({ id: "shared-and-mine", rank: "a1" });

		const merged = mergeNodeResults([mine], [mine]);

		expect(merged).toEqual([mine]);
	});

	it("interleaves the two results by rank", () => {
		const first = node({ id: "one", rank: "a0" });
		const second = node({ id: "two", rank: "a1", visibility: "private" });
		const third = node({ id: "three", rank: "a2" });

		const merged = mergeNodeResults([first, third], [second]);

		expect(merged.map((item) => item.id)).toEqual(["one", "two", "three"]);
	});

	it("is empty for an empty board", () => {
		expect(mergeNodeResults([], [])).toEqual([]);
	});
});

describe("childAncestorIds", () => {
	it("is empty for a root node", () => {
		expect(childAncestorIds(null)).toEqual([]);
	});

	it("is the parent's path plus the parent, so the last element is parentId", () => {
		const parent = node({ id: "task", ancestorIds: ["project"] });

		expect(childAncestorIds(parent)).toEqual(["project", "task"]);
	});
});

describe("movedAncestorIds", () => {
	it("splices in the moved node's new path and keeps the rest", () => {
		const grandchild = node({
			id: "grandchild",
			parentId: "child",
			ancestorIds: ["old-home", "moved", "child"],
		});

		expect(movedAncestorIds(grandchild, "moved", ["new-home"])).toEqual([
			"new-home",
			"moved",
			"child",
		]);
	});

	it("moves a subtree to the root", () => {
		const child = node({
			id: "child",
			parentId: "moved",
			ancestorIds: ["old-home", "moved"],
		});

		expect(movedAncestorIds(child, "moved", [])).toEqual(["moved"]);
	});

	it("leaves a node that is not in the moved subtree alone", () => {
		const elsewhere = node({ id: "elsewhere", ancestorIds: ["other"] });

		expect(movedAncestorIds(elsewhere, "moved", ["new-home"])).toEqual([
			"other",
		]);
	});
});

describe("columnsForDepth", () => {
	/**
	 * `columns` describes the board a node's *children* form, so a depth-0 node's
	 * children are depth 1 — which `PROJECT.md` gives the full stage set.
	 */
	it("gives the full stage set to a root node's children", () => {
		expect(columnsForDepth(0)).toEqual(fullColumns);
	});

	it("gives the simple set to everything deeper", () => {
		expect(columnsForDepth(1)).toEqual(simpleColumns);
		expect(columnsForDepth(4)).toEqual(simpleColumns);
	});

	it("gives the root board the full stage set too", () => {
		expect(rootColumns).toEqual(fullColumns);
	});

	it("keeps the simple set to statuses the full set also has", () => {
		// The deep-board set reads To do / In progress / Done with no per-board
		// relabel only because these three are ordinary statuses.
		expect(fullColumns).toEqual(expect.arrayContaining([...simpleColumns]));
	});
});

describe("visibleColumns", () => {
	it("is the frozen set when nothing sits outside it", () => {
		const nodes = [node({ id: "a", status: "backlog" })];

		expect(visibleColumns(simpleColumns, nodes)).toEqual([...simpleColumns]);
	});

	/**
	 * `Move under…`, the REST API and a seeded fixture can each put a `research`
	 * card on a simple-set board. A card that exists is visible somewhere.
	 */
	it("appends a column for a status present in the data but not in the set", () => {
		const nodes = [
			node({ id: "a", status: "backlog" }),
			node({ id: "b", status: "research" }),
		];

		expect(visibleColumns(simpleColumns, nodes)).toEqual([
			"backlog",
			"execution",
			"done",
			"research",
		]);
	});

	it("appends the extras in enum order, however the cards are ordered", () => {
		const nodes = [
			node({ id: "a", status: "review" }),
			node({ id: "b", status: "next_up" }),
		];

		expect(visibleColumns(simpleColumns, nodes)).toEqual([
			"backlog",
			"execution",
			"done",
			"next_up",
			"review",
		]);
	});

	it("drops the extra column again once the card leaves it", () => {
		expect(visibleColumns(simpleColumns, [])).toEqual([...simpleColumns]);
	});

	it("does not duplicate a column the set already has", () => {
		const nodes = [node({ id: "a", status: "execution" })];

		expect(visibleColumns(simpleColumns, nodes)).toEqual([...simpleColumns]);
	});
});

describe("titleError", () => {
	it("refuses a title that is empty or only spaces", () => {
		expect(titleError("")).toBe("board.titleRequired");
		expect(titleError("   ")).toBe("board.titleRequired");
	});

	it("refuses one the rules would refuse", () => {
		expect(titleError("x".repeat(201))).toBe("board.titleTooLong");
		expect(titleError("x".repeat(200))).toBeNull();
	});

	it("measures the trimmed title, which is what gets written", () => {
		expect(titleError(`  ${"x".repeat(200)}  `)).toBeNull();
	});
});

describe("completionChange", () => {
	it.each([
		["backlog", "done", "set"],
		["done", "backlog", "clear"],
		// The date a thing was finished on must not become the date it was last
		// edited — that is the mistake deriving it from updatedAt would make.
		["done", "done", "keep"],
		["backlog", "execution", "keep"],
	] as const)("%s -> %s is %s", (current, next, expected) => {
		expect(completionChange(current, next)).toBe(expected);
	});
});

describe("newNodeData", () => {
	it("writes every field, so none of them is absent from the index later", () => {
		const data = newNodeData({ title: "  Paint the shed  ", rank: "a0" });

		expect(data).toEqual({
			title: "Paint the shed",
			status: "backlog",
			rank: "a0",
			parentId: null,
			ancestorIds: [],
			locationId: null,
			locationAncestorIds: [],
			participantIds: [],
			visibility: "shared",
			columns: [...fullColumns],
			dueDate: null,
			priority: null,
			blockedBy: [],
			notes: "",
			checklist: [],
			effort: null,
			photos: [],
			archived: false,
		});
	});

	/**
	 * The new node's *own* depth, not its parent's: `columns` describes the board
	 * its children will form, and a task created inside a project is the thing
	 * whose children get the simple set.
	 */
	it("freezes the column set from the new node's own depth", () => {
		const project = node({ id: "project", ancestorIds: [] });
		const task = node({
			id: "task",
			parentId: "project",
			ancestorIds: ["project"],
		});

		expect(newNodeData({ title: "Project", rank: "a0" }).columns).toEqual([
			...fullColumns,
		]);
		expect(
			newNodeData({ title: "Task", rank: "a0", parent: project }).columns,
		).toEqual([...simpleColumns]);
		expect(
			newNodeData({ title: "Subtask", rank: "a0", parent: task }).columns,
		).toEqual([...simpleColumns]);
	});

	it("inherits the parent's structure and location", () => {
		const parent = node({
			id: "project",
			ancestorIds: [],
			locationId: "basement",
			locationAncestorIds: ["inside", "basement"],
		});

		const data = newNodeData({ title: "Task", rank: "a0", parent });

		expect(data.parentId).toBe("project");
		expect(data.ancestorIds).toEqual(["project"]);
		expect(data.locationId).toBe("basement");
		expect(data.locationAncestorIds).toEqual(["inside", "basement"]);
	});

	it("lets a child sit in a different room from its parent", () => {
		const parent = node({ id: "project", locationId: "basement" });

		const data = newNodeData({
			title: "Task",
			rank: "a0",
			parent,
			locationId: "attic",
			locationAncestorIds: ["inside", "attic"],
		});

		expect(data.locationId).toBe("attic");
		expect(data.locationAncestorIds).toEqual(["inside", "attic"]);
	});

	/**
	 * The invariant that keeps a subtree readable in one query. A caller who got
	 * this wrong would be refused by the rules; upholding it by construction is
	 * what stops anyone having to remember.
	 */
	it("takes the parent's visibility, whatever the caller asked for", () => {
		const parent = node({
			id: "surprise",
			visibility: "private",
			participantIds: ["uid-a"],
		});

		const data = newNodeData({
			title: "Order the cake",
			rank: "a0",
			parent,
			visibility: "shared",
		});

		expect(data.visibility).toBe("private");
	});

	it("honours the caller's visibility only at the root", () => {
		const data = newNodeData({
			title: "Celebration",
			rank: "a0",
			visibility: "private",
			participantIds: ["uid-a"],
		});

		expect(data.visibility).toBe("private");
		expect(data.participantIds).toEqual(["uid-a"]);
	});

	it("carries a private parent's participants down, without duplicating them", () => {
		const parent = node({
			id: "surprise",
			visibility: "private",
			participantIds: ["uid-a", "uid-b"],
		});

		const data = newNodeData({
			title: "Order the cake",
			rank: "a0",
			parent,
			participantIds: ["uid-b", "uid-c"],
		});

		expect(data.participantIds).toEqual(["uid-a", "uid-b", "uid-c"]);
	});

	it("does not inherit participants from a shared parent", () => {
		const parent = node({ id: "project", participantIds: ["uid-a"] });

		const data = newNodeData({ title: "Task", rank: "a0", parent });

		expect(data.participantIds).toEqual([]);
	});
});

describe("toNode", () => {
	it("reads a document that is missing every optional field", () => {
		const result = toNode(snapshot("node-9", { title: "Bare" }));

		expect(result).toEqual(
			node({
				id: "node-9",
				title: "Bare",
				rank: "",
				createdBy: "",
			}),
		);
	});

	it("keeps a value outside its enum from becoming that value", () => {
		const result = toNode(
			snapshot("node-9", {
				status: "invented",
				priority: "critical",
				effort: "a fortnight",
			}),
		);

		expect(result.status).toBe("backlog");
		expect(result.priority).toBeNull();
		expect(result.effort).toBeNull();
	});

	it("reads the full document back unchanged", () => {
		const result = toNode(
			snapshot("node-9", {
				title: "Fix the gutter",
				status: "execution",
				rank: "a1",
				parentId: "project",
				ancestorIds: ["project"],
				locationId: "roof",
				locationAncestorIds: ["outside", "roof"],
				participantIds: ["uid-a"],
				visibility: "private",
				columns: [...simpleColumns],
				dueDate: "2026-09-30",
				priority: "high",
				blockedBy: ["scaffolding"],
				notes: "Ladder is in the shed",
				checklist: [{ id: "c1", text: "Buy brackets", done: true }],
				effort: "evening",
				photos: [
					{
						id: "p1",
						path: "homes/home-1/nodes/node-9/p1.jpg",
						uploadedAt: null,
						uploadedBy: "uid-a",
					},
				],
				archived: true,
			}),
		);

		expect(result).toEqual(
			node({
				id: "node-9",
				title: "Fix the gutter",
				status: "execution",
				rank: "a1",
				parentId: "project",
				ancestorIds: ["project"],
				locationId: "roof",
				locationAncestorIds: ["outside", "roof"],
				participantIds: ["uid-a"],
				visibility: "private",
				columns: [...simpleColumns],
				dueDate: "2026-09-30",
				priority: "high",
				blockedBy: ["scaffolding"],
				notes: "Ladder is in the shed",
				checklist: [{ id: "c1", text: "Buy brackets", done: true }],
				effort: "evening",
				photos: [
					{
						id: "p1",
						path: "homes/home-1/nodes/node-9/p1.jpg",
						uploadedAt: null,
						uploadedBy: "uid-a",
					},
				],
				archived: true,
				createdBy: "",
			}),
		);
	});

	/**
	 * `columns` arrived after the document did, so every node written by #74 is
	 * without one — and a board with no columns renders nothing at all.
	 */
	it("falls back to the depth default when columns is absent", () => {
		expect(toNode(snapshot("node-9", {})).columns).toEqual([...fullColumns]);
		expect(
			toNode(snapshot("node-9", { ancestorIds: ["project"] })).columns,
		).toEqual([...simpleColumns]);
	});

	it("drops a column value nothing could ever be moved to", () => {
		expect(
			toNode(snapshot("node-9", { columns: ["backlog", "blocked", "done"] }))
				.columns,
		).toEqual(["backlog", "done"]);
		// All of them unknown is the same as none at all.
		expect(
			toNode(snapshot("node-9", { columns: ["blocked"] })).columns,
		).toEqual([...fullColumns]);
	});

	it("does not read a private node as shared by accident", () => {
		// A missing visibility is the only coercion here that could widen
		// anything, and it lands on the side the rules already denied.
		expect(toNode(snapshot("node-9", {})).visibility).toBe("shared");
		expect(
			toNode(snapshot("node-9", { visibility: "private" })).visibility,
		).toBe("private");
	});
});
