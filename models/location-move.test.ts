import {
	beginMove,
	cancelMove,
	destinationRefused,
	idleMove,
	selectDestination,
} from "@/models/location-move";
import type { Location } from "@/models/locations";

function location(id: string, ancestorIds: string[] = []): Location {
	return {
		id,
		title: id,
		parentId: ancestorIds.at(-1) ?? null,
		ancestorIds,
		rank: "a0",
		icon: "crosshairs-gps",
		color: "stone",
		createdAt: null,
		createdBy: "uid-a",
		updatedAt: null,
	};
}

describe("the move mode's state machine", () => {
	it("begins in the choosing phase, naming the place that moves", () => {
		const moving = location("shed", ["garden"]);
		const mode = beginMove(moving);

		expect(mode).toEqual({ phase: "choose", moving });
	});

	it("confirms a destination, and re-points when another is chosen", () => {
		let mode = beginMove(location("shed"));
		mode = selectDestination(mode, location("garden"));

		expect(mode).toEqual({
			phase: "confirm",
			moving: location("shed"),
			parent: location("garden"),
		});

		// A second tap re-points the confirm; nothing is written until it.
		mode = selectDestination(mode, location("basement"));
		expect(mode).toEqual({
			phase: "confirm",
			moving: location("shed"),
			parent: location("basement"),
		});
	});

	it("confirms the top level as a destination of its own", () => {
		const mode = selectDestination(beginMove(location("shed")), null);

		expect(mode).toEqual({
			phase: "confirm",
			moving: location("shed"),
			parent: null,
		});
	});

	it("leaves no half-state behind: leaving the mode is idle from any phase", () => {
		// Escape, back, a tab switch — every exit is the same reset, and every
		// later read of the screen state starts from idle.
		expect(cancelMove()).toEqual(idleMove);
		const abandoned = selectDestination(beginMove(location("shed")), null);
		expect(abandoned).not.toEqual(idleMove);
		expect(cancelMove()).toEqual(idleMove);
	});

	it("answers nothing when the mode is not running", () => {
		expect(selectDestination(idleMove, location("garden"))).toBe(idleMove);
	});
});

describe("destinationRefused", () => {
	it("refuses the moved place itself, in place", () => {
		expect(destinationRefused(location("shed"), "shed")).toBe(true);
	});

	it("refuses everything under it, at any depth", () => {
		expect(
			destinationRefused(location("bench", ["garden", "shed"]), "shed"),
		).toBe(true);
	});

	it("accepts an ancestor, a sibling, and an unrelated place", () => {
		expect(destinationRefused(location("garden"), "shed")).toBe(false);
		expect(destinationRefused(location("toolrack", ["garden"]), "shed")).toBe(
			false,
		);
		expect(destinationRefused(location("attic"), "shed")).toBe(false);
	});
});
