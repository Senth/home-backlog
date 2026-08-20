import type { ReactNode } from "react";

/** A point in **window** coordinates, which is what a drop is hit-tested in. */
export interface DragPoint {
	x: number;
	y: number;
}

/**
 * Shared by the web and native `DragArea`, which are separate files.
 *
 * The two platforms recognise the gesture in genuinely different ways rather
 * than in two spellings of the same way — see the comment at the top of each —
 * so this is the only thing they have in common: a card was picked up, it
 * moved, and it was either put down or taken away.
 */
export interface DragAreaProps {
	/**
	 * Off where a drag could do nothing — a board with one card, or a card that
	 * is not on a board at all. A disabled area is an ordinary view, and the tap
	 * and the overflow menu inside it are untouched either way.
	 */
	enabled?: boolean;
	/** The card has lifted. Nothing is written until it lands. */
	onGrab: (point: DragPoint) => void;
	onMove: (point: DragPoint) => void;
	onDrop: (point: DragPoint) => void;
	/** The gesture was taken away — a second finger, a cancelled touch, a blur. */
	onCancel: () => void;
	children: ReactNode;
}
