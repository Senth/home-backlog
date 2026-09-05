import { labelError, newLabel, toLabels } from "@/models/label";
import { toHex } from "@/models/label-color";

const amber = toHex([0xfd, 0xe6, 0x8a]);
const teal = toHex([0x99, 0xf6, 0xe4]);

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
