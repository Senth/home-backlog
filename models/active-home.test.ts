import { resolveActiveHomeId } from "@/models/active-home";

describe("resolveActiveHomeId", () => {
	it("keeps the home you were last in", () => {
		expect(resolveActiveHomeId(["a", "b"], "b")).toBe("b");
	});

	it("opens the only home you have, whatever was persisted", () => {
		expect(resolveActiveHomeId(["a"], null)).toBe("a");
		expect(resolveActiveHomeId(["a"], "gone")).toBe("a");
	});

	it("asks when there are several and nothing valid persisted", () => {
		// Picking the first one is how somebody records cabin work on the house
		// board. One level up, both homes are named and the choice is theirs.
		expect(resolveActiveHomeId(["a", "b"], null)).toBeNull();
	});

	it("asks again once you are removed from the home you were in", () => {
		expect(resolveActiveHomeId(["a", "b"], "c")).toBeNull();
	});

	it("has nothing to open when you are in no home at all", () => {
		expect(resolveActiveHomeId([], "a")).toBeNull();
		expect(resolveActiveHomeId([], null)).toBeNull();
	});
});
