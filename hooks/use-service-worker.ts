// Native variant of use-service-worker.web.ts. Native has no service worker.
export function useServiceWorker() {
	return { updateReady: false, applyUpdate: () => {} };
}
