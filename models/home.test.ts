import { createHash } from "node:crypto";
import type { Home, Role } from "@/models/home";
import {
	emailHash,
	homeNameError,
	isEmailAddress,
	isLastOwner,
	maxHomeNameLength,
	membersOf,
	ownerCount,
} from "@/models/home";

function home(overrides: Partial<Home> = {}): Home {
	return {
		id: "home-1",
		name: "Huset",
		members: { "uid-a": "owner", "uid-b": "member" },
		memberProfiles: {
			"uid-a": { displayName: "Marcus", photoURL: null },
			"uid-b": { displayName: "Nadia", photoURL: null },
		},
		memberEmailHashes: {},
		createdAt: null,
		createdBy: "uid-a",
		...overrides,
	};
}

describe("emailHash", () => {
	/**
	 * The contract this function exists to keep. `firestore.rules` hashes
	 * `request.auth.token.email.lower()`, and the token carries whatever case
	 * Google sent — so a case-sensitive hash would leave an invitee unable to
	 * find an invitation that is sitting right there.
	 */
	it("is case-insensitive", () => {
		expect(emailHash("Nadia@Example.com")).toBe(emailHash("nadia@example.com"));
	});

	it("ignores surrounding whitespace, which a paste brings along", () => {
		expect(emailHash("  nadia@example.com \n")).toBe(
			emailHash("nadia@example.com"),
		);
	});

	// Same vector `tests/rules/helpers.ts` computes, computed the same way. If
	// these two ever disagree the invite is addressed to a hash nobody queries.
	it("matches the hash the rule tests compute", () => {
		const address = "Invitee@Example.com";

		expect(emailHash(address)).toBe(
			createHash("sha256").update(address.toLowerCase()).digest("hex"),
		);
	});

	it("distinguishes two addresses", () => {
		expect(emailHash("a@example.com")).not.toBe(emailHash("b@example.com"));
	});
});

describe("homeNameError", () => {
	it("accepts an ordinary name", () => {
		expect(homeNameError("Stugan")).toBeNull();
	});

	it.each([
		["empty", ""],
		["only whitespace", "   "],
	])("rejects a name that is %s", (_label, name) => {
		expect(homeNameError(name)).toBe("homes.nameRequired");
	});

	it("accepts a name of exactly the maximum length", () => {
		expect(homeNameError("a".repeat(maxHomeNameLength))).toBeNull();
	});

	it("rejects one character more", () => {
		expect(homeNameError("a".repeat(maxHomeNameLength + 1))).toBe(
			"homes.nameTooLong",
		);
	});

	it("measures the trimmed name, as the rules do not", () => {
		// Trailing spaces are not what makes a name too long, and the value that
		// is written is trimmed — so the message must not fire on whitespace.
		expect(homeNameError(`${"a".repeat(maxHomeNameLength)}    `)).toBeNull();
	});
});

describe("isEmailAddress", () => {
	it.each([
		"nadia@example.com",
		"a.b+c@sub.example.co.uk",
		" x@y.zz ",
	])("accepts %p", (value) => {
		expect(isEmailAddress(value)).toBe(true);
	});

	it.each([
		"",
		"nadia",
		"nadia@example",
		"@example.com",
		"a b@example.com",
	])("rejects %p", (value) => {
		expect(isEmailAddress(value)).toBe(false);
	});
});

describe("membersOf", () => {
	it("puts owners first, then sorts by name", () => {
		const rows = membersOf(
			home({
				members: {
					"uid-c": "member",
					"uid-a": "owner",
					"uid-b": "member",
				},
				memberProfiles: {
					"uid-a": { displayName: "Marcus", photoURL: null },
					"uid-b": { displayName: "Nadia", photoURL: null },
					"uid-c": { displayName: "Ingrid", photoURL: null },
				},
			}),
		);

		expect(rows.map((row) => row.uid)).toEqual(["uid-a", "uid-c", "uid-b"]);
	});

	it("keeps a member who has no profile yet", () => {
		const rows = membersOf(home({ memberProfiles: {} }));

		expect(rows).toHaveLength(2);
		expect(rows[0].displayName).toBe("");
	});

	it("carries the photo through", () => {
		const rows = membersOf(
			home({
				memberProfiles: {
					"uid-a": { displayName: "Marcus", photoURL: "https://x/p.jpg" },
					"uid-b": { displayName: "Nadia", photoURL: null },
				},
			}),
		);

		expect(rows[0].photoURL).toBe("https://x/p.jpg");
	});

	it("orders identically named people stably", () => {
		const rows = membersOf(
			home({
				members: { "uid-z": "member", "uid-a": "member" },
				memberProfiles: {
					"uid-z": { displayName: "Sam", photoURL: null },
					"uid-a": { displayName: "Sam", photoURL: null },
				},
			}),
		);

		expect(rows.map((row) => row.uid)).toEqual(["uid-a", "uid-z"]);
	});
});

describe("the last owner", () => {
	const members = (value: Record<string, Role>) => value;

	it("counts owners", () => {
		expect(ownerCount(members({ a: "owner", b: "member", c: "owner" }))).toBe(
			2,
		);
		expect(ownerCount(members({ b: "member" }))).toBe(0);
	});

	it("is the sole owner of a home", () => {
		expect(isLastOwner(home(), "uid-a")).toBe(true);
	});

	it("is not a member, however alone they are", () => {
		expect(isLastOwner(home(), "uid-b")).toBe(false);
	});

	it("is nobody once there are two owners", () => {
		const two = home({ members: { "uid-a": "owner", "uid-b": "owner" } });

		expect(isLastOwner(two, "uid-a")).toBe(false);
		expect(isLastOwner(two, "uid-b")).toBe(false);
	});
});
