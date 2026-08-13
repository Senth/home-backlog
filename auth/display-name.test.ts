import { displayLabel, initials } from "@/auth/display-name";

describe("initials", () => {
	it("takes both ends of a two-word name", () => {
		expect(initials({ displayName: "Marcus Lindqvist" })).toBe("ML");
	});

	it("gives a single letter for a one-word name", () => {
		expect(initials({ displayName: "Marcus" })).toBe("M");
	});

	it("skips the middle name rather than showing three letters", () => {
		expect(initials({ displayName: "Anna Maria Berg" })).toBe("AB");
	});

	it("handles a non-Latin name", () => {
		expect(initials({ displayName: "Åsa" })).toBe("Å");
	});

	it("falls back to the email local part when the display name is empty", () => {
		expect(initials({ displayName: "", email: "marcus@example.com" })).toBe(
			"M",
		);
	});

	it("never returns an empty string", () => {
		expect(initials({ displayName: null, email: null })).toBe("?");
		expect(initials(null)).toBe("?");
	});
});

describe("displayLabel", () => {
	it("prefers the display name", () => {
		expect(
			displayLabel({ displayName: "Marcus Lindqvist", email: "m@example.com" }),
		).toBe("Marcus Lindqvist");
	});

	it("uses the email local part when there is no display name", () => {
		expect(
			displayLabel({ displayName: "  ", email: "marcus@example.com" }),
		).toBe("marcus");
	});

	it("is empty when the user is", () => {
		expect(displayLabel(null)).toBe("");
	});
});
