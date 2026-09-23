import { type RefObject, useEffect, useRef } from "react";
import type { View } from "react-native";

/**
 * Everything inside a modal that a Tab can land on.
 *
 * `[tabindex="-1"]` is excluded deliberately: it is how the modal surface
 * itself is made focusable without joining the tab order.
 */
const FOCUSABLE = [
	"a[href]",
	"button:not([disabled])",
	"input:not([disabled])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	'[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * How long the opening focus is guarded, in frames.
 *
 * It is not just "wait for the modal to mount". Whatever opened the dialog is
 * usually closing at the same time — a Paper `Menu` restores focus to its own
 * anchor as it animates out — so focus has to be taken back for as long as that
 * lasts, not once.
 */
const guardFrames = 40;

function byTestID(testID: string): HTMLElement | null {
	return document.querySelector<HTMLElement>(`[data-testid="${testID}"]`);
}

/**
 * React Native Web hands back the DOM node as the `View` ref, which the React
 * Native types have no way to say.
 */
function domNode(ref: RefObject<View | null>): HTMLElement | null {
	const node = ref.current as unknown;
	return node instanceof HTMLElement ? node : null;
}

function visibleFocusable(root: HTMLElement): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
		// Not `offsetParent`, which is null for anything inside a
		// `position: fixed` ancestor — and a modal is exactly that.
		(element) => element.getClientRects().length > 0,
	);
}

interface ModalFocusOptions {
	/**
	 * The element that should get focus back when the modal closes, usually
	 * whatever opens it. Needed because the control that was focused when the
	 * modal opened is often a menu item that no longer exists by the time it
	 * closes, and focusing a detached node silently drops focus on `<body>`.
	 *
	 * A ref rather than a `testID`: `@react-navigation/bottom-tabs` keeps every
	 * visited tab mounted, so three app bars — and three identical `testID`s —
	 * are in the DOM at once, and a `querySelector` returns the first one, which
	 * belongs to a screen that is `display: none`. Focusing that drops focus on
	 * `<body>`, which is the failure this option exists to prevent.
	 */
	returnFocusTo?: RefObject<View | null>;
	/**
	 * What the scrim behind the dialog is called, translated.
	 *
	 * Paper's `Dialog` hard-codes its `Modal`'s `overlayAccessibilityLabel` to
	 * the English "Close modal" and offers no prop to reach it — `Menu` takes
	 * one, `Dialog` does not. So a Swedish screen-reader user got "Close modal"
	 * mid-sentence on every dialog in the app. Paper marks the scrim
	 * `importantForAccessibility: "no"`, which React Native Web does not
	 * translate into `aria-hidden`, so it is announced regardless.
	 *
	 * Relabelled here rather than by forking `AppDialog` onto Paper's `Modal`:
	 * this hook already reaches into the portal DOM by `testID`, and rebuilding
	 * the dialog surface would restyle every dialog in the app to fix a word.
	 *
	 * Its own `testID`, because the one this hook is given is the *surface* and
	 * Paper hangs the two off the same root: `${id}-surface`, `${id}-backdrop`.
	 */
	scrim?: { testID: string; label: string };
}

/**
 * While `active`, a Tab cannot leave the surface named by `testID`.
 *
 * Anything outside the surface — the tab bar behind a scrim, the board behind
 * an open menu — is pulled back in rather than allowed to take the focus, and
 * Tab and Shift+Tab wrap at the ends of the surface's own focusable items.
 *
 * Handles Tab only: Paper attaches its own Escape handler to `document`
 * inside `Menu.show()`, and a second one calling `preventDefault` would be
 * two components answering one key. This is the dialog's whole Tab behaviour
 * and the menus' only piece of focus management — a menu gets the trap but
 * not `useModalFocus`'s opening pull-in, which would draw a focus ring on the
 * first item for every pointer click.
 */
export function useTabTrap(active: boolean, testID: string): void {
	useEffect(() => {
		if (!active || typeof document === "undefined") return;

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Tab") return;

			const node = byTestID(testID);
			if (!node) return;
			const items = visibleFocusable(node);
			if (items.length === 0) return;

			const first = items[0];
			const last = items[items.length - 1];
			const focused = document.activeElement;

			if (!node.contains(focused)) {
				event.preventDefault();
				(event.shiftKey ? last : first).focus();
			} else if (event.shiftKey && focused === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && focused === last) {
				event.preventDefault();
				first.focus();
			}
		};

		document.addEventListener("keydown", onKeyDown, true);
		return () => document.removeEventListener("keydown", onKeyDown, true);
	}, [active, testID]);
}

