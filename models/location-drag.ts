import type { Box } from "@/models/drag";
import {
	childLocations,
	compareLocations,
	inSubtree,
	type Location,
} from "@/models/locations";
import { rankAtEnd, rankBetween } from "@/models/node";

/**
 * Where a dragged place lands (#205, phase 7) — the drop-target arithmetic the
 * tree's drag reads, pure so it is testable without a view.
 *
 * Three targets, three writes, all through the one `moveLocation` the move
 * mode already makes:
 *
 * - **between two rows** reorders the dragged place among that row's siblings;
 * - **onto a row** re-parents into it, appended at the end of its children;
 * - **the left band of a row** outdents: the dragged place lands a sibling
 *   after that row's parent, one step shallower.
 *
 * Everything that would write a cycle, or a no-op dressed as a move, is
 * refused here — `null` means put back, so the write-time throw in
 * `moveLocation` stays the backstop it was always meant to be.
 */

/** How close to a row's top or bottom edge reads as "between two rows". */
const reorderBand = 16;

/** How far into a row's left edge reads as "one step shallower". */
const outdentBand = 16;

export type LocationDropTarget =
	| { kind: "reorder"; sibling: Location; after: boolean }
	| { kind: "reparent"; parent: Location }
	| { kind: "outdent"; target: Location };

/** The target a point lands on, or `null` when it lands on nothing usable. */
export function dropTargetAt(
	rows: readonly { location: Location; box: Box }[],
	dragged: Location,
	point: { x: number; y: number },
): LocationDropTarget | null {
	const hit = rows.find(
		({ box }) =>
			point.x >= box.left &&
			point.x < box.right &&
			point.y >= box.top &&
			point.y < box.bottom,
	);
	if (hit === undefined) return null;
	const { location: target, box } = hit;

	// The left band outdents — every row carries the band, at every depth, so
	// the shallowest drop is always reachable wherever the finger starts.
	if (point.x - box.left < outdentBand) {
		if (target.parentId === null) return null;
		if (target.parentId === dragged.id) return null;
		if (inSubtree(target, dragged.id)) return null;
		return { kind: "outdent", target };
	}

	if (point.y - box.top < reorderBand) {
		return target.id === dragged.id || inSubtree(target, dragged.id)
			? null
			: { kind: "reorder", sibling: target, after: false };
	}
	if (box.bottom - point.y < reorderBand) {
		return target.id === dragged.id || inSubtree(target, dragged.id)
			? null
			: { kind: "reorder", sibling: target, after: true };
	}

	// Onto the row: re-parent into it. A row of the dragged place's own
	// subtree — itself included — would write a cycle no screen could escape.
	if (inSubtree(target, dragged.id)) return null;
	return { kind: "reparent", parent: target };
}

/**
 * What the tree draws while a place is carried — the drop indicator the model
 * already decided, with no arithmetic of its own:
 *
 * - **re-parent** highlights the row the place drops into;
 * - **reorder and outdent** draw the line between siblings — before the
 *   sibling the place lands above, after the sibling — or after the target's
 *   parent, which is where an outdent lands.
 */
export type LocationDropHint =
	| { kind: "highlight"; id: string }
	| { kind: "gap"; beforeId: string | null; afterId: string | null };

export function dropHint(
	over: LocationDropTarget,
	locations: readonly Location[],
): LocationDropHint | null {
	if (over.kind === "reparent")
		return { kind: "highlight", id: over.parent.id };
	if (over.kind === "outdent") {
		// The same refusal `moveFor` makes: an outdent whose destination would
		// be the top level writes nothing, so nothing may promise it either.
		const parent = locations.find(
			(location) => location.id === over.target.parentId,
		);
		if (parent === undefined || parent.parentId === null) return null;
		return { kind: "gap", beforeId: null, afterId: parent.id };
	}
	return over.after
		? { kind: "gap", beforeId: null, afterId: over.sibling.id }
		: { kind: "gap", beforeId: over.sibling.id, afterId: null };
}

/**
 * The `moveLocation` arguments a target computes to, or `null` for a no-op —
 * a refusal here writes nothing, and a snackbar for a move that did not
 * happen teaches people the screen lies.
 *
 * `locations` is the home's whole tree; the sibling sets the rank arithmetic
 * reads are derived from it in `(rank, id)` order, the dragged place itself
 * taken out — the same rule the board's drop runs on.
 */
export function moveFor(
	target: LocationDropTarget,
	dragged: Location,
	locations: readonly Location[],
): { parent: Location | null; rank: string } | null {
	const siblingsOf = (parentId: string | null) =>
		childLocations(locations, parentId).sort(compareLocations);
	const withoutDragged = (parentId: string | null) =>
		siblingsOf(parentId).filter((location) => location.id !== dragged.id);

	if (target.kind === "reparent") {
		const siblings = withoutDragged(target.parent.id);
		return {
			parent: target.parent,
			rank: rankAtEnd(siblings.at(-1)?.rank ?? null),
		};
	}

	if (target.kind === "reorder") {
		const siblings = withoutDragged(target.sibling.parentId);
		const index = siblings.findIndex((each) => each.id === target.sibling.id);
		if (index < 0) return null;
		const rank = target.after
			? rankBetween(siblings[index].rank, siblings[index + 1]?.rank ?? null)
			: rankBetween(siblings[index - 1]?.rank ?? null, siblings[index].rank);
		const parent =
			target.sibling.parentId === null
				? null
				: (locations.find(
						(location) => location.id === target.sibling.parentId,
					) ?? null);
		return { parent, rank };
	}

	// Outdent: a sibling after the target's parent, among the grandparent's
	// children — one step shallower than the row the drop landed on.
	const parent = locations.find(
		(location) => location.id === target.target.parentId,
	);
	if (parent === undefined || parent.parentId === null) return null;
	const destination =
		locations.find((location) => location.id === parent.parentId) ?? null;
	const siblings = withoutDragged(destination?.id ?? null);
	const index = siblings.findIndex((each) => each.id === parent.id);
	if (index < 0) return null;
	return {
		parent: destination,
		rank: rankBetween(siblings[index].rank, siblings[index + 1]?.rank ?? null),
	};
}
