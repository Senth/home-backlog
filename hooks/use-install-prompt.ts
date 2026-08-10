// Native variant of use-install-prompt.web.ts. Native apps are installed by
// the store, so there is never a prompt to offer.
export function useInstallPrompt() {
	return { canInstall: false, promptInstall: async () => {} };
}
