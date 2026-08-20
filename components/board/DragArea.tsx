import { useMemo, useRef } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { DragAreaProps } from "@/components/board/DragArea.types";
import { holdMs } from "@/models/drag";

/**
 * Native drag input: one `Pan` from `react-native-gesture-handler`.
 *
 * Native is the easy half. The gesture handler arbitrates with the scroll view
 * the cards sit in, so `activateAfterLongPress` is the whole of the touch
 * rule — a press that stays still for `holdMs` lifts the card, and a press that
 * moves first scrolls the column and never becomes a drag. Web cannot do this
 * and is a separate file; see `DragArea.web.tsx` for why.
 *
 * `runOnJS` because everything the callbacks touch — the board's frozen order,
 * the measured geometry, the write — is ordinary React state on the JS thread.
 * A worklet would have to hop back for every one of them.
 */
export function DragArea({
	enabled = true,
	onGrab,
	onMove,
	onDrop,
	onCancel,
	children,
}: DragAreaProps) {
	// Rebuilt only when the gesture is turned on or off: the callbacks change
	// identity on every render of the board, and a gesture rebuilt mid-drag
	// loses the drag.
	const handlers = useRef({ onGrab, onMove, onDrop, onCancel });
	handlers.current = { onGrab, onMove, onDrop, onCancel };

	const pan = useMemo(
		() =>
			Gesture.Pan()
				.enabled(enabled)
				.runOnJS(true)
				.activateAfterLongPress(holdMs)
				.onStart((event) =>
					handlers.current.onGrab({ x: event.absoluteX, y: event.absoluteY }),
				)
				.onUpdate((event) =>
					handlers.current.onMove({ x: event.absoluteX, y: event.absoluteY }),
				)
				.onEnd((event, success) => {
					if (success) {
						handlers.current.onDrop({ x: event.absoluteX, y: event.absoluteY });
					} else {
						handlers.current.onCancel();
					}
				}),
		[enabled],
	);

	return (
		<GestureDetector gesture={pan}>
			<View>{children}</View>
		</GestureDetector>
	);
}
