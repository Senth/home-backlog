import { useCallback, useMemo, useRef, useState } from "react";
import { Animated, type View } from "react-native";
import { moveLocation } from "@/data/locations";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { Box } from "@/models/drag";
import {
	dropTargetAt,
	type LocationDropTarget,
	moveFor,
} from "@/models/location-drag";
import type { Location } from "@/models/locations";

/** Where the lifted row is drawn, relative to the screen's own view. */
export interface Overlay {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface LocationDragHandlers {
	onGrab: (point: { x: number; y: number }) => void;
	onMove: (point: { x: number; y: number }) => void;
	onDrop: (point: { x: number; y: number }) => void;
	onCancel: () => void;
}

interface Session {
	location: Location;
	/** The rows as they measured when the place lifted — frozen for the drag. */
	rows: readonly { location: Location; box: Box }[];
	overlay: Overlay;
	over: LocationDropTarget | null;
}

export interface LocationDragOptions {
	homeId: string;
	/** The home's whole tree, as the screen holds it. */
	locations: readonly Location[];
	/** The screen says "put back" when a drop lands on nothing usable. */
	onPutBack: () => void;
	onError: (reason: unknown) => void;
}

export interface LocationDrag {
	/** The place in flight, or `null` when nothing is held. */
	dragged: Location | null;
	/** Where it would land right now, or `null` when over nothing usable. */
	over: LocationDropTarget | null;
	overlay: Overlay | null;
	/** How far the finger has carried it. */
	offset: Animated.ValueXY;
	/** A ref callback for the screen box and one per row. */
	register: (key: string) => (view: View | null) => void;
	handlers: (location: Location) => LocationDragHandlers;
}

export const screenKey = "screen";
export const rowKey = (id: string) => `row:${id}`;

const targetIdOf = (target: LocationDropTarget): string =>
	target.kind === "reorder"
		? target.sibling.id
		: target.kind === "outdent"
			? target.target.id
			: target.parent.id;

/**
 * Picking a place up, carrying it, and putting it down (#205, phase 7).
 *
 * The write at the end is the one the move mode already makes —
 * `moveLocation`, one batch for the moved place and its descendants — so a
 * drag changes no document, no rule, no query and no listener. What is new is
 * `models/location-drag.ts`'s arithmetic (which row, which target) and the
 * measuring, which is here and is **frozen at the lift**: a place re-parenting
 * under another moves the rows below it, and re-measuring during the drag
 * would feed the gesture its own output.
 *
 * Reduced motion has no flight home and no lift: the row lands where the
 * finger left it, at once — docs/DESIGN.md § Motion's mandatory path.
 */
export function useLocationDrag({
	homeId,
	locations,
	onPutBack,
	onError,
}: LocationDragOptions): LocationDrag {
	const reduced = useReducedMotion();

	const [session, setSession] = useState<Session | null>(null);

	const live = useRef<Session | null>(null);
	const start = useRef<{ x: number; y: number } | null>(null);
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

	/** The row flies home rather than vanishing from under the finger. */
	const settle = useCallback(
		(from: Session) => {
			if (reduced) {
				clear();
				return;
			}
			live.current = from;
			setSession(from);
			Animated.spring(offset, {
				toValue: { x: 0, y: 0 },
				useNativeDriver: false,
				speed: 20,
				bounciness: 0,
			}).start(() => {
				// A grab that started while this flight was on does not get
				// cleared away with it.
				if (live.current === from) clear();
			});
		},
		[clear, offset, reduced],
	);

	/** One view's frame in window coordinates, or `null` if it is not mounted. */
	const boxOf = useCallback((view: View | undefined): Promise<Box | null> => {
		if (view === undefined) return Promise.resolve(null);
		return new Promise((resolve) => {
			view.measureInWindow((x, y, width, height) =>
				resolve({ left: x, top: y, right: x + width, bottom: y + height }),
			);
		});
	}, []);

	const grab = useCallback(
		async (location: Location, point: { x: number; y: number }) => {
			const token = ++grabbed.current;

			const [screen, ...rowBoxes] = await Promise.all([
				boxOf(views.current.get(screenKey)),
				...locations.map((each) =>
					boxOf(views.current.get(rowKey(each.id))).then((box) =>
						box === null ? null : { location: each, box },
					),
				),
			]);
			// Let go before the measuring finished, so there is no row to lift.
			if (grabbed.current !== token || screen === null) return;

			const rows = rowBoxes.filter(
				(row): row is { location: Location; box: Box } => row !== null,
			);
			const own = rows.find((row) => row.location.id === location.id);
			if (own === undefined) return;

			start.current = point;
			offset.setValue({ x: 0, y: 0 });
			const opened: Session = {
				location,
				rows,
				overlay: {
					left: own.box.left - screen.left,
					top: own.box.top - screen.top,
					width: own.box.right - own.box.left,
					height: own.box.bottom - own.box.top,
				},
				over: null,
			};
			live.current = opened;
			setSession(opened);
		},
		[boxOf, locations, offset],
	);

	const move = useCallback(
		(point: { x: number; y: number }) => {
			const held = live.current;
			const from = start.current;
			if (held === null || from === null) return;

			offset.setValue({ x: point.x - from.x, y: point.y - from.y });

			const over = dropTargetAt(held.rows, held.location, point);
			const same =
				over === null
					? held.over === null
					: held.over !== null &&
						over.kind === held.over.kind &&
						targetIdOf(over) === targetIdOf(held.over);
			if (same) return;
			const next = { ...held, over };
			live.current = next;
			setSession(next);
		},
		[offset],
	);
	const drop = useCallback(
		(point: { x: number; y: number }) => {
			grabbed.current++;
			const held = live.current;
			if (held === null) return;

			const target = held.over;
			const plan =
				target === null ? null : moveFor(target, held.location, locations);

			// Dropped nowhere, or on a refusal: the escape that needs no aim.
			// Nothing is written, the row flies home — and only the finger that
			// came back to the very row it lifted says so, because that is a put
			// back rather than a refused aim.
			if (plan === null) {
				const own = held.rows.find(
					(row) => row.location.id === held.location.id,
				);
				const home =
					own !== undefined &&
					point.x >= own.box.left &&
					point.x < own.box.right &&
					point.y >= own.box.top &&
					point.y < own.box.bottom;
				if (!home) onPutBack();
				settle(held);
				return;
			}

			// A drop that changes nothing writes nothing and says nothing.
			if (
				(plan.parent?.id ?? null) === held.location.parentId &&
				plan.rank === held.location.rank
			) {
				settle(held);
				return;
			}

			clear();
			moveLocation(homeId, held.location, plan.parent, plan.rank).catch(
				onError,
			);
		},
		[clear, homeId, locations, onError, onPutBack, settle],
	);
	const cancel = useCallback(() => {
		grabbed.current++;
		const held = live.current;
		if (held !== null) settle(held);
	}, [settle]);

	const handlers = useCallback(
		(location: Location): LocationDragHandlers => ({
			onGrab: (point) => {
				void grab(location, point);
			},
			onMove: move,
			onDrop: drop,
			onCancel: cancel,
		}),
		[cancel, drop, grab, move],
	);
	return useMemo(
		() => ({
			dragged: session?.location ?? null,
			over: session?.over ?? null,
			overlay: session?.overlay ?? null,
			offset,
			register,
			handlers,
		}),
		[handlers, offset, register, session],
	);
}
