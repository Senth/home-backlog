import {
	decodeInstallOfferDismissed,
	installOfferKey,
} from "@/models/install-offer";

describe("installOfferKey", () => {
	it("names the device-local dismissed offer", () => {
		expect(installOfferKey).toBe("home-backlog.installOffer.dismissed");
	});
});

describe("decodeInstallOfferDismissed", () => {
	it("accepts only a stored true value", () => {
		expect(decodeInstallOfferDismissed("true")).toBe(true);
		expect(decodeInstallOfferDismissed(null)).toBe(false);
		expect(decodeInstallOfferDismissed("false")).toBe(false);
		expect(decodeInstallOfferDismissed('"true"')).toBe(false);
		expect(decodeInstallOfferDismissed("not json")).toBe(false);
	});
});
