const SUFFIXES = [
	"en",
	"et",
	"n",
	"t",
	"ar",
	"er",
	"or",
	"na",
	"erna",
	"arna",
	"orna",
];

export function normalizeKeywords(value) {
	const words = [...new Set(value.toLowerCase().trim().split(/\s+/))].filter(
		Boolean,
	);
	const bases = words.filter(
		(word) =>
			!SUFFIXES.some(
				(suffix) =>
					word.endsWith(suffix) &&
					words.includes(word.slice(0, -suffix.length)),
			),
	);
	return bases
		.filter(
			(word) =>
				!bases.some((other) => other !== word && other.startsWith(word)),
		)
		.join(" ");
}
