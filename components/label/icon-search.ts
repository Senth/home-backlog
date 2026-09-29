import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { space, touchTarget } from "@/theme/tokens";

/**
 * The glyph catalog the icon picker searches (#100, #379).
 *
 * The map is 7,448 entries, so the names are read off the installed
 * MaterialCommunityIcons set once — every name here is a glyph the app can
 * already draw, and a new release of the set updates the picker for free.
 * The list is sorted and every name split into its words once at module
 * scope: a search is a filter over them, never a rebuild.
 *
 * A search matches words, not the whole query: every query word must hit one
 * of an icon's words — its name split on `-`, plus the keyword index when one
 * is loaded. Results come in three tiers, alphabetical within each: a
 * word-prefix hit on the name, then a word-prefix hit on a keyword, then a
 * substring-only hit anywhere. An icon lands in the worst tier any of its
 * query words reached. There is no diacritic folding, so `ö` never matches
 * `o`.
 *
 * `iconColumns` is the grid's column count for a measured width: the most
 * columns whose cells still clear `touchTarget` after the field's padding and
 * the gaps between cells. Six at 390px, three at 195px — four at 195px would
 * land the cells under the target, so the floor is arithmetic, not taste.
 */
const allNames = Object.keys(MaterialCommunityIcons.glyphMap).sort();
const nameWords = allNames.map((name) => name.split("-"));
const noKeywords: string[] = [];

/** Glyph name → its keyword words, split once when the index is built. */
export type IconKeywords = Record<string, string[]>;

type KeywordFile = Record<string, string>;

const keywordFiles: Record<string, () => Promise<{ default: KeywordFile }>> = {
	"en-US": () => import("@/i18n/icon-keywords/en-US.json"),
	"sv-SE": () => import("@/i18n/icon-keywords/sv-SE.json"),
};

/**
 * The keyword index for `locale`: the en-US aliases always, plus the
 * locale's own file when one exists. Loaded on demand so the data stays out
 * of the entry bundle.
 */
export async function loadIconKeywords(locale: string): Promise<IconKeywords> {
	const loaders = [...new Set(["en-US", locale])].flatMap(
		(tag) => keywordFiles[tag] ?? [],
	);
	const files = await Promise.all(loaders.map((load) => load()));
	const index: IconKeywords = {};
	for (const { default: file } of files) {
		for (const [name, text] of Object.entries(file)) {
			const words = text.toLowerCase().split(/\s+/).filter(Boolean);
			index[name] = [...(index[name] ?? []), ...words];
		}
	}
	return index;
}

/** 0–2 for the tier `word` hits, or 3 for a miss. */
function tierOf(
	word: string,
	name: string,
	words: string[],
	keywords: string[],
): number {
	for (let i = 0; i < words.length; i++) {
		if (words[i].startsWith(word)) return 0;
	}
	for (let i = 0; i < keywords.length; i++) {
		if (keywords[i].startsWith(word)) return 1;
	}
	if (name.includes(word)) return 2;
	for (let i = 0; i < keywords.length; i++) {
		if (keywords[i].includes(word)) return 2;
	}
	return 3;
}

/** The glyphs matching a search, tiered — the whole set for an empty query. */
export function searchIcons(query: string, keywords?: IconKeywords): string[] {
	const needles = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (needles.length === 0) return allNames;
	const tiers: string[][] = [[], [], []];
	for (let i = 0; i < allNames.length; i++) {
		const name = allNames[i];
		const own = keywords?.[name] ?? noKeywords;
		let tier = 0;
		for (let n = 0; n < needles.length && tier < 3; n++) {
			tier = Math.max(tier, tierOf(needles[n], name, nameWords[i], own));
		}
		if (tier < 3) tiers[tier].push(name);
	}
	return tiers.flat();
}

/** How many columns of glyphs fit at `width` with every cell a full target. */
export function iconColumns(width: number): number {
	const inner = width - space.md * 2;
	return Math.max(1, Math.floor((inner + space.xs) / (touchTarget + space.xs)));
}
