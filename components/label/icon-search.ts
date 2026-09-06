import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { space, touchTarget } from "@/theme/tokens";

/**
 * The glyph catalog the icon picker searches (#100).
 *
 * The map is 7,448 entries, so the names are read off the installed
 * MaterialCommunityIcons set once — every name here is a glyph the app can
 * already draw, and a new release of the set updates the picker for free.
 * The list is sorted once at module scope: a search is a filter over it,
 * never a rebuild, and the picker's data is virtualised.
 *
 * `iconColumns` is the grid's column count for a measured width: the most
 * columns whose cells still clear `touchTarget` after the field's padding and
 * the gaps between cells. Six at 390px, three at 195px — four at 195px would
 * land the cells under the target, so the floor is arithmetic, not taste.
 */
const allNames = Object.keys(MaterialCommunityIcons.glyphMap).sort();

/** The glyphs matching a search, sorted — the whole set for an empty query. */
export function searchIcons(query: string): string[] {
	const needle = query.trim().toLowerCase();
	if (needle === "") return allNames;
	return allNames.filter((name) => name.includes(needle));
}

/** How many columns of glyphs fit at `width` with every cell a full target. */
export function iconColumns(width: number): number {
	const inner = width - space.md * 2;
	return Math.max(1, Math.floor((inner + space.xs) / (touchTarget + space.xs)));
}
