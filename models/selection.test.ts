import type { Status } from "@/models/node";
import {
	ordered,
	prune,
	range,
	type SelectionState,
	toggle,
} from "@/models/selection";

const empty: SelectionState = { status: null, ids: [], anchor: null };
const a = { id: "a", status: "backlog" as Status };
const b = { id: "b", status: "backlog" as Status };
const c = { id: "c", status: "backlog" as Status };
const d = { id: "d", status: "backlog" as Status };
const selected: SelectionState = {
	status: "backlog",
	ids: [b.id],
	anchor: b.id,
};

describe("selection", () => {
	it("sets the column on the first card and toggles without mutating state", () => {
		expect(toggle(empty, a)).toEqual({
			status: "backlog",
			ids: ["a"],
			anchor: "a",
		});
		expect(toggle(selected, c)).toEqual({
			status: "backlog",
			ids: ["b", "c"],
			anchor: "c",
		});
		expect(toggle(selected, b)).toEqual(empty);
		expect(selected.ids).toEqual(["b"]);
	});

	it("keeps the column when deselecting leaves other cards", () => {
		expect(
			toggle({ status: "backlog", ids: ["a", "b"], anchor: "b" }, b),
		).toEqual({ status: "backlog", ids: ["a"], anchor: "a" });
	});

	it.each([a, d])(
		"adds a range in either direction to $id, keeping the anchor",
		(card) => {
			const result = range(selected, card, [a, b, c, d]);
			expect(result?.ids).toEqual(card === a ? ["b", "a"] : ["b", "c", "d"]);
			expect(result?.anchor).toBe("b");
		},
	);

	it("skips hidden cards and does not duplicate existing picks", () => {
		expect(range(selected, d, [b, d])?.ids).toEqual(["b", "d"]);
		expect(
			range({ ...selected, ids: ["b", "c"] }, d, [a, b, c, d])?.ids,
		).toEqual(["b", "c", "d"]);
	});

	it("starts a range with one card when no visible anchor exists", () => {
		expect(range(empty, a, [a, b])).toEqual(toggle(empty, a));
		expect(range(selected, c, [a, c])?.anchor).toBe("c");
	});

	it("rejects another column without changing the selection", () => {
		const other = { ...a, status: "done" as Status };
		expect(toggle(selected, other)).toBeNull();
		expect(range(selected, other, [other])).toBeNull();
		expect(selected.ids).toEqual(["b"]);
	});

	it("prunes hidden or departed cards and repairs the anchor", () => {
		const state: SelectionState = {
			status: "backlog",
			ids: ["a", "b", "c"],
			anchor: "b",
		};
		expect(prune(state, new Set(["a", "c"]))).toEqual({
			status: "backlog",
			ids: ["a", "c"],
			anchor: "c",
		});
		expect(prune(state, new Set(["b", "c"])).anchor).toBe("b");
		expect(prune(state, new Set())).toEqual(empty);
	});

	it("returns selected cards in column order, not selection order", () => {
		expect(
			ordered({ ...selected, ids: ["d", "b", "gone"] }, [a, b, c, d]),
		).toEqual([b, d]);
		expect(ordered(empty, [a, b])).toEqual([]);
	});
});
