import { performance as nodePerformance } from "node:perf_hooks";
import { markLaunch, timingMarkdown, timingRows } from "@/utils/launch-timing";

const entry = (name: string, startTime: number) => ({
	name: `launch:${name}`,
	startTime,
});

describe("timingRows", () => {
	it("lists the marks in launch order with the time since the previous one", () => {
		const rows = timingRows([
			entry("bundle", 612.4),
			entry("html", 41.2),
			entry("auth", 744.6),
		]);

		expect(rows).toEqual([
			{ name: "html", at: 41, step: 41 },
			{ name: "bundle", at: 612, step: 571 },
			{ name: "auth", at: 745, step: 133 },
		]);
	});

	it("leaves a missing mark out and measures the next step from the last present one", () => {
		const rows = timingRows([
			entry("html", 40),
			entry("bundle", 600),
			entry("splash", 820),
		]);

		expect(rows.map((row) => row.name)).toEqual(["html", "bundle", "splash"]);
		expect(rows[2]).toEqual({ name: "splash", at: 820, step: 220 });
	});

	it("ignores marks that are not launch marks", () => {
		expect(
			timingRows([{ name: "other", startTime: 5 }, entry("html", 10)]),
		).toEqual([{ name: "html", at: 10, step: 10 }]);
	});
});

describe("timingMarkdown", () => {
	it("puts the header above a right-aligned Markdown table", () => {
		const markdown = timingMarkdown(
			[
				{ name: "html", at: 41, step: 41 },
				{ name: "content", at: 1288, step: 1247 },
			],
			"dev · warm SW · 390×844",
		);

		expect(markdown).toBe(
			[
				"dev · warm SW · 390×844",
				"",
				"| mark | at | +step |",
				"| --- | --: | --: |",
				"| html | 41 | 41 |",
				"| content | 1288 | 1247 |",
			].join("\n"),
		);
	});
});

describe("markLaunch", () => {
	beforeEach(() => {
		jest.replaceProperty(
			globalThis,
			"performance",
			nodePerformance as unknown as Performance,
		);
		performance.clearMarks();
	});

	it("records each mark once per page load", () => {
		markLaunch("auth");
		const first = performance.getEntriesByName("launch:auth")[0].startTime;
		markLaunch("auth");

		const marks = performance.getEntriesByName("launch:auth");
		expect(marks).toHaveLength(1);
		expect(marks[0].startTime).toBe(first);
	});

	it("does nothing where the platform has no mark API", () => {
		jest.replaceProperty(globalThis, "performance", {
			now: () => 0,
		} as unknown as Performance);

		expect(() => markLaunch("auth")).not.toThrow();
	});
});
