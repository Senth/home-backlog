import { useEffect } from "react";

/**
 * Cancels on Escape — the same key every dialog in the app answers, heard at
 * the document the way `use-modal-focus.web.ts` hears it. Native answers the
 * hardware back button instead (`use-escape-cancel.ts`).
 */
export function useEscapeCancel(active: boolean, onCancel: () => void): void {
	useEffect(() => {
		if (!active) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			onCancel();
		};
		document.addEventListener("keydown", onKeyDown, true);
		return () => document.removeEventListener("keydown", onKeyDown, true);
	}, [active, onCancel]);
}
