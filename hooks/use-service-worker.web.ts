import { useCallback, useEffect, useState } from "react";
import { buildId } from "@/utils/build-info";
import {
	buildFromHtml,
	isStale,
	type ReloadDecision,
	reloadDecision,
} from "@/utils/shell-freshness";

/** Auto-reload is safe only while nothing can be lost: the swap lands while
 *  the splash is still the whole screen. Past it, the update banner asks. */
const BOOT_WINDOW_MS = 10_000;
/** Set before reloading, read by `reloadDecision`: a flapping connection must
 *  not reload in a loop. */
const RELOADED_KEY = "shell-reloaded";

interface ServiceWorkerState {
	/** The shell on the wire is a different build than the running one. */
	updateReady: boolean;
	/** Reloads onto the deployed build. */
	applyUpdate: () => void;
}

/**
 * Registers `/sw.js` and compares the shell on the wire against the running
 * build, once at boot, again whenever the network returns, and when a new
 * worker claims the page. A stale shell is acted on through
 * `reloadDecision`: reload itself inside the boot window, offer `UpdateBanner`
 * after it.
 *
 * The check runs whatever made the shell stale — the worker is only one of
 * the things that can, so nothing here talks to it. A failed check is
 * silence: launching with no network is the normal case this hook exists for,
 * and the `online` event below is its way back.
 */
export function useServiceWorker(): ServiceWorkerState {
	const [updateReady, setUpdateReady] = useState(false);

	useEffect(() => {
		if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
			return;
		}

		let cancelled = false;
		const bootedAt = Date.now();

		navigator.serviceWorker.register("/sw.js").catch((error) => {
			console.warn("Service worker registration failed:", error);
		});

		const decide = (): ReloadDecision =>
			reloadDecision({
				msSinceBoot: Date.now() - bootedAt,
				bootWindowMs: BOOT_WINDOW_MS,
				alreadyReloaded: sessionStorage.getItem(RELOADED_KEY) !== null,
			});

		const act = (decision: ReloadDecision) => {
			if (decision === "reload") {
				sessionStorage.setItem(RELOADED_KEY, "1");
				window.location.reload();
				return;
			}
			if (decision === "prompt" && !cancelled) setUpdateReady(true);
		};

		const checkShell = async () => {
			try {
				const response = await fetch("/", { cache: "no-store" });
				const fetched = buildFromHtml(await response.text());
				if (!isStale(fetched, buildId)) return;
				act(decide());
			} catch {
				// No network at boot is the expected case; nothing to do until
				// the `online` event fires.
			}
		};

		void checkShell();
		window.addEventListener("online", checkShell);

		// A new worker claiming the page is the same signal by other means:
		// what it will serve on the next boot may be newer than this shell.
		const onControllerChange = () => void checkShell();
		navigator.serviceWorker.addEventListener(
			"controllerchange",
			onControllerChange,
		);

		return () => {
			cancelled = true;
			window.removeEventListener("online", checkShell);
			navigator.serviceWorker.removeEventListener(
				"controllerchange",
				onControllerChange,
			);
		};
	}, []);

	const applyUpdate = useCallback(() => {
		window.location.reload();
	}, []);

	return { updateReady, applyUpdate };
}
