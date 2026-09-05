import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Animated, type View } from "react-native";
import type { Notice } from "@/components/board/CardMenu";
import type { DragPoint } from "@/components/board/DragArea.types";
import { moveNode } from "@/data/nodes";
import {
	type Box,
	columnAt,
	dropPlan,
	edgeAt,
	landingSlot,
	paneDwellMs,
	paneRepeatDwellMs,
	type StatusBox,
} from "@/models/drag";
import type { Node, Status } from "@/models/node";
import { drag as dragTokens } from "@/theme/tokens";

/** Where a lifted card would land: a column, and a slot in it. */
export interface DropSlot {
	status: Status;
	/** Counted over that column with the dragged card taken out. */
	index: number;
	/**
	 * Whether the finger is over the column itself or over its chip in the
	 * strip. A chip can only ever append — it says *which column*, not where in
	 * it — and it is the chip rather than the pane that gets marked.
	 */
	via: "column" | "chip";
}

/** Where the lifted card is drawn, relative to the board's own view. */
export interface Overlay {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** What a column needs to take part in a drag. */
export interface ColumnDrag {
	/** The card in flight, which no column draws in its list. */
	node: Node | null;
	/** The slot this column's gap sits at, or `null` when it is elsewhere. */
	gapAt: number | null;
	/** How tall the gap is: exactly the card it is holding a place for. */
	gapHeight: number;
	register: (key: string) => (view: View | null) => void;
	handlers: (node: Node) => CardDragHandlers;
}

/** The gesture callbacks one card's `DragArea` is given. */
export interface CardDragHandlers {
	onGrab: (point: DragPoint) => void;
	onMove: (point: DragPoint) => void;
	onDrop: () => void;
	onCancel: () => void;
}

interface Session {
	node: Node;
	/**
	 * The board as it looked when the card lifted, which is what stays on screen
	 * until it lands.
	 *
	 * A board is two live listeners, and a card arriving from the garden — or
	 * twenty of them from an agent — would otherwise move the gap out from under
	 * the finger. Arrivals apply the instant the card is put down.
	 */
	cards: Node[];
	/** Where the lifted card is drawn, relative to the board. */
	overlay: Overlay;
	/** The slot it came from, which is where it settles back to. */
	home: DropSlot;
	over: DropSlot | null;
}

interface Geometry {
	board: Box;
	columns: StatusBox[];
	/** The strip's chips, below `compactBreakpoint`. Empty above it. */
	chips: StatusBox[];
	cards: Partial<Record<Status, { id: string; box: Box }[]>>;
}

/** The one pane on screen below `compactBreakpoint`, and how to change it. */
export interface Pane {
	index: number;
	count: number;
	onChange: (index: number) => void;
}

export interface BoardDragOptions {
	homeId: string;
	/** Every visible card on the board, in `(rank, id)` order. */
	nodes: Node[];
	/** The columns the board is showing, in order. */
	shown: readonly Status[];
	onNotice: (notice: Notice) => void;
	/**
	 * Below the breakpoint only. Holding a card at the screen edge walks the
	 * board sideways one column at a time — the path for a drop where the
	 * *position* matters and not only the column, which a chip cannot express.
	 *
	 * Above the breakpoint every column is already on screen, so there is
	 * nothing to walk to.
	 */
	pane?: Pane;
}

export interface BoardDrag {
	/** The card in flight, or `null` when nothing is held. */
	node: Node | null;
	/** What the board draws: the frozen order while a card is up. */
	cards: Node[];
	over: DropSlot | null;
	/** The lifted card's size and where it started. */
	overlay: Overlay | null;
	/** How far the finger has carried it. */
	offset: Animated.ValueXY;
	/** A ref callback for one of the things a drop is measured against. */
	register: (key: string) => (view: View | null) => void;
	handlers: (node: Node) => CardDragHandlers;
	/** Which screen edge the card is resting in, below the breakpoint. */
	edge: "left" | "right" | null;
	/** How far through the dwell that edge is, 0 to 1. */
	dwell: Animated.Value;
}

export const boardKey = "board";
export const columnKey = (status: Status) => `column:${status}`;
export const chipKey = (status: Status) => `chip:${status}`;
export const cardKey = (id: string) => `card:${id}`;

/**
 * Picking a card up, carrying it, and putting it down.
 *
 * The write at the end is the one *Move to* and *Change position…* already
 * make — `moveNode`, `status` and `rank` together, queued offline — so a drag
 * changes no document, no rule, no query and no listener. What is new is
 * working out which `status` and which `rank`, which is `models/drag.ts`, and
 * knowing where everything on screen *is*, which is here.
 *
 * **The geometry is measured once, when the card lifts.** Everything the drag
 * is hit-tested against is frozen at that moment. The gap that opens at the
 * landing spot moves every card below it, so re-measuring during the drag would
 * feed the gesture its own output and the gap would flicker between two slots.
 */
export function useBoardDrag({
	homeId,
	nodes,
	shown,
	onNotice,
	pane,
}: BoardDragOptions): BoardDrag {
	const { t } = useTranslation();

	const [session, setSession] = useState<Session | null>(null);
	const [edge, setEdge] = useState<"left" | "right" | null>(null);

	// The gesture's own working state. Refs, not state: a pointer move must not
	// wait for a render to know where it started, and only the *slot* is worth
	// re-rendering for.
	const live = useRef<Session | null>(null);
	const geometry = useRef<Geometry | null>(null);
	const start = useRef<DragPoint | null>(null);
	const at = useRef<DragPoint | null>(null);
	const edgeRef = useRef<"left" | "right" | null>(null);
	/**
	 * Which grab is the current one.
	 *
	 * Measuring is asynchronous — a frame or two on a full column — and a quick
	 * press can be over before it finishes. Without this, the drop runs against
	 * no session and the measurement that arrives afterwards lifts a card nobody
	 * is holding: it stays in the air, its row stays flattened, and the board
	 * stays frozen with no gesture left to end it.
	 */
	const grabbed = useRef(0);
	const offset = useRef(new Animated.ValueXY()).current;
	const dwell = useRef(new Animated.Value(0)).current;
	const walking = useRef<Animated.CompositeAnimation | null>(null);
	// Read by the dwell timer, which outlives the render that moved the board.
	const paneRef = useRef<Pane | undefined>(pane);
	paneRef.current = pane;

	const stopWalking = useCallback(() => {
		walking.current?.stop();
		walking.current = null;
		dwell.setValue(0);
	}, [dwell]);

	// Nothing goes on animating into a board that has been left: the dwell's
	// completion moves the pane, and the pane belongs to a screen.
	useEffect(() => stopWalking, [stopWalking]);

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

	// Not a token bump: this also runs as the settle spring's tidy-up, long after
	// the press ended, and bumping there would cancel a *new* grab that started
	// while the last card was still flying home. Every path that ends a press
	// bumps for itself.
	const clear = useCallback(() => {
		stopWalking();
		edgeRef.current = null;
		setEdge(null);
		live.current = null;
		geometry.current = null;
		start.current = null;
		offset.setValue({ x: 0, y: 0 });
		setSession(null);
	}, [offset, stopWalking]);

	/**
	 * The card flies back to where it came from rather than vanishing from under
	 * the finger. It stays out of the column's list until it lands, so there is
	 * never a moment with two of it on screen.
	 */
	const settle = useCallback(
		(from: Session) => {
			// A card put down in the edge zone must not go on walking the board
			// while it flies home.
			stopWalking();
			edgeRef.current = null;
			setEdge(null);

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
		[clear, offset, stopWalking],
	);

	const measure = useCallback(
		async (cards: Node[]): Promise<Geometry | null> => {
			// One turn, not one per view: `measureInWindow` is a task of its own on
			// React Native Web and a bridge call on native, so measuring a full
			// column card by card is the difference between a card that lifts and a
			// card that lifts eventually.
			const [board, columns, chips, byStatus] = await Promise.all([
				boxOf(views.current.get(boardKey)),
				Promise.all(
					shown.map((status) =>
						boxOf(views.current.get(columnKey(status))).then((box) =>
							box === null ? null : { ...box, status },
						),
					),
				),
				Promise.all(
					shown.map((status) =>
						boxOf(views.current.get(chipKey(status))).then((box) =>
							box === null ? null : { ...box, status },
						),
					),
				),
				Promise.all(
					shown.map(async (status) => {
						const measured = await Promise.all(
							cards
								.filter((node) => node.status === status)
								.map((card) =>
									boxOf(views.current.get(cardKey(card.id))).then((box) =>
										box === null ? null : { id: card.id, box },
									),
								),
						);
						return [status, measured.filter(isMeasured)] as const;
					}),
				),
			]);

			if (board === null) return null;

			return {
				board,
				columns: columns.filter(isStatusBox),
				chips: chips.filter(isStatusBox),
				cards: Object.fromEntries(byStatus),
			};
		},
		[shown],
	);

	/** The slot a point is over, or `null` when it is over no column at all. */
	const slotAt = useCallback(
		(point: DragPoint, held: Session): DropSlot | null => {
			const known = geometry.current;
			if (known === null) return null;

			// The strip first: its chips sit above the pane, so a chip and the
			// column under it can both contain the point.
			const chip = columnAt(known.chips, point.x, point.y);
			if (chip !== null) {
				// Appended, and counted from the frozen board rather than from the
				// measurements: below the breakpoint the destination column is not on
				// screen, so there is nothing of it to have measured.
				const cards = held.cards.filter(
					(card) => card.status === chip.status && card.id !== held.node.id,
				);
				return { status: chip.status, index: cards.length, via: "chip" };
			}

			const column = columnAt(known.columns, point.x, point.y);
			if (column === null) return null;

			const others = (known.cards[column.status] ?? []).filter(
				(card) => card.id !== held.node.id,
			);
			return {
				status: column.status,
				index: landingSlot(
					others.map((card) => card.box),
					point.y,
				),
				via: "column",
			};
		},
		[],
	);

	/**
	 * The pane-walking dwell, below the breakpoint.
	 *
	 * The **first** switch is the short one — you moved to the edge on purpose.
	 * Every repeat while the finger stays there gets the longer window, because
	 * a thumb resting near the edge of a 390px screen is how a card walks three
	 * columns nobody asked for.
	 */
	const walk = useCallback(
		(side: "left" | "right" | null, repeat: boolean) => {
			stopWalking();

			const current = paneRef.current;
			if (side === null || current === undefined) return;

			const next = current.index + (side === "left" ? -1 : 1);
			if (next < 0 || next >= current.count) return;

			const run = Animated.timing(dwell, {
				toValue: 1,
				duration: repeat ? paneRepeatDwellMs : paneDwellMs,
				useNativeDriver: false,
			});
			walking.current = run;
			run.start(({ finished }) => {
				if (!finished) return;
				current.onChange(next);
				// Taken as read rather than waited for. `onChange` is a `setState`,
				// and the repeat below starts before React has re-rendered, so a
				// repeat reading the pane from the last render would ask for the
				// column the board has already left — filling the whole bar and
				// moving nothing, every second dwell.
				paneRef.current = { ...current, index: next };
				walk(side, true);
			});
		},
		[dwell, stopWalking],
	);

	/** Where the gap is now, if that is somewhere new. */
	const commit = useCallback((slot: DropSlot | null) => {
		const held = live.current;
		if (held === null) return;
		const same =
			slot === null
				? held.over === null
				: slot.status === held.over?.status &&
					slot.index === held.over?.index &&
					slot.via === held.over?.via;
		if (same) return;

		const next = { ...held, over: slot };
		live.current = next;
		setSession(next);
	}, []);

	/**
	 * The board moved under the card — an edge hold walked it to the next pane —
	 * so everything the drop is hit-tested against has to be measured again.
	 *
	 * This is the one thing that re-measures mid-drag, and it is not the thing
	 * the freeze exists to prevent: the pane changed because the *drag* asked it
	 * to, and what is on screen afterwards is a different column, not the same
	 * one reflowed around the gap. The frame's delay is the layout landing.
	 */
	const paneIndex = pane?.index;
	useEffect(() => {
		const held = live.current;
		if (held === null || paneIndex === undefined) return;

		// The token, for the same reason the grab carries one: this measuring
		// outlives the press by up to `paneSettleMs` plus a turn, and a card put
		// down inside that window would otherwise have its geometry written over
		// the next card's — or the gap placed from a board that is no longer up.
		const token = grabbed.current;
		let stale = false;
		const settled = setTimeout(() => {
			void measure(held.cards).then((measured) => {
				if (stale || grabbed.current !== token || measured === null) return;
				geometry.current = measured;

				// And the gap moves with it. The finger has not gone anywhere — the
				// board came to it — so nothing else would place the gap until the
				// next movement, and a card let go the instant the pane arrives
				// would be written back into the column it was picked up from.
				const point = at.current;
				if (point !== null) commit(slotAt(point, held));
			});
		}, paneSettleMs);

		return () => {
			stale = true;
			clearTimeout(settled);
		};
	}, [commit, measure, paneIndex, slotAt]);

	const grab = useCallback(
		async (node: Node, point: DragPoint) => {
			const token = ++grabbed.current;
			const frozen = nodes;
			const measured = await measure(frozen);
			// Let go before the measuring finished, so there is no card to lift.
			if (grabbed.current !== token || measured === null) return;

			const box = measured.cards[node.status]?.find(
				(card) => card.id === node.id,
			)?.box;
			if (box === undefined) return;

			geometry.current = measured;
			start.current = point;
			at.current = point;
			offset.setValue({ x: 0, y: 0 });

			const others = (measured.cards[node.status] ?? []).filter(
				(card) => card.id !== node.id,
			);
			const home: DropSlot = {
				status: node.status,
				index: landingSlot(
					others.map((card) => card.box),
					(box.top + box.bottom) / 2,
				),
				via: "column",
			};

			const opened: Session = {
				node,
				cards: frozen,
				overlay: {
					left: box.left - measured.board.left,
					top: box.top - measured.board.top,
					width: box.right - box.left,
					height: box.bottom - box.top,
				},
				home,
				over: home,
			};
			live.current = opened;
			setSession(opened);
		},
		[measure, nodes, offset],
	);

	const move = useCallback(
		(point: DragPoint) => {
			const held = live.current;
			const from = start.current;
			if (held === null || from === null) return;

			at.current = point;
			offset.setValue({ x: point.x - from.x, y: point.y - from.y });

			// A point outside every column clears the gap — nowhere is a place the
			// board can show, and dropping out there puts the card back. The gap
			// is the only landing indicator, so "nowhere" is shown by it being
			// gone: at 200% text the hand covers the pane, and a gap that kept
			// the last column while the finger was over the toolbar would promise
			// a landing the drop below does not make.
			const slot = slotAt(point, held);

			// The strip wins over the edge. On a 390px phone the leftmost chip and
			// the edge zone overlap, and aiming at the chip — the primary way
			// across on a phone — would otherwise arm a pane walk behind it.
			const side =
				slot?.via === "chip" ||
				geometry.current === null ||
				paneRef.current === undefined
					? null
					: edgeAt(
							geometry.current.board,
							point.x,
							point.y,
							dragTokens.edgeZone,
						);
			if (side !== edgeRef.current) {
				edgeRef.current = side;
				setEdge(side);
				walk(side, false);
			}

			commit(slot);
		},
		[commit, offset, slotAt, walk],
	);

	const drop = useCallback(() => {
		// Whatever else happens, this press is over: a grab still measuring must
		// not lift a card afterwards, and the early return below is exactly the
		// case where it would — a click quick enough to finish first.
		grabbed.current++;

		const held = live.current;
		if (held === null) return;

		const target = held.over;

		// Let go anywhere that is not a column: the escape that needs no aim,
		// for the person who freezes mid-gesture and would rather not have
		// committed at all. Nothing is written, the card flies home, and the
		// board says so in words — the gap already went away under the finger,
		// so the sentence confirms what the screen showed rather than lying
		// about a move the way a no-op snackbar would.
		if (target === null) {
			settle(held);
			onNotice({ text: t("board.putBack") });
			return;
		}

		const plan = dropPlan({
			column: held.cards.filter((card) => card.status === target.status),
			dragged: held.node,
			toStatus: target.status,
			toIndex: target.index,
		});

		// A drop that changes nothing writes nothing and says nothing. A snackbar
		// for a move that did not happen teaches people that the screen lies.
		if (plan === null) {
			settle(held);
			return;
		}

		clear();

		// Deleted under you, subtree and all, while you were carrying it. The
		// write would resurrect a card nobody can reach.
		if (!nodes.some((card) => card.id === held.node.id)) {
			onNotice({ text: t("board.gone") });
			return;
		}

		const node = held.node;
		moveNode(homeId, node, plan.status, plan.rank).catch(failed);
		onNotice({
			text:
				plan.direction === "across"
					? t("board.moved", { column: t(`status.${plan.status}`) })
					: t(plan.direction === "up" ? "board.movedUp" : "board.movedDown"),
			// Both halves are still in hand, exactly as the card menu's *Move* has
			// them. One snackbar, replaced and never stacked, so twelve drags in a
			// row leave one line on screen and it undoes the last of them.
			undo: () => {
				moveNode(
					homeId,
					{ ...node, status: plan.status },
					node.status,
					node.rank,
				).catch(failed);
			},
		});
	}, [clear, homeId, nodes, onNotice, settle, t]);

	const cancel = useCallback(() => {
		grabbed.current++;
		const held = live.current;
		if (held !== null) settle(held);
	}, [settle]);

	const handlers = useCallback(
		(node: Node): CardDragHandlers => ({
			onGrab: (point) => {
				void grab(node, point);
			},
			onMove: move,
			onDrop: drop,
			onCancel: cancel,
		}),
		[cancel, drop, grab, move],
	);

	return useMemo(
		() => ({
			node: session?.node ?? null,
			cards: session?.cards ?? nodes,
			over: session?.over ?? null,
			overlay: session?.overlay ?? null,
			offset,
			register,
			handlers,
			edge,
			dwell,
		}),
		[dwell, edge, handlers, nodes, offset, register, session],
	);
}

/**
 * How long the board is given to lay a new pane out before it is measured.
 *
 * One frame is not always enough — the pane that arrives has its own cards to
 * lay out — and measuring too early puts the gap under the wrong card for the
 * rest of the drag.
 */
const paneSettleMs = 80;

const failed = (reason: unknown) =>
	console.error("Could not move the card:", reason);

function isStatusBox(box: StatusBox | null): box is StatusBox {
	return box !== null;
}

function isMeasured(
	card: { id: string; box: Box } | null,
): card is { id: string; box: Box } {
	return card !== null;
}

/** One view's frame in window coordinates, or `null` if it is not mounted. */
function boxOf(view: View | undefined): Promise<Box | null> {
	if (view === undefined) return Promise.resolve(null);

	return new Promise((resolve) => {
		view.measureInWindow((x, y, width, height) =>
			resolve({ left: x, top: y, right: x + width, bottom: y + height }),
		);
	});
}
