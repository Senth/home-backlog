import {
	filedUpdate,
	moveUpdate,
	pathChanged,
	unfiledNode,
} from "./on-location-written.js";

/**
 * The per-node decisions behind the location trigger.
 *
 * The trigger's wiring — the queries, the batching, the timestamps — is not
 * the suite's business (see `jest.config.js`); these are the decisions it
 * exists to make. A node's `locationAncestorIds` is exclusive of its own
 * `locationId` — filed at `Shed`, the crumb holds `Garden` and nothing of the
 * Shed — so a move reaches its nodes through two arms: the crumb for the ones
 * filed *under* the location, `locationId` for the ones filed *at* it. The
 * ending-is-own-location shape would be the inclusive one, and no writer
 * produces it.
 */

describe("the move rewrite of a node filed under the location", () => {
	it("splices the prefix of a descendant's crumb", () => {
		expect(
			moveUpdate(["garden", "shed", "bench"], "shed", ["basement"]),
		).toEqual({ locationAncestorIds: ["basement", "shed", "bench"] });
	});

	it("takes a location back to the top", () => {
		expect(moveUpdate(["garden", "shed", "bench"], "shed", [])).toEqual({
			locationAncestorIds: ["shed", "bench"],
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

describe("the move rewrite of a node filed at the location (#205)", () => {
	/**
	 * The crumb excludes the location itself, so a node filed at the moved
	 * place holds only the place's ancestors and the crumb query never sees
	 * it. The `locationId` arm is what repairs it — miss this arm and the
	 * place's own cards keep the old path, and the count and the tap-filter
	 * lie after every re-org.
	 */
	it("repairs a card filed at the moved location", () => {
		expect(filedUpdate("shed", "shed", ["basement"])).toEqual({
			locationAncestorIds: ["basement"],
		});
	});

	it("takes a filed-at card back to the top", () => {
		expect(filedUpdate("shed", "shed", [])).toEqual({
			locationAncestorIds: [],
		});
	});

	it("leaves a card filed somewhere else alone", () => {
		expect(filedUpdate("garden", "shed", ["basement"])).toBeNull();
	});

	it("leaves an unfiled card alone", () => {
		expect(filedUpdate(null, "shed", ["basement"])).toBeNull();
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
