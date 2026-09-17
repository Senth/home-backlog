/**
 * The title case-folds away diacritics as well as case, so `Trädgård` is
 * found from `trad` — the pickers are searched by thumbs that do not compose
 * å on an English keyboard. Shared by every search-and-check picker: labels,
 * locations, and the filter's people and places.
 */
export function foldTitle(title: string): string {
	return title
		.toLowerCase()
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "");
}
