import { useCallback, useEffect, useRef, useState } from "react";

interface ServiceWorkerState {
	/** A new build is installed and waiting to take over. */
	updateReady: boolean;
	/** Tells the waiting worker to activate, then reloads. */
	applyUpdate: () => void;
}

/**
 * Registers `/sw.js` and reports when a newer build is waiting.
 *
 * The update is never applied silently: swapping the shell under a user who is
 * mid-edit loses their typing. `UpdateBanner` surfaces it and they choose.
 */
export function useServiceWorker(): ServiceWorkerState {
	const [updateReady, setUpdateReady] = useState(false);
	const waiting = useRef<ServiceWorker | null>(null);

	useEffect(() => {
		if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
			return;
		}

		let cancelled = false;

		const track = (registration: ServiceWorkerRegistration) => {
			if (registration.waiting) {
				waiting.current = registration.waiting;
				if (!cancelled) setUpdateReady(true);
			}

			registration.addEventListener("updatefound", () => {
				const installing = registration.installing;
				if (!installing) return;

				installing.addEventListener("statechange", () => {
					// `controller` is null on the very first install — that is a
					// fresh visit, not an update, and must not raise the banner.
					if (
						installing.state === "installed" &&
						navigator.serviceWorker.controller
					) {
						waiting.current = installing;
						if (!cancelled) setUpdateReady(true);
					}
				});
			});
		};

		navigator.serviceWorker
			.register("/sw.js")
			.then(track)
			.catch((error) => {
				console.warn("Service worker registration failed:", error);
			});

		return () => {
			cancelled = true;
		};
	}, []);

	const applyUpdate = useCallback(() => {
		waiting.current?.postMessage({ type: "SKIP_WAITING" });
		// `controllerchange` fires once the new worker takes over; reloading
		// before that would just re-serve the old shell.
		navigator.serviceWorker.addEventListener(
			"controllerchange",
			() => window.location.reload(),
			{ once: true },
		);
	}, []);

	return { updateReady, applyUpdate };
}
