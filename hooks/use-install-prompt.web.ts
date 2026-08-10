import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface InstallPromptState {
	/** The browser has offered an install prompt we can replay. */
	canInstall: boolean;
	/** Replays the captured prompt. No-op if there is none. */
	promptInstall: () => Promise<void>;
}

/**
 * Captures Chrome's `beforeinstallprompt` so the offer can be made at a moment
 * that makes sense, instead of by the browser's own mini-infobar.
 *
 * Safari and Firefox never fire it, so `canInstall` simply stays false there —
 * those users install through the browser menu.
 */
export function useInstallPrompt(): InstallPromptState {
	const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
		null,
	);

	useEffect(() => {
		if (typeof window === "undefined") return;

		const capture = (event: Event) => {
			event.preventDefault();
			setDeferred(event as BeforeInstallPromptEvent);
		};
		const clear = () => setDeferred(null);

		window.addEventListener("beforeinstallprompt", capture);
		window.addEventListener("appinstalled", clear);

		return () => {
			window.removeEventListener("beforeinstallprompt", capture);
			window.removeEventListener("appinstalled", clear);
		};
	}, []);

	const promptInstall = useCallback(async () => {
		if (!deferred) return;
		await deferred.prompt();
		await deferred.userChoice;
		// The event is single-use, accepted or dismissed.
		setDeferred(null);
	}, [deferred]);

	return { canInstall: deferred !== null, promptInstall };
}
