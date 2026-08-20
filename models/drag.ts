import { type Node, rankBetween, type Status } from "@/models/node";

/*
 * ---------------------------------------------------------------------------
 * Dragging a card
 * ---------------------------------------------------------------------------
 *
 * The pure half of drag and drop: where a card lands, what rank it takes, and
 * the timings that decide whether a finger on a card meant a drag at all.
 * Nothing here touches Firestore, React or a layout — a drop is exactly the
 * `moveNode(homeId, node, status, rank)` write the card menu already makes, and
 * this module works out its two arguments.
 *
 * The gesture timings live here rather than in `theme/tokens.ts` because they
 * are not layout: a millisecond is not a spacing step, and `space.md` has
 * nothing to say about how long a thumb has to rest before a card lifts.
 */

/**
 * How long a **touch** must stay still before a card lifts.
 *
 * `PERSONAS.md` has Ingrid, 71, at 200% text doing the most scrolling in the
 * app, and her scroll is *press → hesitate → move*. A 200ms hold reads that
 * hesitation as a drag, so ordinary scrolling would move cards she never
 * touched — her stated quit line. Half a second is long enough that the pause
 * has to be deliberate.
 */
export const holdMs = 500;

/**
 * How far a finger may travel while the hold is arming before it is a scroll
 * instead — and once it is a scroll it can never become a drag, however long
 * the finger stays down afterwards.
 */
export const holdSlop = 8;

/**
 * A **pointer** arms on movement alone, with no hold at all. A mouse that waits
 * half a second before a card moves reads as lag on the wide board where the
 * heaviest reordering happens, and the gesture collision the hold exists to
 * solve does not exist for a mouse: a drag and a scroll are different inputs.
 */
export const pointerSlop = 4;

/**
 * How long a held card rests in the screen-edge zone before the pane switches,
 * below `compactBreakpoint`.
 *
 * The **first** switch is deliberate — you moved there on purpose. The repeats
 * are the dangerous ones: a thumb naturally rests near the right edge of a
 * 390px screen, so the window to notice and escape gets longer rather than
 * shorter.
 */
export const paneDwellMs = 750;
export const paneRepeatDwellMs = 1250;

/** Which way a card went, which is what the snackbar says afterwards. */
export type DropDirection = "up" | "down" | "across";

export interface DropPlan {
	status: Status;
	rank: string;
	direction: DropDirection;
}

export interface DropRequest {
	/**
	 * The destination column's **visible** cards in `(rank, id)` order,
	 * including the dragged card itself when the status has not changed.
	 *
	 * Visible, not stored: a drop ranks against the cards you can see. Where the
	 * default-hide filter is holding somebody's personal projects back, those
	 * cards keep their own ranks wherever they fall — the alternative is a card
	 * landing visibly in one place and actually being in another.
	 */
	column: readonly Node[];
	dragged: Node;
	toStatus: Status;
	/**
	 * The slot the card is landing in, counted over the column **with the
	 * dragged card taken out** — `0` is above every remaining card.
	 */
	toIndex: number;
}

/**
 * What a drop writes, or `null` when it writes nothing.
 *
 * A card released where it started changes nothing and says nothing, mirroring
 * *Change position…* disabling the slot a card already occupies. A snackbar for
 * a move that did not happen teaches people that the screen lies.
 *
 * The rank is computed against the neighbours the card is landing *between*,
 * with the card itself removed from the list first — a card ranked against
 * where it currently is would be ranked against itself.
 */
export function dropPlan({
	column,
	dragged,
	toStatus,
	toIndex,
}: DropRequest): DropPlan | null {
	const others = column.filter((card) => card.id !== dragged.id);
	const index = Math.max(0, Math.min(toIndex, others.length));
	const from = column.findIndex((card) => card.id === dragged.id);

	const above = others[index - 1] ?? null;

	// It did not move. The two shapes this can take — the slot the card was
	// already in, and the same pair of neighbours reached by another route — are
	// the same shape: taking the card out at `from` and putting it back at
	// `index` restores its old neighbours exactly when the two are equal. Both
	// ends included, because the clamp above folds a drop past the end of the
	// column onto the last slot, which is where a card already sitting there is.
	if (toStatus === dragged.status && from === index) return null;

	return {
		status: toStatus,
		rank: rankBetween(above?.rank ?? null, tieSafeBelow(others, index, above)),
		direction:
			toStatus !== dragged.status ? "across" : index < from ? "up" : "down",
	};
}

/**
 * The rank to generate *below*, given that two cards can share one.
 *
 * Two people offline can produce the same rank between the same neighbours, and
 * the board's `(rank, id)` sort renders that tie identically everywhere — but
 * there is no key strictly between two equal ranks, and asking for one throws.
 * So a card dropped inside a tied run lands just after the run instead of
 * inside it, and the drop that does it breaks the tie permanently.
 */
function tieSafeBelow(
	others: readonly Node[],
	index: number,
	above: Node | null,
): string | null {
	if (above === null) return others[index]?.rank ?? null;

	for (let at = index; at < others.length; at++) {
		const rank = others[at]?.rank;
		if (rank !== undefined && rank > above.rank) return rank;
	}
	return null;
}

/*
 * ---------------------------------------------------------------------------
 * Hit testing
 * ---------------------------------------------------------------------------
 *
 * Measured in window coordinates and frozen when the card lifts: a drag is
 * hit-tested against the board as it was at the moment of the grab, never
 * against the board as it is being re-laid-out underneath. The gap that opens
 * at the landing spot moves every card below it, so a live re-measure would
 * feed the gesture its own output — the gap flickers between two slots and
 * nobody can say why.
 */

export interface Box {
	top: number;
	bottom: number;
	left: number;
	right: number;
}

/** A drop target that names a column: a column itself, or a chip in the strip. */
export interface StatusBox extends Box {
	status: Status;
}

/** The first target the point is inside, or `null` when it is over none. */
export function columnAt<T extends StatusBox>(
	targets: readonly T[],
	x: number,
	y: number,
): T | null {
	return (
		targets.find(
			(target) =>
				x >= target.left &&
				x < target.right &&
				y >= target.top &&
				y < target.bottom,
		) ?? null
	);
}

/**
 * The slot a point lands in, over a column's cards in order with the dragged
 * card already removed.
 *
 * A card is passed once the point is beyond its middle, which is what makes the
 * gap open on the side of the card the finger is actually on.
 */
export function landingSlot(cards: readonly Box[], y: number): number {
	let slot = 0;
	for (const card of cards) {
		if (y >= (card.top + card.bottom) / 2) slot++;
	}
	return slot;
}

/**
 * Which screen edge a held card is resting in, below `compactBreakpoint`.
 *
 * Only ever one of two, and only inside the board: an edge zone that reaches
 * outside the board would arm from a finger that has left it entirely.
 */
export function edgeAt(
	board: Box,
	x: number,
	y: number,
	zone: number,
): "left" | "right" | null {
	if (y < board.top || y >= board.bottom) return null;
	if (x < board.left || x >= board.right) return null;
	if (x < board.left + zone) return "left";
	if (x >= board.right - zone) return "right";
	return null;
}
