export const installOfferKey = "home-backlog.installOffer.dismissed";

export function decodeInstallOfferDismissed(raw: string | null): boolean {
	if (raw === null) return false;
	try {
		return JSON.parse(raw) === true;
	} catch {
		return false;
	}
}
