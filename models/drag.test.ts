import {
	columnAt,
	dropPlan,
	edgeAt,
	landingSlot,
	type StatusBox,
} from "@/models/drag";
import type { Node, Status } from "@/models/node";

function card(id: string, rank: string, status: Status = "backlog"): Node {
	return {
		id,
		title: id,
		status,
		rank,
		parentId: null,
		ancestorIds: [],
		locationId: null,
		locationAncestorIds: [],
		notes: "",
		dueDate: null,
		priority: null,
		effort: null,
		visibility: "shared",
		participantIds: [],
		assigneeIds: [],
		blockedBy: [],
		checklist: [],
		photos: [],
		childCount: 0,
		doneCount: 0,
		columns: [],
		archived: false,
		createdVia: "app",
		createdAt: null,
		createdBy: "uid-a",
		updatedAt: null,
		completedAt: null,
	};
}

/** A column of three, `a` above `b` above `c`. */
const a = card("a", "V0");
const b = card("b", "V1");
const c = card("c", "V2");
const column = [a, b, c];

/**
 * A rank is a string, and Jest's ordering matchers refuse one — so the check is
 * that the three sort into the order they were written in.
 */
function ordered(...ranks: (string | undefined)[]): boolean {
	return ranks.every((rank, at) => {
		const before = at === 0 ? undefined : ranks[at - 1];
		return rank !== undefined && (before === undefined || before < rank);
	});
}

describe("dropPlan", () => {
	it("puts a card at the top of its own column", () => {
		const plan = dropPlan({
			column,
			dragged: c,
			toStatus: "backlog",
			toIndex: 0,
		});

		expect(plan?.status).toBe("backlog");
		expect(plan?.direction).toBe("up");
		expect(ordered(plan?.rank, a.rank)).toBe(true);
	});

	it("puts a card at the bottom of its own column", () => {
		const plan = dropPlan({
			column,
			dragged: a,
			toStatus: "backlog",
			toIndex: 2,
		});

		expect(plan?.direction).toBe("down");
		expect(ordered(c.rank, plan?.rank)).toBe(true);
	});

	it("puts a card in the middle of its own column", () => {
		const plan = dropPlan({
			column,
			dragged: a,
			toStatus: "backlog",
			toIndex: 1,
		});

		expect(ordered(b.rank, plan?.rank, c.rank)).toBe(true);
	});

	it("never ranks a card against where it currently is", () => {
		// Slot 1 of `[a, c]` — `b` itself is not one of its own neighbours, so the
		// rank lands between a and c rather than between b and c.
		const plan = dropPlan({
			column,
			dragged: b,
			toStatus: "backlog",
			toIndex: 1,
		});

		// It did not move: a above, c below, which is where it already was.
		expect(plan).toBeNull();
	});

	it("takes the destination column's neighbours when the status changes", () => {
		const first = card("x", "V5", "done");
		const second = card("y", "V6", "done");

		const plan = dropPlan({
			column: [first, second],
			dragged: a,
			toStatus: "done",
			toIndex: 1,
		});

		expect(plan?.status).toBe("done");
		expect(plan?.direction).toBe("across");
		expect(ordered(first.rank, plan?.rank, second.rank)).toBe(true);
	});

	it("writes nothing for a card released in the slot it came from", () => {
		expect(
			dropPlan({ column, dragged: b, toStatus: "backlog", toIndex: 1 }),
		).toBeNull();
	});

	it("writes nothing for the last card dropped past the end of its column", () => {
		// Every slot below the last one is the slot the card is already in.
		expect(
			dropPlan({ column, dragged: c, toStatus: "backlog", toIndex: 9 }),
		).toBeNull();
	});

	it("drops into an empty column", () => {
		const plan = dropPlan({
			column: [],
			dragged: a,
			toStatus: "execution",
			toIndex: 0,
		});

		expect(plan).toEqual({
			status: "execution",
			rank: expect.any(String),
			direction: "across",
		});
	});

	it("ranks against the cards you can see, not the ones the filter is hiding", () => {
		// `b` is somebody else's personal project and is not on screen. Dropping
		// between a and c therefore lands between *their* ranks, and b keeps its
		// own wherever it falls.
		const visible = [a, c];
		const plan = dropPlan({
			column: visible,
			dragged: card("d", "V9"),
			toStatus: "backlog",
			toIndex: 1,
		});

		expect(ordered(a.rank, plan?.rank, c.rank)).toBe(true);
	});

	it("lands after a tied run rather than asking for a key that cannot exist", () => {
		// Two people offline produced the same rank between the same neighbours.
		const tiedFirst = card("t1", "V1");
		const tiedSecond = card("t2", "V1");
		const last = card("t3", "V2");

		const plan = dropPlan({
			column: [tiedFirst, tiedSecond, last],
			dragged: card("d", "V0"),
			toStatus: "backlog",
			toIndex: 1,
		});

		expect(ordered("V1", plan?.rank, last.rank)).toBe(true);
	});

	it("appends past a tied run sitting at the end of a column", () => {
		// Nothing below the tie to rank against, so the card goes after both.
		const tiedFirst = card("t1", "V1");
		const tiedSecond = card("t2", "V1");

		const plan = dropPlan({
			column: [tiedFirst, tiedSecond],
			dragged: card("d", "V0"),
			toStatus: "backlog",
			toIndex: 1,
		});

		expect(ordered("V1", plan?.rank)).toBe(true);
	});

	it("says which way the card went", () => {
		expect(
			dropPlan({ column, dragged: c, toStatus: "backlog", toIndex: 0 })
				?.direction,
		).toBe("up");
		expect(
			dropPlan({ column, dragged: a, toStatus: "backlog", toIndex: 2 })
				?.direction,
		).toBe("down");
		expect(
			dropPlan({ column, dragged: a, toStatus: "done", toIndex: 0 })?.direction,
		).toBe("across");
	});
});

