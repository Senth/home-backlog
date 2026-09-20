import { inSubtree, type Location } from "@/models/locations";

/**
 * The move-under mode's state machine (#205, Q14).
 *
 * *Move under…* must be unmistakable: a tap that was going to open a place's
 * work may not quietly move a room instead. So the mode is three states, and
 * every screen surface reads the phase off this one shape — rows select, the
 * bar speaks, and leaving is always `idle`. Pure, so the transitions are
 * testable without a render.
 */

export type MoveMode =
	/** No move is happening; the tree browses. */
	| { phase: "idle" }
	/** A place is being moved; every row tap picks a destination. */
	| { phase: "choose"; moving: Location }
	/** A destination is picked; the bar confirms before anything is written. */
	| { phase: "confirm"; moving: Location; parent: Location | null };

export const idleMove: MoveMode = { phase: "idle" };

export function beginMove(moving: Location): MoveMode {
	return { phase: "choose", moving };
}

/**
 * A row tap picks a destination — from the choosing phase, or as a re-point
 * while confirming, so a mis-tap costs one tap to fix and never a write.
 * Idle answers idle: a mode that is not running selects nothing.
 */
export function selectDestination(
	mode: MoveMode,
	parent: Location | null,
): MoveMode {
	if (mode.phase === "idle") return mode;
	return { phase: "confirm", moving: mode.moving, parent };
}

export function cancelMove(): MoveMode {
	return idleMove;
}

/**
 * The destinations a move refuses, in place: the moved place and everything
 * under it, itself included — the same predicate the write throws on
 * (`moveLocation`'s backstop) and the old destination picker greyed rows out
 * with. A destination refused here never reaches the confirm phase, so the
 * throw stays what it was always meant to be: a last resort, not the UI.
 */
export function destinationRefused(
	candidate: Location,
	movingId: string,
): boolean {
	return inSubtree(candidate, movingId);
}
