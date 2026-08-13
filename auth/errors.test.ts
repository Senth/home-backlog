import { mapAuthError } from "@/auth/errors";

describe("mapAuthError", () => {
	it("names the one failure the user can fix", () => {
		expect(mapAuthError({ code: "auth/network-request-failed" })).toBe(
			"error.offline",
		);
	});

	it("falls back to try-again for anything else", () => {
		expect(mapAuthError({ code: "auth/popup-blocked" })).toBe(
			"error.googleSignIn",
		);
		expect(mapAuthError(new Error("boom"))).toBe("error.googleSignIn");
		expect(mapAuthError("auth/network-request-failed")).toBe(
			"error.googleSignIn",
		);
		expect(mapAuthError(null)).toBe("error.googleSignIn");
	});
});
