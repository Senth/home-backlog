import { allBlockersDone, leadBlocker, orderBlockers } from "@/models/blockers";
import { defaultColumns, type Node } from "@/models/node";

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

describe("orderBlockers", () => {
	const urgent = node({
		id: "urgent",
		title: "Stop the leak",
		status: "execution",
		priority: "urgent",
	});
	const high = node({
		id: "high",
		title: "Order tiles",
		status: "execution",
		priority: "high",
	});
	const plain = node({ id: "plain", title: "Sweep the porch" });
	const plain2 = node({ id: "plain2", title: "Water the hedge" });
	const done = node({
		id: "done",
		title: "Done thing",
		status: "done",
		priority: "urgent",
	});
	const reads = new Map<string, Node | null>([
		["urgent", urgent],
		["high", high],
		["plain", plain],
		["plain2", plain2],
		["done", done],
		["gone", null],
	]);

	it("puts the not-done blockers first, done ones last", () => {
		const ordered = orderBlockers(["done", "plain", "urgent"], reads);

		expect(ordered.map((blocker) => blocker.id)).toEqual([
			"urgent",
			"plain",
			"done",
		]);
	});

	it("sorts the not-done ones by priority, highest first", () => {
		const ordered = orderBlockers(["plain", "high", "urgent"], reads);

		expect(ordered.map((blocker) => blocker.id)).toEqual([
			"urgent",
			"high",
			"plain",
		]);
	});

	/**
	 * The stored order is the household's own, and a tie on priority is not
	 * this function's to reorder. `Array#sort`'s stability is what carries it.
	 */
	it("keeps the stored order for blockers of equal priority", () => {
		expect(orderBlockers(["plain2", "plain"], reads).map((b) => b.id)).toEqual([
			"plain2",
			"plain",
		]);
		expect(orderBlockers(["plain", "plain2"], reads).map((b) => b.id)).toEqual([
			"plain",
			"plain2",
		]);
	});

	it("drops a blocker the map cannot answer, gone or unread", () => {
		const ordered = orderBlockers(["gone", "missing", "plain"], reads);

		expect(ordered.map((blocker) => blocker.id)).toEqual(["plain"]);
	});

	it("is empty when nothing resolves", () => {
		expect(orderBlockers(["gone", "missing"], reads)).toEqual([]);
		expect(orderBlockers([], reads)).toEqual([]);
	});
});

describe("leadBlocker", () => {
	const reads = new Map<string, Node | null>([
		[
			"plumber",
			node({
				id: "plumber",
				title: "Book the plumber",
				status: "execution",
				priority: "high",
			}),
		],
		["sweep", node({ id: "sweep", title: "Book the chimney sweep" })],
		["plain", node({ id: "plain", title: "Sweep the porch" })],
		["gone", null],
	]);

	it("is the first of the ordered blockers", () => {
		expect(leadBlocker(["sweep", "plumber"], reads)?.id).toBe("plumber");
	});

	it("falls back to the stored order on an equal priority", () => {
		expect(leadBlocker(["sweep", "plain"], reads)?.id).toBe("sweep");
		expect(leadBlocker(["plain", "sweep"], reads)?.id).toBe("plain");
	});

	it("is null when the list resolves to nothing", () => {
		expect(leadBlocker(["gone"], reads)).toBeNull();
		expect(leadBlocker(["gone"], new Map())).toBeNull();
		expect(leadBlocker([], reads)).toBeNull();
	});
});

describe("allBlockersDone", () => {
	const reads = new Map<string, Node | null>([
		["done-1", node({ id: "done-1", status: "done" })],
		["done-2", node({ id: "done-2", status: "done" })],
		["open", node({ id: "open", status: "execution" })],
		["gone", null],
	]);

	it("is true when every blocker read is done", () => {
		expect(allBlockersDone(["done-1", "done-2"], reads)).toBe(true);
	});

	it("is false while any blocker is still open", () => {
		expect(allBlockersDone(["done-1", "open"], reads)).toBe(false);
	});

	/**
	 * *"All done" must never be said about a card nobody could read.* Offline,
	 * or the blocker deleted by somebody else — either way the answer is the
	 * honest not-yet.
	 */
	it("is false when an id is missing from the reads or resolved to null", () => {
		expect(allBlockersDone(["done-1", "unread"], reads)).toBe(false);
		expect(allBlockersDone(["done-1", "gone"], reads)).toBe(false);
	});

	it("is false for a card waiting on nothing", () => {
		// Not the resolved state — simply not waiting. The row that uses this
		// shows nothing rather than a ✓ over zero blockers.
		expect(allBlockersDone([], reads)).toBe(false);
	});
});
