/**
 * The module installs on import and nothing else, so every case re-requires
 * it under a controlled global, and puts the real one back after.
 */
function withoutRaf(): void {
	delete (globalThis as { requestAnimationFrame?: unknown })
		.requestAnimationFrame;
	jest.resetModules();
	require("@/utils/raf-polyfill");
}

afterEach(() => {
	jest.resetModules();
});

describe("raf-polyfill", () => {
	it("installs a requestAnimationFrame where there is none", () => {
		const before = globalThis.requestAnimationFrame;
		withoutRaf();

		expect(typeof globalThis.requestAnimationFrame).toBe("function");
		globalThis.requestAnimationFrame = before;
	});

	it("hands the callback a numeric timestamp", async () => {
		const before = globalThis.requestAnimationFrame;
		withoutRaf();

		const time = await new Promise<number>((resolve) => {
			(globalThis.requestAnimationFrame as (cb: (t: number) => void) => void)(
				(t) => resolve(t),
			);
		});

		expect(typeof time).toBe("number");
		expect(Number.isNaN(time)).toBe(false);
		globalThis.requestAnimationFrame = before;
	});

	it("leaves an existing requestAnimationFrame alone", () => {
		const existing = jest.fn(() => 0);
		globalThis.requestAnimationFrame = existing;

		jest.resetModules();
		require("@/utils/raf-polyfill");

		expect(globalThis.requestAnimationFrame).toBe(existing);
	});
});
