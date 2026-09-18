import enUS from "@/i18n/locales/en-US.json";
import svSE from "@/i18n/locales/sv-SE.json";
import { resolveLocale } from "@/i18n/resolve-locale";

describe("resolveLocale", () => {
	it("matches Swedish regardless of region", () => {
		expect(resolveLocale("sv-SE")).toBe("sv-SE");
		expect(resolveLocale("sv")).toBe("sv-SE");
		expect(resolveLocale("sv-FI")).toBe("sv-SE");
		expect(resolveLocale("SV-se")).toBe("sv-SE");
	});

	it("maps every English region to en-US", () => {
		expect(resolveLocale("en-US")).toBe("en-US");
		expect(resolveLocale("en-GB")).toBe("en-US");
		expect(resolveLocale("en")).toBe("en-US");
	});

	it("falls back to en-US for unshipped languages and missing tags", () => {
		expect(resolveLocale("de-DE")).toBe("en-US");
		expect(resolveLocale("")).toBe("en-US");
		expect(resolveLocale(undefined)).toBe("en-US");
		expect(resolveLocale(null)).toBe("en-US");
	});
});

/** Flattens `{a: {b: "x"}}` to `["a.b"]`. */
function keyPaths(value: unknown, prefix = ""): string[] {
	if (typeof value !== "object" || value === null) return [prefix];
	return Object.entries(value).flatMap(([key, child]) =>
		keyPaths(child, prefix ? `${prefix}.${key}` : key),
	);
}

describe("locale files", () => {
	// A key present in one file and missing in the other renders as the raw key
	// path on screen. Nothing else catches that — there is no type link between
	// a `t()` call and the JSON.
	it("carry exactly the same keys", () => {
		expect(keyPaths(svSE).sort()).toEqual(keyPaths(enUS).sort());
	});

	it("have no empty strings", () => {
		for (const [name, file] of [
			["en-US", enUS],
			["sv-SE", svSE],
		] as const) {
			const values = JSON.stringify(file);
			expect(`${name}:${values.includes('""')}`).toBe(`${name}:false`);
		}
	});

	// A plural nested as `{one, other}` resolves to an object, so `t()` prints
	// its "returned an object instead of string" diagnostic on screen — here
	// plurals travel as flat `_one`/`_other` suffixes, and nothing else catches
	// a key shaped the other way.
	it("carry no nested plural objects", () => {
		const nested = (value: unknown, prefix: string): string[] =>
			typeof value !== "object" || value === null
				? []
				: Object.entries(value).flatMap(([key, child]) => {
						const path = prefix ? `${prefix}.${key}` : key;
						if (
							typeof child === "object" &&
							child !== null &&
							("one" in child || "other" in child)
						) {
							return [path];
						}
						return nested(child, path);
					});
		for (const [name, file] of [
			["en-US", enUS],
			["sv-SE", svSE],
		] as const) {
			expect(`${name}:${nested(file, "").join(",")}`).toBe(`${name}:`);
		}
	});
});
