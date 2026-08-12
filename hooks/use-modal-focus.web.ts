import { useEffect, useRef } from "react";

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

function visibleFocusable(root: HTMLElement): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
		// Not `offsetParent`, which is null for anything inside a
		// `position: fixed` ancestor — and a modal is exactly that.
		(element) => element.getClientRects().length > 0,
	);
}

interface ModalFocusOptions {
	/**
	 * `testID` of the element that should get focus back when the modal closes,
	 * usually whatever opens it. Needed because the control that was focused
	 * when the modal opened is often a menu item that no longer exists by the
	 * time it closes, and focusing a detached node silently drops focus on
	 * `<body>`.
	 */
	returnFocusTo?: string;
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
 * Elements are found by `testID`, which React Native Web renders as
 * `data-testid`.
 */
export function useModalFocus(
	visible: boolean,
	testID: string,
	onDismiss: () => void,
	{ returnFocusTo }: ModalFocusOptions = {},
) {
	// Kept in a ref so a new callback identity each render does not tear the
	// listener down and re-run the focus move.
	const dismiss = useRef(onDismiss);
	dismiss.current = onDismiss;

	useEffect(() => {
		if (!visible || typeof document === "undefined") return;

		const opener = document.activeElement as HTMLElement | null;
		let frame = 0;
		let frames = 0;

		const pullFocusIn = () => {
			const node = byTestID(testID);
			if (node && !node.contains(document.activeElement)) {
				node.setAttribute("tabindex", "-1");
				(visibleFocusable(node)[0] ?? node).focus();
			}
			if (++frames < guardFrames) frame = requestAnimationFrame(pullFocusIn);
		};
		frame = requestAnimationFrame(pullFocusIn);

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				dismiss.current();
				return;
			}
			if (event.key !== "Tab") return;

			const node = byTestID(testID);
			if (!node) return;
			const items = visibleFocusable(node);
			if (items.length === 0) return;

			const first = items[0];
			const last = items[items.length - 1];
			const active = document.activeElement;

			// Anything outside the dialog — the tab bar behind the scrim — is
			// pulled back in rather than allowed to take the focus.
			if (!node.contains(active)) {
				event.preventDefault();
				(event.shiftKey ? last : first).focus();
			} else if (event.shiftKey && active === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && active === last) {
				event.preventDefault();
				first.focus();
			}
		};

		document.addEventListener("keydown", onKeyDown, true);

		return () => {
			cancelAnimationFrame(frame);
			document.removeEventListener("keydown", onKeyDown, true);
			// Back to whatever opened the dialog, so a keyboard user is not
			// dropped at the top of the document.
			const back = returnFocusTo ? byTestID(returnFocusTo) : null;
			(back ?? (opener?.isConnected ? opener : null))?.focus?.();
		};
	}, [visible, testID, returnFocusTo]);
}
