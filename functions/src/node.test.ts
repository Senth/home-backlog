import {
	childAncestorIds,
	completionChange,
	defaultColumns,
	movedAncestorIds,
	rankAfter,
	rankAtEnd,
	rankSequence,
	statuses,
} from "./node.js";

/**
 * The mirrored vocabulary and the rank arithmetic.
 *
 * `models/node.ts` states the same things for the app, and the enums are
 * deliberately duplicated — see the file's own note for why. What is *not*
 * duplicated is `fractional-indexing` itself: the digit alphabet, whose
 * character order is also its sort order, is a real shared dependency, because
 * that is the one thing a copy could not survive being wrong about.
 */

describe("ranking at the end of a column", () => {
	it("appends after the last rank", () => {
		const first = rankAtEnd(null);
		const second = rankAfter([first]);

		expect(second > first).toBe(true);
	});

	it("starts a column that has nothing in it", () => {
		expect(rankAfter([])).toBe(rankAtEnd(null));
	});

	it("keeps appending in order", () => {
		const ranks: string[] = [];
		for (let card = 0; card < 30; card++) ranks.push(rankAfter(ranks));

		expect([...ranks].sort()).toEqual(ranks);
	});

	/**
	 * `generateKeyBetween` validates the key it is handed and throws on one it
	 * did not produce — `"z0"` is not a valid order key. Unhandled, that turns
	 * every create in the column into a 500 and makes the column permanently
	 * unwritable over the API, with nothing an agent could act on.
	 */
	it("steps over a stored rank the library will not accept", () => {
		const valid = rankAtEnd(null);

		expect(() => rankAtEnd("z0")).toThrow();
		expect(rankAfter([valid, "z0"])).toBe(rankAfter([valid]));
	});

	it("starts over when nothing in the column is usable", () => {
		expect(rankAfter(["z0", ""])).toBe(rankAtEnd(null));
	});
});

describe("a sequence of ranks", () => {
	it("comes back in order and does not grow a character per item", () => {
		const ranks = rankSequence(null, null, 40);

		expect([...ranks].sort()).toEqual(ranks);
		expect(Math.max(...ranks.map((rank) => rank.length))).toBeLessThan(5);
	});
});

describe("the frozen column set", () => {
	// It used to depend on depth, and stopped when #99 removed the three stage
	// columns. `models/node.ts` states the same set, and the two must not drift.
	it("is the whole status vocabulary, at every depth", () => {
		expect(defaultColumns).toEqual(["backlog", "next_up", "execution", "done"]);
		expect(defaultColumns).toEqual(statuses);
	});
});

describe("structure", () => {
	it("gives a root node no ancestors", () => {
		expect(childAncestorIds(null)).toEqual([]);
	});

	it("appends the parent to the parent's own path", () => {
		expect(childAncestorIds({ id: "step", ancestorIds: ["project"] })).toEqual([
			"project",
			"step",
		]);
	});

	/**
	 * A reparent moves a subtree whole and no descendant's `parentId` changes, so
	 * the rewrite is a splice at the point where the moved node appears. Get this
	 * wrong and a descendant's path points at a node it no longer sits under.
	 */
	it("splices a descendant's path at the moved node", () => {
		expect(
			movedAncestorIds(["old", "moved", "middle"], "moved", ["new", "home"]),
		).toEqual(["new", "home", "moved", "middle"]);
	});

	it("leaves a path that does not contain the moved node alone", () => {
		expect(movedAncestorIds(["a", "b"], "moved", ["new"])).toEqual(["a", "b"]);
	});
});

/**
 * A node already done and staying done keeps the date it has. Rewriting it on
 * every edit would make "completed" mean "last touched", which is the same
 * mistake as deriving it from `updatedAt`.
 */
describe("crossing done", () => {
	it("sets a date on the way in and clears it on the way out", () => {
		expect(completionChange("execution", "done")).toBe("set");
		expect(completionChange("done", "backlog")).toBe("clear");
	});

	it("leaves a finished node's date alone", () => {
		expect(completionChange("done", "done")).toBe("keep");
	});

	it("does nothing for a move that never touches done", () => {
		expect(completionChange("backlog", "execution")).toBe("keep");
	});
});
