import { useEffect, useRef } from "react";
import { View } from "react-native";
import type {
	DragAreaProps,
	DragPoint,
} from "@/components/board/DragArea.types";
import { holdMs, holdSlop, pointerSlop } from "@/models/drag";

/**
 * How long after a drop a stray click is still assumed to belong to the drag.
 *
 * Not a gesture timing — the gesture is over — but a browser one: the click a
 * mouse sends after the button comes up arrives a frame or two later. Long
 * enough to catch it, short enough that nobody's next real tap falls inside it.
 */
const clickGuardMs = 400;

/**
 * Web drag input: DOM events, by hand.
 *
 * **Not `react-native-gesture-handler`, and not for want of trying.** Its web
 * implementation — like every gesture library's — stops the browser scrolling
 * by writing `touch-action: none` on the view the gesture is attached to. On
 * this board the cards *are* the column, so that is a column that will not
 * scroll, and `PERSONAS.md` has Ingrid doing more scrolling than anyone in the
 * app. Native is `DragArea.tsx`, where the gesture handler arbitrates with the
 * scroll view properly and none of this applies.
 *
 * The two inputs are deliberately not the same gesture:
 *
 * - **Touch** arms on a press that stays still for `holdMs`. Any movement past
 *   `holdSlop` before the hold completes is a scroll, and cannot become a drag
 *   afterwards however long the finger stays down.
 * - **A pointer** arms on `pointerSlop` pixels of movement with the button
 *   down, and never waits. A mouse that pauses before a card moves reads as
 *   lag.
 *
 * ### What a browser will not let you have
 *
 * A browser decides whether a touch belongs to a scroll from `touch-action` **as
 * the finger lands**, and never looks again. A card therefore cannot ask for the
 * touch back half a second later: `preventDefault()` on the first move is
 * already too late, holding the scrollers still is too late, and setting
 * `touch-action` at that point is ignored. Chrome takes the pointer away with a
 * `pointercancel` and the card dies in mid-air. All three were measured, in this
 * app, in this order.
 *
 * So the browser is allowed to win, and the drag survives it:
 *
 * 1. When the card lifts, every scrolling ancestor is **held still**, so the
 *    pan the browser thinks it is doing moves nothing. The board is frozen for
 *    the duration of the drag anyway.
 * 2. `pointercancel` on a touch is **not** the end of the drag. Pointer events
 *    stop; *touch* events keep coming, and the finger is still on the card. The
 *    drag reads those instead, and ends on `touchend`.
 *
 * The cost is one class of failure — a browser that fires neither — against the
 * alternative, which is a board nobody can scroll.
 */
