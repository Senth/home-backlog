import { keyNameError, maxKeyNameLength } from "@/models/api-key";

describe("the key name", () => {
	it("is required", () => {
		expect(keyNameError("")).toBe("automations.nameRequired");
		expect(keyNameError("   ")).toBe("automations.nameRequired");
	});

	it("accepts exactly the maximum length", () => {
		expect(keyNameError("n".repeat(maxKeyNameLength))).toBeNull();
	});

	it("refuses one character more", () => {
		expect(keyNameError("n".repeat(maxKeyNameLength + 1))).toBe(
			"automations.nameTooLong",
		);
	});

	it("measures the trimmed name", () => {
		expect(keyNameError(`  ${"n".repeat(maxKeyNameLength)}  `)).toBeNull();
	});
});