describe("columnAt", () => {
	const columns: StatusBox[] = [
		{ status: "backlog", left: 0, right: 100, top: 0, bottom: 400 },
		{ status: "next_up", left: 100, right: 200, top: 0, bottom: 400 },
	];

	it("finds the column under the point", () => {
		expect(columnAt(columns, 150, 200)?.status).toBe("next_up");
	});

	it("takes the left edge and leaves the right one to the next column", () => {
		expect(columnAt(columns, 100, 10)?.status).toBe("next_up");
		expect(columnAt(columns, 99, 10)?.status).toBe("backlog");
	});

	it("is null outside every column", () => {
		expect(columnAt(columns, 250, 200)).toBeNull();
		expect(columnAt(columns, 50, 500)).toBeNull();
	});
});

describe("landingSlot", () => {
	const cards = [
		{ top: 0, bottom: 100, left: 0, right: 100 },
		{ top: 100, bottom: 200, left: 0, right: 100 },
	];

	it("lands above every card", () => {
		expect(landingSlot(cards, 10)).toBe(0);
	});

	it("passes a card once the point is beyond its middle", () => {
		expect(landingSlot(cards, 49)).toBe(0);
		expect(landingSlot(cards, 51)).toBe(1);
	});

	it("lands below every card", () => {
		expect(landingSlot(cards, 400)).toBe(2);
	});

	it("lands at the top of an empty column", () => {
		expect(landingSlot([], 400)).toBe(0);
	});
});

describe("edgeAt", () => {
	const board = { left: 0, right: 390, top: 0, bottom: 800 };

	it("names the edge the finger is resting in", () => {
		expect(edgeAt(board, 10, 400, 40)).toBe("left");
		expect(edgeAt(board, 380, 400, 40)).toBe("right");
	});

	it("is null in the middle", () => {
		expect(edgeAt(board, 195, 400, 40)).toBeNull();
	});

	it("is null outside the board", () => {
		expect(edgeAt(board, 400, 400, 40)).toBeNull();
		expect(edgeAt(board, 10, 900, 40)).toBeNull();
	});
});
