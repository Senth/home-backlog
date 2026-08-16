import { formatList } from "@/i18n/format-list";

describe("formatList", () => {
	it("is empty for nothing at all", () => {
		expect(formatList([], "en-US")).toBe("");
	});

	it("is the name itself for one person", () => {
		expect(formatList(["Marcus"], "en-US")).toBe("Marcus");
	});

	it("joins with the conjunction the language uses", () => {
		expect(formatList(["Marcus", "Nadia"], "en-US")).toBe("Marcus and Nadia");
		expect(formatList(["Marcus", "Nadia"], "sv-SE")).toBe("Marcus och Nadia");
	});

	it("keeps going past two", () => {
		expect(formatList(["Marcus", "Nadia", "Ingrid"], "en-US")).toBe(
			"Marcus, Nadia, and Ingrid",
		);
	});

	/**
	 * The reason the formatter is tried rather than feature-detected: a locale tag
	 * that is not a tag at all throws a `RangeError`, and this sentence sits
	 * inside a dialog that must still open.
	 */
	it("falls back to a comma join rather than throwing", () => {
		expect(formatList(["Marcus", "Nadia"], "not a locale")).toBe(
			"Marcus, Nadia",
		);
	});
});