/**
 * Focus management for a Paper `Modal` / `Dialog` on the web, which Paper does
 * not provide: it renders the surface into a Portal and leaves focus wherever
 * it was.
 *
 * Without this the sign-out confirmation is reachable only by tabbing *through*
 * the tab bar behind the scrim, Escape does nothing, and dismissing drops focus
 * on `<body>`. For a dialog whose whole purpose is to be a deliberate stop
 * before losing access, that is the dialog not doing its job.
 *
 * The modal itself is found by `testID`, which React Native Web renders as
 * `data-testid`, and which every container names uniquely — `${testID}-surface`.
 */
/**
 * The modals `useModalFocus` is currently managing, in mount order.
 *
 * Every open modal binds its own document-level Escape listener, so a dialog
 * mounted inside a sheet — `VisibilityField`'s `ConfirmDialog` under the
 * visibility sheet — would otherwise answer the same key as the sheet:
 * dismissing both layers and running both focus-returns. Only the stack's
 * topmost modal answers Escape; the one below waits its turn.
 */
const modalStack: symbol[] = [];

export function useModalFocus(
	visible: boolean,
	testID: string,
	onDismiss: () => void,
	{ returnFocusTo, scrim }: ModalFocusOptions = {},
) {
	// Kept in a ref so a new callback identity each render does not tear the
	// listener down and re-run the focus move. Written in an effect, not during
	// render: `app.json` turns the React Compiler on, and a ref mutation while
	// rendering is exactly what it is allowed to assume never happens.
	const dismiss = useRef(onDismiss);
	useEffect(() => {
		dismiss.current = onDismiss;
	});

	// Split into primitives so a fresh object literal each render does not tear
	// the listener down and re-run the focus move.
	const scrimTestID = scrim?.testID;
	const scrimLabel = scrim?.label;

	useTabTrap(visible, testID);

	useEffect(() => {
		if (!visible || typeof document === "undefined") return;

		const modal = Symbol();
		modalStack.push(modal);

		const opener = document.activeElement as HTMLElement | null;
		let frame = 0;
		let frames = 0;

		const pullFocusIn = () => {
			const node = byTestID(testID);
			if (node && !node.contains(document.activeElement)) {
				node.setAttribute("tabindex", "-1");
				(visibleFocusable(node)[0] ?? node).focus();
			}
			// Rides the same guard rather than taking an effect of its own: the
			// scrim is animated in, so it is not in the DOM on the first frame.
			if (scrimTestID !== undefined && scrimLabel !== undefined) {
				byTestID(scrimTestID)?.setAttribute("aria-label", scrimLabel);
			}
			if (++frames < guardFrames) frame = requestAnimationFrame(pullFocusIn);
		};
		frame = requestAnimationFrame(pullFocusIn);

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			// A modal opened from inside another modal is on top of it: one key
			// dismisses the top only, and the one below answers the next.
			if (modalStack[modalStack.length - 1] !== modal) return;
			event.preventDefault();
			dismiss.current();
		};

		document.addEventListener("keydown", onKeyDown, true);

		return () => {
			modalStack.splice(modalStack.indexOf(modal), 1);
			cancelAnimationFrame(frame);
			document.removeEventListener("keydown", onKeyDown, true);
			// Back to whatever opened the dialog, so a keyboard user is not
			// dropped at the top of the document.
			//
			// Not the referenced node itself: Paper's `Button` forwards its ref to
			// the outer `Surface` and keeps the pressable on a private
			// `touchableRef`, so focusing the ref lands on a plain `div` with no
			// tabindex — which drops focus on `<body>`, the exact failure this is
			// here to prevent. The first focusable *inside* it is the control.
			const referenced = returnFocusTo ? domNode(returnFocusTo) : null;
			const back = referenced
				? (visibleFocusable(referenced)[0] ?? referenced)
				: null;
			(back ?? (opener?.isConnected ? opener : null))?.focus?.();
		};
	}, [visible, testID, returnFocusTo, scrimTestID, scrimLabel]);
}
