import enUS from "./locales/en-US.json";
import svSE from "./locales/sv-SE.json";
import { resolveLocale } from "./resolve-locale";

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
});
