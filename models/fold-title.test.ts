import { describe, expect, it } from "@jest/globals";
import { foldTitle } from "@/models/fold-title";

describe("foldTitle", () => {
	it("case-folds", () => {
		expect(foldTitle("Garden")).toBe("garden");
	});

	it("folds the diacritics away, so Trädgård is found from trad", () => {
		expect(foldTitle("Trädgård")).toBe("tradgard");
	});

	it("leaves an already-folded title alone", () => {
		expect(foldTitle("tradgard")).toBe("tradgard");
	});
});
