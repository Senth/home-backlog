describe("buildId", () => {
	const original = process.env.EXPO_PUBLIC_BUILD;

	afterEach(() => {
		process.env.EXPO_PUBLIC_BUILD = original;
	});

	it("reads the stamped build", () => {
		process.env.EXPO_PUBLIC_BUILD = "2026-09-10 · e6810c9";
		jest.isolateModules(() => {
			const { buildId: stamped } = require("@/utils/build-info");
			expect(stamped).toBe("2026-09-10 · e6810c9");
		});
	});

	it("falls back to dev", () => {
		delete process.env.EXPO_PUBLIC_BUILD;
		jest.isolateModules(() => {
			const { buildId: dev } = require("@/utils/build-info");
			expect(dev).toBe("dev");
		});
	});
});
