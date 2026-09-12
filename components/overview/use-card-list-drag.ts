import { useCallback, useMemo, useRef, useState } from "react";
import { Animated, type View } from "react-native";
import type { DragPoint } from "@/components/board/DragArea.types";
import type {
	CardDragHandlers,
	Overlay,
} from "@/components/board/use-board-drag";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { type Box, landingSlot, tieSafeBelow } from "@/models/drag";
import { rankBetween } from "@/models/node";

/**
 * Reordering the editor's card list by drag — the board's own drag, minus
 * everything a board has and a list does not.
 *
 * The input is the same `DragArea` the board cards use: a touch arms on a
 * 500 ms hold, a pointer on `pointerSlop` pixels, and the accessible
 * alternative lives in the card menu (*Move up* / *Move down*), which is this
 * repo's established drag-plus-controls pattern. What is dropped from
 * `useBoardDrag` is everything that exists because a board has *columns*:
 * pane walking, the edge zone, chips, and the status half of every drop.
 * What stays is its shape — geometry measured once at the grab and frozen,
 * a gap that opens at the landing slot, a card that flies home rather than
 * vanishing — because those are the parts that make the board's drag feel
 * right, and none of them are about columns.
 *
 * The write at the end is a rank: `rankBetween` over the neighbours the card
 * lands between, in the merged list, which is why a global card reordered
 * here reorders in every home. A tie in the neighbours is `tieSafeBelow`'s,
 * the same break the board makes.
 */

interface Session {
	id: string;
	/** The list as it looked when the card lifted. */
	cards: readonly { id: string; rank: string }[];
	/** Every row's box, in window coordinates, keyed by id. */
	boxes: Map<string, Box>;
	/** The list container's box, for the overlay's position. */
	list: Box;
	overlay: Overlay;
	/** The slot the card came from, and the one it is over now. */
	home: number;
	over: number;
}

export interface ListDrag {
	/** The card in flight, or `null` when nothing is held. */
	draggedId: string | null;
	/** What the list draws: the frozen order while a card is up. */
	order: readonly { id: string; rank: string }[];
	/** Where the gap sits, counted over the list with the dragged card out. */
	gapIndex: number | null;
	/** How tall the gap is: exactly the card it is holding a place for. */
	gapHeight: number;
	overlay: Overlay | null;
	offset: Animated.ValueXY;
	/** A ref callback for the list container and for one row. */
	register: (key: string) => (view: View | null) => void;
	handlers: (id: string) => CardDragHandlers;
}

export const listKey = "overview-card-list";
export const rowKey = (id: string) => `overview-card-row:${id}`;

