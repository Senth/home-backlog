import {
	type BoardFilter,
	boardFilterKey,
	decodeBoardFilter,
	encodeBoardFilter,
} from "@/models/board-filter";

const hour = 60 * 60 * 1000;
const t0 = new Date("2026-09-17T12:00:00.000Z");
const at = (hours: number) => new Date(t0.getTime() + hours * hour);

const priorityFilter: BoardFilter = {
	mode: "open",
	reach: "board",
	conditions: [{ field: "priority", anyOf: ["high", "urgent"] }],
};

describe("boardFilterKey", () => {
	it("is one key per home, with no board segment in it", () => {
		expect(boardFilterKey("huset")).toBe("home-backlog.boardFilter.huset");
	});
});

describe("encodeBoardFilter / decodeBoardFilter", () => {
	it("round-trips a filter", () => {
		const raw = encodeBoardFilter(priorityFilter, t0.getTime());
		expect(decodeBoardFilter(raw, t0)).toEqual(priorityFilter);
	});

	it("decodes a future version to no filter rather than throwing", () => {
		const raw = JSON.stringify({
			v: 2,
			savedAt: t0.getTime(),
			mode: "open",
			reach: "board",
			conditions: [],
		});
		expect(decodeBoardFilter(raw, t0)).toBeNull();
	});

	it("decodes junk of every shape to no filter rather than throwing", () => {
		expect(decodeBoardFilter(null, t0)).toBeNull();
		expect(decodeBoardFilter("not json at all", t0)).toBeNull();
		expect(decodeBoardFilter("42", t0)).toBeNull();
		expect(
			decodeBoardFilter(JSON.stringify({ savedAt: "yesterday" }), t0),
		).toBeNull();
	});

	it("a fresh blob with unreadable fields falls back field by field", () => {
		const raw = JSON.stringify({
			v: 1,
			savedAt: t0.getTime(),
			mode: "yesterday",
			reach: 7,
			conditions: [
				"junk",
				{ field: "nope" },
				{ field: "labelIds", anyOf: ["garden"] },
			],
		});
		expect(decodeBoardFilter(raw, t0)).toEqual({
			mode: "open",
			reach: "board",
			conditions: [{ field: "labelIds", anyOf: ["garden"] }],
		});
	});

	it("a done-mode blob drops the questions done cannot ask", () => {
		const raw = JSON.stringify({
			v: 1,
			savedAt: t0.getTime(),
			mode: "done",
			reach: "subtree",
			conditions: [
				{ field: "status", anyOf: ["backlog"] },
				{ field: "completedAt", is: "within", n: 30 },
			],
		});
		expect(decodeBoardFilter(raw, t0)).toEqual({
			mode: "done",
			reach: "subtree",
			conditions: [{ field: "completedAt", is: "within", n: 30 }],
		});
	});
});

describe("the sliding 24-hour expiry", () => {
	it("is still there at 24 hours and gone at 25", () => {
		const raw = encodeBoardFilter(priorityFilter, t0.getTime());
		expect(decodeBoardFilter(raw, at(24))).toEqual(priorityFilter);
		expect(decodeBoardFilter(raw, at(25))).toBeNull();
	});

	it("a touch at hour 23 keeps it alive at hour 46", () => {
		const touched = encodeBoardFilter(priorityFilter, at(23).getTime());
		expect(decodeBoardFilter(touched, at(46))).toEqual(priorityFilter);
	});
});
