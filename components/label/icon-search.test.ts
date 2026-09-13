import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { iconColumns, searchIcons } from "@/components/label/icon-search";
import { space, touchTarget } from "@/theme/tokens";

const names = Object.keys(MaterialCommunityIcons.glyphMap).sort();

/** The cell width a grid of `columns` leaves at `width`, gaps included. */
function cellWidth(width: number, columns: number): number {
	const inner = width - space.md * 2;
	return (inner - (columns - 1) * space.xs) / columns;
}

describe("searchIcons", () => {
	it("answers the whole sorted set for an empty query", () => {
		expect(searchIcons("")).toEqual(names);
		expect(searchIcons("   ")).toEqual(names);
	});

	it("matches anywhere in the name, so `home` also finds folder-home", () => {
		const results = searchIcons("home");
		expect(results).toContain("home");
		expect(results).toContain("folder-home");
		// Everything it answers is a real MaterialCommunityIcons name.
		expect(results.every((name) => names.includes(name))).toBe(true);
	});

	it("finds the four `home` faces the list exists to tell apart", () => {
		const results = searchIcons("home");
		for (const name of [
			"home",
			"home-outline",
			"home-variant",
			"home-variant-outline",
		]) {
			expect(results).toContain(name);
		}
	});

	it("answers nothing for a query no glyph satisfies", () => {
		expect(searchIcons("no-such-glyph-forever")).toEqual([]);
	});

	it("folds case", () => {
		expect(searchIcons("HOME")).toEqual(searchIcons("home"));
	});
});

describe("iconColumns", () => {
	// The brief's three widths: a cell may never undercut the touch target.
	const widths = [195, 320, 390];

	it.each(widths)(
		"keeps every cell at or over the touch target at %ipx",
		(width) => {
			const columns = iconColumns(width);
			expect(cellWidth(width, columns)).toBeGreaterThanOrEqual(touchTarget);
		},
	);

	it("lands on six columns at 390px and three at 195px", () => {
		expect(iconColumns(390)).toBe(6);
		expect(iconColumns(195)).toBe(3);
	});

	it("adds columns as the width grows, one more per target of room", () => {
		expect(iconColumns(320)).toBe(5);
		expect(iconColumns(390 + (touchTarget + space.xs))).toBe(7);
	});

	it("answers one column however narrow the width", () => {
		expect(iconColumns(0)).toBe(1);
		expect(iconColumns(60)).toBe(1);
	});
});
