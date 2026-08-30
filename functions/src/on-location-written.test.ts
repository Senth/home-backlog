import { moveUpdate, pathChanged, unfiledNode } from "./on-location-written.js";

/**
 * The per-node decisions behind the location trigger.
 *
 * The trigger's wiring — the query, the batching, the timestamps — is not the
 * suite's business (see `jest.config.js`); these are the decisions it exists to
 * make. A node's `locationAncestorIds` ends with its own `locationId`, and the
 * rewrite has to keep it that way: that ending is what lets the board's shared
 * query roll a location up through one `array-contains`.
 */

describe("the move rewrite", () => {
	it("rewrites a node filed directly at the moved location", () => {
		expect(moveUpdate(["garden", "shed"], "shed", ["basement"])).toEqual({
			locationAncestorIds: ["basement", "shed"],
		});
	});

	it("keeps the tail of a node filed under a descendant of it", () => {
		expect(
			moveUpdate(["garden", "shed", "bench"], "shed", ["basement"]),
		).toEqual({ locationAncestorIds: ["basement", "shed", "bench"] });
	});

	it("takes a location back to the top", () => {
		expect(moveUpdate(["garden", "shed"], "shed", [])).toEqual({
			locationAncestorIds: ["shed"],
		});
	});

	it("leaves a path that does not contain the moved location alone", () => {
		expect(moveUpdate(["garden"], "shed", ["basement"])).toBeNull();
	});

	/**
	 * A cascade fires once per document and a move with descendants fires once
	 * per rewritten path; each firing is idempotent and they all end here —
	 * re-deriving the path the rewrite just wrote gives the same path back.
	 */
	it("ends in the same place when it fires twice", () => {
		const first = moveUpdate(["garden", "shed", "bench"], "shed", ["new"]);
		expect(moveUpdate(first.locationAncestorIds, "shed", ["new"])).toEqual(
			first,
		);
	});
});

describe("when a location write earns maintenance", () => {
	it("sees a move", () => {
		expect(pathChanged(["garden"], ["garden", "shed"])).toBe(true);
	});

	it("sees a move back to the top", () => {
		expect(pathChanged(["garden", "shed"], [])).toBe(true);
	});

	it("skips a rename", () => {
		expect(pathChanged(["garden", "shed"], ["garden", "shed"])).toBe(false);
	});

	it("skips a rank-only change", () => {
		expect(pathChanged(["garden"], ["garden"])).toBe(false);
	});
});

describe("the delete unfile", () => {
	it("leaves a node with no location and no path", () => {
		expect(unfiledNode).toEqual({
			locationId: null,
			locationAncestorIds: [],
		});
	});
});
