import {
	buildFromHtml,
	isStale,
	reloadDecision,
} from "@/utils/shell-freshness";

const shell = (build: string) =>
	`<html><head><meta name="build" content="${build}"/></head></html>`;

describe("buildFromHtml", () => {
	it("reads the build the shell names", () => {
		expect(buildFromHtml(shell("2026-09-10 · e6810c9"))).toBe(
			"2026-09-10 · e6810c9",
		);
	});

	it("reads the self-closing spelling", () => {
		expect(buildFromHtml('<meta name="build" content="dev"/>')).toBe("dev");
	});

	it("returns null when the tag is absent", () => {
		expect(buildFromHtml("<html><head></head></html>")).toBeNull();
	});
});

describe("isStale", () => {
	it.each([
		["same build", "dev", "dev", false],
		["different build", "2026-09-10 · e6810c9", "dev", true],
		["unreadable shell", null, "dev", false],
	])("%s", (_name, fetched, running, expected) => {
		expect(isStale(fetched, running)).toBe(expected);
	});
});

describe("reloadDecision", () => {
	const inside = { msSinceBoot: 3_000, bootWindowMs: 10_000 };
	const outside = { msSinceBoot: 30_000, bootWindowMs: 10_000 };

	it.each([
		[
			"reloads inside the boot window",
			{ ...inside, alreadyReloaded: false },
			"reload",
		],
		[
			"reloads at the window's edge",
			{ ...inside, msSinceBoot: 10_000, alreadyReloaded: false },
			"reload",
		],
		["prompts after it", { ...outside, alreadyReloaded: false }, "prompt"],
		[
			"ignores when a reload already happened, inside",
			{ ...inside, alreadyReloaded: true },
			"ignore",
		],
		[
			"ignores when a reload already happened, outside",
			{ ...outside, alreadyReloaded: true },
			"ignore",
		],
	])("%s", (_name, input, expected) => {
		expect(reloadDecision(input)).toBe(expected);
	});
});