export function DragArea({
	enabled = true,
	onGrab,
	onMove,
	onDrop,
	onCancel,
	children,
}: DragAreaProps) {
	const host = useRef<View | null>(null);

	// The callbacks change identity on every render of the board — a card
	// arriving from another member is enough — and re-attaching the listeners
	// mid-drag would throw away the arming state they close over. The listeners
	// are attached once and read the current callbacks from here.
	const handlers = useRef({ onGrab, onMove, onDrop, onCancel });
	handlers.current = { onGrab, onMove, onDrop, onCancel };

	useEffect(() => {
		const node = host.current as unknown as HTMLElement | null;
		if (node === null || !enabled) return;

		let pointer: number | null = null;
		let start: DragPoint | null = null;
		let armed = false;
		/** A scroll. Once this is set the press can never become a drag. */
		let refused = false;
		let hold: ReturnType<typeof setTimeout> | null = null;

		const cancelHold = () => {
			if (hold !== null) clearTimeout(hold);
			hold = null;
		};

		/* --- holding the scrollers still ------------------------------------ */

		const locked: { element: HTMLElement; overflow: string }[] = [];

		const lockScrollers = () => {
			const candidates: HTMLElement[] = [document.documentElement];
			for (let at = node.parentElement; at !== null; at = at.parentElement) {
				candidates.push(at);
			}
			for (const element of candidates) {
				const style = window.getComputedStyle(element);
				if (!/auto|scroll/.test(style.overflowY + style.overflowX)) continue;
				locked.push({ element, overflow: element.style.overflow });
				element.style.overflow = "hidden";
			}
		};

		const unlockScrollers = () => {
			for (const held of locked) held.element.style.overflow = held.overflow;
			locked.length = 0;
		};

		/**
		 * Everything after the press begins is tracked on the **document**, not on
		 * the card.
		 *
		 * Below `compactBreakpoint` a card held at the screen edge walks the board
		 * to the next pane — and that unmounts the column the card came from,
		 * card and all. Listeners living on the card would go with it, mid-flight,
		 * and the drag would freeze with a card stuck to the screen. The document
		 * outlives every pane.
		 */
		const trackingOn = () => {
			document.addEventListener("pointermove", move, true);
			document.addEventListener("pointerup", up, true);
			document.addEventListener("pointercancel", cancel, true);
		};

		const trackingOff = () => {
			document.removeEventListener("pointermove", move, true);
			document.removeEventListener("pointerup", up, true);
			document.removeEventListener("pointercancel", cancel, true);
		};

		/* --- the press that opens the card ---------------------------------- */

		/**
		 * The click the browser sends after a drag would open the card that was
		 * just moved. Swallowed at the document, because by then the element the
		 * press started on may not be in the tree at all — and only for as long as
		 * such a click could still arrive, since a listener left in place would
		 * eat somebody's next real tap.
		 */
		const swallowClick = (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
		};

		const swallowNextClick = () => {
			document.addEventListener("click", swallowClick, true);
			setTimeout(
				() => document.removeEventListener("click", swallowClick, true),
				clickGuardMs,
			);
		};

		/**
		 * React Native Web recognises a press through its *responder* system,
		 * which listens on `document` for the mouse and touch events the browser
		 * sends alongside pointer events. Held here, in the capture phase, so it
		 * never reaches that system while a card is up — otherwise the release
		 * reads as a tap on the card that was just carried across the board.
		 *
		 * `touchmove` and `touchend` are also the drag's own fallback once the
		 * browser has taken the pointer away, which is why this does the work
		 * rather than only blocking.
		 */
		const shielded = [
			"mousedown",
			"mousemove",
			"mouseup",
			"touchstart",
			"touchmove",
			"touchend",
			"touchcancel",
		];

		const shield = (event: Event) => {
			event.stopPropagation();
			if (!armed) return;

			const touch =
				"changedTouches" in event
					? (event as TouchEvent).changedTouches[0]
					: undefined;
			if (touch === undefined) return;

			const point = { x: touch.clientX, y: touch.clientY };
			if (event.type === "touchmove") {
				handlers.current.onMove(point);
			} else if (event.type === "touchend") {
				handlers.current.onDrop(point);
				swallowNextClick();
				release();
			} else if (event.type === "touchcancel") {
				handlers.current.onCancel();
				release();
			}
		};

		const shieldOn = () => {
			for (const type of shielded) {
				document.addEventListener(type, shield, true);
			}
		};

		const shieldOff = () => {
			for (const type of shielded) {
				document.removeEventListener(type, shield, true);
			}
		};

		/* --- the gesture ----------------------------------------------------- */

		const arm = (point: DragPoint, type: string) => {
			cancelHold();
			armed = true;
			lockScrollers();

			// The press this card was already negotiating is *ended* rather than
			// released, which is the responder system's own word for "the pointer
			// was taken away" — exactly a tap that never happened.
			//
			// Before the shield, not after: `touchcancel` is one of the events the
			// shield holds at the document, so a shield already in place would
			// swallow this on its way and the press would never be called off.
			node.dispatchEvent(
				new Event(type === "mouse" ? "dragstart" : "touchcancel", {
					bubbles: true,
				}),
			);

			shieldOn();

			handlers.current.onGrab(point);
		};

		const release = () => {
			unlockScrollers();
			shieldOff();
			trackingOff();
			pointer = null;
			start = null;
			armed = false;
			refused = false;
			cancelHold();
		};

		const down = (event: PointerEvent) => {
			// One finger. A second one on the same card is somebody pinching to
			// zoom, and the browser owns that.
			if (pointer !== null) {
				if (armed) handlers.current.onCancel();
				release();
				return;
			}
			if (event.pointerType === "mouse" && event.button !== 0) return;

			pointer = event.pointerId;
			start = { x: event.clientX, y: event.clientY };
			armed = false;
			refused = false;
			trackingOn();

			if (event.pointerType !== "mouse") {
				const from = start;
				const type = event.pointerType;
				hold = setTimeout(() => arm(from, type), holdMs);
			}
		};

		const move = (event: PointerEvent) => {
			if (pointer !== event.pointerId || start === null) return;
			const point = { x: event.clientX, y: event.clientY };

			if (armed) {
				handlers.current.onMove(point);
				return;
			}
			if (refused) return;

			const travelled = Math.hypot(point.x - start.x, point.y - start.y);
			if (event.pointerType === "mouse") {
				if (travelled > pointerSlop) arm(point, event.pointerType);
			} else if (travelled > holdSlop) {
				// The scroll it was always going to be.
				refused = true;
				cancelHold();
			}
		};

		const up = (event: PointerEvent) => {
			if (pointer !== event.pointerId) return;
			if (armed) {
				handlers.current.onDrop({ x: event.clientX, y: event.clientY });
				swallowNextClick();
			}
			release();
		};

		/**
		 * The browser deciding the touch was a pan. On touch that is not the end
		 * of anything — the finger has not moved off the card, and `shield` picks
		 * the drag up from the touch events. On a mouse there is no such stream,
		 * so the card goes home.
		 */
		const cancel = (event: PointerEvent) => {
			if (pointer !== event.pointerId) return;
			if (event.pointerType !== "mouse" && armed) return;
			if (armed) handlers.current.onCancel();
			release();
		};

		/** The long-press callout on iOS is exactly the gesture that lifts a card. */
		const contextMenu = (event: Event) => {
			if (armed || hold !== null) event.preventDefault();
		};

		// Both set here rather than through a style prop: neither is in React
		// Native's `ViewStyle`, and this file is the web by definition. The
		// selection is what a slow press on a card otherwise starts — and it
		// survives the drop, so the card lands with its title highlighted.
		node.style.setProperty("-webkit-touch-callout", "none");
		node.style.setProperty("user-select", "none");
		node.style.setProperty("-webkit-user-select", "none");
		node.addEventListener("pointerdown", down);
		node.addEventListener("contextmenu", contextMenu);

		return () => {
			node.removeEventListener("pointerdown", down);
			node.removeEventListener("contextmenu", contextMenu);
			// A card really in flight goes home rather than hanging: this only runs
			// when the card itself is gone — deleted under you, or the board left
			// behind — because the pane an edge hold walks away from deliberately
			// stays mounted for exactly this reason.
			if (armed) handlers.current.onCancel();
			document.removeEventListener("click", swallowClick, true);
			release();
		};
	}, [enabled]);

	return <View ref={host}>{children}</View>;
}
