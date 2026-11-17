import { useSyncExternalStore } from "react";

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

let deferred: BeforeInstallPromptEvent | null = null;
const subscribers = new Set<() => void>();

function notify() {
	for (const subscriber of subscribers) subscriber();
}

function clear() {
	deferred = null;
	notify();
}

if (typeof window !== "undefined") {
	window.addEventListener("beforeinstallprompt", (event) => {
		event.preventDefault();
		deferred = event as BeforeInstallPromptEvent;
		notify();
	});
	window.addEventListener("appinstalled", clear);
}

function subscribe(subscriber: () => void) {
	subscribers.add(subscriber);
	return () => {
		subscribers.delete(subscriber);
	};
}

const getSnapshot = () => deferred !== null;
const getServerSnapshot = () => false;

async function promptInstall() {
	const event = deferred;
	if (!event) return;
	await event.prompt();
	await event.userChoice;
	clear();
}

/**
 * Captures Chrome's `beforeinstallprompt` so the offer can be made at a moment
 * that makes sense, instead of by the browser's own mini-infobar.
 *
 * Safari and Firefox never fire it, so `canInstall` simply stays false there —
 * those users install through the browser menu.
 */
export function useInstallPrompt(): InstallPromptState {
	const canInstall = useSyncExternalStore(
		subscribe,
		getSnapshot,
		getServerSnapshot,
	);
	return { canInstall, promptInstall };
}
