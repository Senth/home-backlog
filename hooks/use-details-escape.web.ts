import { useEffect } from "react";

export function useDetailsEscape(active: boolean, onClose: () => void) {
	useEffect(() => {
		if (!active) return;
		const close = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (
				Array.from(document.querySelectorAll('[role="menuitem"]')).some(
					(item) =>
						item.getClientRects().length > 0 &&
						getComputedStyle(item).pointerEvents !== "none",
				)
			)
				return;
			event.preventDefault();
			onClose();
		};
		window.addEventListener("keydown", close);
		return () => window.removeEventListener("keydown", close);
	}, [active, onClose]);
}
