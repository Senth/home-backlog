import { createHash } from "node:crypto";
import type { Home, Role } from "@/models/home";
import {
	emailHash,
	homeNameError,
	inviteProblem,
	isEmailAddress,
	isLastOwner,
	maxHomeNameLength,
	membersOf,
	normalizeEmail,
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
		labels: [],
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
	it("is case-insensitive for ASCII", () => {
		expect(emailHash("Nadia@Example.com")).toBe(emailHash("nadia@example.com"));
	});

	/**
	 * And deliberately *not* for anything else. CEL's `lower()` leaves non-ASCII
	 * letters alone, and this function may only fold what the rule folds: the
	 * rules compare their hash of your token email against the entry you wrote,
	 * so a client that folded further would be refused its own
	 * `memberEmailHashes` entry — locking a user out of creating or joining any
	 * home at all. `normalizeEmail` is where a typed address gets folded instead.
	 */
	it("leaves non-ASCII case alone, exactly as CEL's lower() does", () => {
		expect(emailHash("MÄRTA@exempel.se")).not.toBe(
			emailHash("märta@exempel.se"),
		);
		expect(emailHash("MÄRTA@exempel.se")).toBe(emailHash("mÄRTA@exempel.se"));
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

describe("normalizeEmail", () => {
	it("folds what a person typed, non-ASCII included", () => {
		// The half `emailHash` may not do: an owner typing "Märta@Exempel.se" has
		// to reach an invitee whose Google address is `märta@exempel.se`.
		expect(normalizeEmail("  MÄRTA@Exempel.SE ")).toBe("märta@exempel.se");
	});

	it("leaves an already-normal address untouched", () => {
		expect(normalizeEmail("nadia@example.com")).toBe("nadia@example.com");
	});

	it("composes with emailHash to reach a lowercase address", () => {
		expect(emailHash(normalizeEmail("MÄRTA@Exempel.se"))).toBe(
			emailHash("märta@exempel.se"),
		);
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
	it.each(["nadia@example.com", "a.b+c@sub.example.co.uk", " x@y.zz "])(
		"accepts %p",
		(value) => {
			expect(isEmailAddress(value)).toBe(true);
		},
	);

	it.each(["", "nadia", "nadia@example", "@example.com", "a b@example.com"])(
		"rejects %p",
		(value) => {
			expect(isEmailAddress(value)).toBe(false);
		},
	);
});

describe("inviteProblem", () => {
	const marcus = "marcus@example.com";
	const nadia = "nadia@example.com";
	const ingrid = "ingrid@example.com";

	const villa = home({
		memberEmailHashes: {
			"uid-a": emailHash(marcus),
			"uid-b": emailHash(nadia),
		},
	});

	const check = (address: string, invited: string[] = []) =>
		inviteProblem(address, villa, "uid-a", invited.map(emailHash));

	it("accepts somebody who is not here yet", () => {
		expect(check(ingrid)).toBeNull();
	});

	it("rejects an address that is not one", () => {
		expect(check("ingrid")).toEqual({ key: "invite.invalidEmail" });
	});

	it("recognizes your own address before it recognizes a member's", () => {
		// You are also a member, and "you are already in this home" answers a
		// question nobody asked.
		expect(check(marcus)).toEqual({ key: "invite.selfError" });
	});

	it("names the member who already has that address", () => {
		expect(check(nadia)).toEqual({
			key: "invite.alreadyMember",
			name: "Nadia",
		});
	});

	it("falls back to the typed address for a member with no profile yet", () => {
		const bare = home({
			memberProfiles: {},
			memberEmailHashes: { "uid-b": emailHash(nadia) },
		});

		expect(inviteProblem(nadia, bare, "uid-a", [])).toEqual({
			key: "invite.alreadyMember",
			name: nadia,
		});
	});

	it("rejects an address that has already been invited", () => {
		expect(check(ingrid, [ingrid])).toEqual({ key: "invite.alreadyInvited" });
	});

	it("is case- and whitespace-insensitive, as the hash is", () => {
		expect(check("  Nadia@Example.COM ")).toEqual({
			key: "invite.alreadyMember",
			name: "Nadia",
		});
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