export function useCardListDrag({
	cards,
	onMove,
}: {
	cards: readonly { id: string; rank: string }[];
	onMove: (id: string, rank: string) => void;
}): ListDrag {
	const [session, setSession] = useState<Session | null>(null);
	// docs/DESIGN.md § Motion: with the query on, the card lands instead of
	// settling.
	const reduced = useReducedMotion();

	const live = useRef<Session | null>(null);
	const start = useRef<DragPoint | null>(null);
	/** Which grab is the current one — a press can end before measuring does. */
	const grabbed = useRef(0);
	const offset = useRef(new Animated.ValueXY()).current;

	const views = useRef(new Map<string, View>());
	const refCallbacks = useRef(new Map<string, (view: View | null) => void>());

	const register = useCallback((key: string) => {
		const known = refCallbacks.current.get(key);
		if (known !== undefined) return known;

		const callback = (view: View | null) => {
			if (view === null) views.current.delete(key);
			else views.current.set(key, view);
		};
		refCallbacks.current.set(key, callback);
		return callback;
	}, []);

	const clear = useCallback(() => {
		live.current = null;
		start.current = null;
		offset.setValue({ x: 0, y: 0 });
		setSession(null);
	}, [offset]);

	/**
	 * The card flies home rather than vanishing under the finger, the way the
	 * board's does — the gap holds its place until it lands.
	 */
	const settle = useCallback(
		(from: Session) => {
			// Reduced motion has no flight home: the position is already wherever
			// the finger left it, so it lands there at once.
			if (reduced) {
				clear();
				return;
			}

			const home = { ...from, over: from.home };
			live.current = home;
			setSession(home);
			Animated.spring(offset, {
				toValue: { x: 0, y: 0 },
				useNativeDriver: false,
				speed: 20,
				bounciness: 0,
			}).start(() => {
				if (live.current === home) clear();
			});
		},
		[clear, offset, reduced],
	);

	const boxOf = useCallback(
		(view: View | undefined): Promise<Box | null> =>
			view === undefined
				? Promise.resolve(null)
				: new Promise((resolve) => {
						view.measureInWindow((x, y, width, height) =>
							resolve({
								left: x,
								top: y,
								right: x + width,
								bottom: y + height,
							}),
						);
					}),
		[],
	);

	const grab = useCallback(
		async (id: string, point: DragPoint) => {
			const token = ++grabbed.current;
			const frozen = cards;

			const [list, ...rows] = await Promise.all([
				boxOf(views.current.get(listKey)),
				...frozen.map((card) => boxOf(views.current.get(rowKey(card.id)))),
			]);
			// Let go before the measuring finished, so there is no card to lift.
			if (grabbed.current !== token || list === null) return;

			const boxes = new Map<string, Box>();
			frozen.forEach((card, index) => {
				const box = rows[index];
				if (box !== null && box !== undefined) boxes.set(card.id, box);
			});
			const own = boxes.get(id);
			if (own === undefined) return;

			const others = frozen.filter((card) => card.id !== id);
			const home = landingSlot(
				others.map((card) => boxes.get(card.id) as Box),
				(own.top + own.bottom) / 2,
			);

			const opened: Session = {
				id,
				cards: frozen,
				boxes,
				list,
				overlay: {
					left: own.left - list.left,
					top: own.top - list.top,
					width: own.right - own.left,
					height: own.bottom - own.top,
				},
				home,
				over: home,
			};
			live.current = opened;
			start.current = point;
			offset.setValue({ x: 0, y: 0 });
			setSession(opened);
		},
		[cards, offset, boxOf],
	);

	const move = useCallback(
		(point: DragPoint) => {
			const held = live.current;
			const from = start.current;
			if (held === null || from === null) return;

			offset.setValue({ x: point.x - from.x, y: point.y - from.y });

			const others = held.cards.filter((card) => card.id !== held.id);
			const over = landingSlot(
				others.map((card) => held.boxes.get(card.id) as Box),
				point.y,
			);
			if (over !== held.over) {
				const next = { ...held, over };
				live.current = next;
				setSession(next);
			}
		},
		[offset],
	);

	const drop = useCallback(() => {
		grabbed.current++;
		const held = live.current;
		if (held === null) return;

		const others = held.cards.filter((card) => card.id !== held.id);
		const above = others[held.over - 1] ?? null;
		// A drop that changes nothing writes nothing — the card flies home, the
		// same answer the board gives. A real move hands over at once: the list
		// re-renders in the new order the moment the listener applies the rank.
		if (held.over === held.home) {
			settle(held);
			return;
		}

		clear();
		onMove(
			held.id,
			rankBetween(above?.rank ?? null, tieSafeBelow(others, held.over, above)),
		);
	}, [clear, onMove, settle]);

	const cancel = useCallback(() => {
		grabbed.current++;
		const held = live.current;
		if (held !== null) settle(held);
	}, [settle]);

	const handlers = useCallback(
		(id: string): CardDragHandlers => ({
			onGrab: (point) => {
				void grab(id, point);
			},
			onMove: move,
			onDrop: drop,
			onCancel: cancel,
		}),
		[cancel, drop, grab, move],
	);

	return useMemo(
		() => ({
			draggedId: session?.id ?? null,
			order: session?.cards ?? cards,
			gapIndex: session === null ? null : session.over,
			gapHeight: session?.overlay.height ?? 0,
			overlay: session?.overlay ?? null,
			offset,
			register,
			handlers,
		}),
		[cards, handlers, offset, register, session],
	);
}
