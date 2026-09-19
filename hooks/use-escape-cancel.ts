import { useEffect } from "react";
import { BackHandler } from "react-native";

/**
 * Cancels on the platform's back gesture — Android's hardware back. The web
 * half of this hook (`use-escape-cancel.web.ts`) answers Escape instead, the
 * way Paper's dialogs do.
 *
 * Returning `true` consumes the event: the back press cancels the move rather
 * than leaving the screen with a half-written mode on it.
 */
export function useEscapeCancel(active: boolean, onCancel: () => void): void {
	useEffect(() => {
		if (!active) return;
		const subscription = BackHandler.addEventListener(
			"hardwareBackPress",
			() => {
				onCancel();
				return true;
			},
		);
		return () => subscription.remove();
	}, [active, onCancel]);
}
