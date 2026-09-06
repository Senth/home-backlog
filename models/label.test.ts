import {
	effectiveLabels,
	type LabelWithId,
	labelError,
	maxLabelsPerNode,
	movedRank,
	newLabel,
	toLabels,
} from "@/models/label";
import { toHex } from "@/models/label-color";
import { rankBetween } from "@/models/node";

const amber = toHex([0xfd, 0xe6, 0x8a]);
const teal = toHex([0x99, 0xf6, 0xe4]);

/** A home's set in its own order, ids a, b, c — ranks real order keys. */
const homeLabels: LabelWithId[] = [
	{ id: "a", title: "Garden", icon: "sprout", color: teal, rank: "V0" },
	{ id: "b", title: "Electrical", icon: "bolt", color: amber, rank: "V1" },
	{ id: "c", title: "Water", icon: "water", color: teal, rank: "V2" },
];

describe("labelError", () => {
	it("refuses a title that is empty or only spaces", () => {
		expect(labelError("")).toBe("labels.titleRequired");
		expect(labelError("   ")).toBe("labels.titleRequired");
	});

	it("refuses one past the cap", () => {
		expect(labelError("x".repeat(61))).toBe("labels.titleTooLong");
	});

	it("measures the trimmed title, which is what gets written", () => {
		expect(labelError("  Electrical  ")).toBeNull();
		// Padding does not push a title over the cap — only its trimmed length does.
		expect(labelError(`  ${"x".repeat(58)}  `)).toBeNull();
		expect(labelError("x".repeat(61))).toBe("labels.titleTooLong");
	});
});

describe("newLabel", () => {
	it("trims the title and carries the rest as given", () => {
		expect(
			newLabel({
				title: "  Electrical  ",
				icon: "bolt",
				color: amber,
				rank: "a0",
			}),
		).toEqual({ title: "Electrical", icon: "bolt", color: amber, rank: "a0" });
	});
});

describe("effectiveLabels", () => {
	it("answers nothing when no label applies and none is defined", () => {
		expect(effectiveLabels([], [], [])).toEqual([]);
		expect(effectiveLabels([], [], homeLabels)).toEqual([]);
	});

	it("answers the card's own labels", () => {
		expect(effectiveLabels(["b"], [], homeLabels)).toEqual([homeLabels[1]]);
	});

	it("answers labels passed down by the trail alone", () => {
		expect(effectiveLabels([], ["c"], homeLabels)).toEqual([homeLabels[2]]);
	});

	it("answers a label the card owns and inherits exactly once", () => {
		expect(effectiveLabels(["b", "c"], ["b"], homeLabels)).toEqual([
			homeLabels[1],
			homeLabels[2],
		]);
	});

	it("drops an id whose definition was deleted, silently", () => {
		expect(effectiveLabels(["b", "ghost"], ["a"], homeLabels)).toEqual([
			homeLabels[0],
			homeLabels[1],
		]);
	});

	it("caps the answer at what the gutter is built around", () => {
		const seven: LabelWithId[] = "abcdefg".split("").map((id, index) => ({
			id,
			title: id,
			icon: "sprout",
			color: teal,
			rank: `a${index}`,
		}));

		const labels = effectiveLabels(
			seven.map((label) => label.id),
			[],
			seven,
		);
		expect(labels).toHaveLength(maxLabelsPerNode);
		expect(labels.map((label) => label.id)).toEqual([
			"a",
			"b",
			"c",
			"d",
			"e",
			"f",
		]);
	});
});

describe("movedRank", () => {
	it("lands a moved label between the pair that surrounds it after the move", () => {
		// Swapping b up: it lands between a's old neighbours — nothing before a,
		// and a itself.
		expect(movedRank(homeLabels, 1, -1)).toBe(rankBetween(null, "V0"));
		// Swapping b down: between c and whatever follows c, which is nothing.
		expect(movedRank(homeLabels, 1, 1)).toBe(rankBetween("V2", null));
	});

	it("moves the first label down and the last one up", () => {
		expect(movedRank(homeLabels, 0, -1)).toBeNull();
		expect(movedRank(homeLabels, 0, 1)).toBe(rankBetween("V1", "V2"));
		expect(movedRank(homeLabels, 2, 1)).toBeNull();
		expect(movedRank(homeLabels, 2, -1)).toBe(rankBetween("V0", "V1"));
	});

	it("writes nothing for a move that leaves the list unchanged in shape", () => {
		// One label cannot move anywhere: both directions are edges.
		expect(movedRank([homeLabels[0]], 0, -1)).toBeNull();
		expect(movedRank([homeLabels[0]], 0, 1)).toBeNull();
	});
});

describe("toLabels", () => {
	it("returns nothing for a home document with no labels key", () => {
		expect(toLabels({ name: "Huset" })).toEqual([]);
		expect(toLabels({})).toEqual([]);
		expect(toLabels(undefined)).toEqual([]);
		expect(toLabels(null)).toEqual([]);
	});

	it("returns nothing when the key does not hold a map", () => {
		expect(toLabels({ labels: "bolt" })).toEqual([]);
		expect(toLabels({ labels: [] })).toEqual([]);
	});

	it("drops a malformed entry and keeps the rest", () => {
		// The rules cannot iterate the map's values, so a malformed entry reaches
		// the client; it renders as nothing rather than crashing every screen
		// that draws a card.
		const labels = toLabels({
			labels: {
				good: { title: "Electrical", icon: "bolt", color: amber, rank: "a0" },
				empty: null,
				partial: { title: "Garden", icon: "sprout" },
				wrongColor: { title: "Water", icon: "water", color: 42, rank: "a1" },
			},
		});

		expect(labels).toEqual([
			{
				id: "good",
				title: "Electrical",
				icon: "bolt",
				color: amber,
				rank: "a0",
			},
		]);
	});

	it("returns the set in the home's order, rank first and key as the tie-break", () => {
		const labels = toLabels({
			labels: {
				c: { title: "Water", icon: "water", color: teal, rank: "a1" },
				a: { title: "Garden", icon: "sprout", color: teal, rank: "a0" },
				b: { title: "Electrical", icon: "bolt", color: amber, rank: "a0" },
			},
		});

		expect(labels.map((label) => label.id)).toEqual(["a", "b", "c"]);
	});
});
