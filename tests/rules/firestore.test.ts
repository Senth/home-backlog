import {
	assertFails,
	assertSucceeds,
	type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import {
	createTestEnv,
	dbAnon,
	dbAs,
	emailHash,
	HOME_ID,
	INVITEE,
	MEMBER,
	OUTSIDER,
	OWNER,
	ownerAndMember,
	seed,
} from "./helpers";

let env: RulesTestEnvironment;

beforeAll(async () => {
	env = await createTestEnv();
});

afterAll(async () => {
	await env.cleanup();
});

beforeEach(async () => {
	await env.clearFirestore();
});

const homePath = `homes/${HOME_ID}`;

async function seedHome(members: Record<string, string> = ownerAndMember()) {
	await seed(env, async (db) => {
		await setDoc(doc(db, homePath), { name: "Home", members });
	});
}

describe("homes/{homeId}", () => {
	it("is readable by a member and nobody else", async () => {
		await seedHome();

		await assertSucceeds(getDoc(doc(dbAs(env, MEMBER), homePath)));
		await assertFails(getDoc(doc(dbAs(env, OUTSIDER), homePath)));
		await assertFails(getDoc(doc(dbAnon(env), homePath)));
	});

	it("can be created only by a signed-in user who names themselves owner", async () => {
		const db = dbAs(env, OWNER);

		await assertSucceeds(
			setDoc(doc(db, "homes/new-owned"), {
				name: "New",
				members: { [OWNER.uid]: "owner" },
			}),
		);
		// Creating a home you are only a member of would leave it ownerless.
		await assertFails(
			setDoc(doc(db, "homes/new-member"), {
				name: "New",
				members: { [OWNER.uid]: "member" },
			}),
		);
		// And you cannot hand a fresh home to somebody else.
		await assertFails(
			setDoc(doc(db, "homes/new-other"), {
				name: "New",
				members: { [MEMBER.uid]: "owner" },
			}),
		);
	});

	it("lets a member edit the home but never its membership", async () => {
		await seedHome();
		const db = dbAs(env, MEMBER);

		await assertSucceeds(updateDoc(doc(db, homePath), { name: "Renamed" }));
		await assertFails(
			updateDoc(doc(db, homePath), {
				members: { ...ownerAndMember(), [OUTSIDER.uid]: "member" },
			}),
		);
		// Not even a self-promotion.
		await assertFails(
			updateDoc(doc(db, homePath), {
				members: { ...ownerAndMember(), [MEMBER.uid]: "owner" },
			}),
		);
	});

	it("lets an owner rewrite membership and delete the home", async () => {
		await seedHome();
		const db = dbAs(env, OWNER);

		await assertSucceeds(
			updateDoc(doc(db, homePath), {
				members: { ...ownerAndMember(), [OUTSIDER.uid]: "member" },
			}),
		);
		await assertSucceeds(deleteDoc(doc(db, homePath)));
	});

	it("does not let a member delete the home", async () => {
		await seedHome();
		await assertFails(deleteDoc(doc(dbAs(env, MEMBER), homePath)));
	});
});

describe("invite acceptance", () => {
	const invitePath = `${homePath}/invites/${emailHash(INVITEE.email)}`;

	async function seedInvite(role = "member") {
		await seedHome();
		await seed(env, async (db) => {
			await setDoc(doc(db, invitePath), { role });
		});
	}

	it("hashes the email case-insensitively", async () => {
		// The invite doc id is built from the lowercased address while the token
		// carries whatever case the provider sent. A case-sensitive hash would
		// make the invite unfindable, which is why this is asserted at all.
		expect(emailHash(INVITEE.email)).toBe(
			emailHash(INVITEE.email.toLowerCase()),
		);
	});

	it("lets an invitee add exactly themselves with exactly the granted role", async () => {
		await seedInvite("member");

		await assertSucceeds(
			updateDoc(doc(dbAs(env, INVITEE), homePath), {
				members: { ...ownerAndMember(), [INVITEE.uid]: "member" },
			}),
		);
	});

	it("refuses a role the invite did not grant", async () => {
		await seedInvite("member");

		await assertFails(
			updateDoc(doc(dbAs(env, INVITEE), homePath), {
				members: { ...ownerAndMember(), [INVITEE.uid]: "owner" },
			}),
		);
	});

	it("refuses adding anyone other than the invitee", async () => {
		await seedInvite("member");

		await assertFails(
			updateDoc(doc(dbAs(env, INVITEE), homePath), {
				members: { ...ownerAndMember(), [OUTSIDER.uid]: "member" },
			}),
		);
	});

	it("refuses an unverified email", async () => {
		await seedInvite("member");

		await assertFails(
			updateDoc(doc(dbAs(env, INVITEE, { emailVerified: false }), homePath), {
				members: { ...ownerAndMember(), [INVITEE.uid]: "member" },
			}),
		);
	});

	it("refuses when there is no invite at all", async () => {
		await seedHome();

		await assertFails(
			updateDoc(doc(dbAs(env, INVITEE), homePath), {
				members: { ...ownerAndMember(), [INVITEE.uid]: "member" },
			}),
		);
	});

	it("refuses a membership change smuggled in alongside another field", async () => {
		await seedInvite("member");

		await assertFails(
			updateDoc(doc(dbAs(env, INVITEE), homePath), {
				name: "Hijacked",
				members: { ...ownerAndMember(), [INVITEE.uid]: "member" },
			}),
		);
	});

	it("shows an invitee their own invite and no one else's", async () => {
		await seedInvite("member");
		const otherPath = `${homePath}/invites/${emailHash("other@example.com")}`;
		await seed(env, async (db) => {
			await setDoc(doc(db, otherPath), { role: "member" });
		});

		const db = dbAs(env, INVITEE);
		await assertSucceeds(getDoc(doc(db, invitePath)));
		await assertFails(getDoc(doc(db, otherPath)));
	});

	it("lets only an owner issue invites, and only with a real role", async () => {
		await seedHome();
		const newInvite = `${homePath}/invites/${emailHash("fresh@example.com")}`;

		await assertFails(
			setDoc(doc(dbAs(env, MEMBER), newInvite), { role: "member" }),
		);
		await assertFails(
			setDoc(doc(dbAs(env, OWNER), newInvite), { role: "superuser" }),
		);
		await assertSucceeds(
			setDoc(doc(dbAs(env, OWNER), newInvite), { role: "member" }),
		);
	});
});

describe("homes/{homeId}/nodes", () => {
	const sharedPath = `${homePath}/nodes/shared-node`;
	const privatePath = `${homePath}/nodes/private-node`;

	async function seedNodes() {
		await seedHome();
		await seed(env, async (db) => {
			await setDoc(doc(db, sharedPath), {
				title: "Fix the gutter",
				visibility: "shared",
				participantIds: [],
			});
			await setDoc(doc(db, privatePath), {
				title: "Birthday surprise",
				visibility: "private",
				participantIds: [OWNER.uid],
			});
		});
	}

	it("lets any member read a shared node", async () => {
		await seedNodes();
		await assertSucceeds(getDoc(doc(dbAs(env, MEMBER), sharedPath)));
	});

	it("hides a private node from a member who is not a participant", async () => {
		await seedNodes();
		await assertFails(getDoc(doc(dbAs(env, MEMBER), privatePath)));
	});

	it("shows a private node to its participant", async () => {
		await seedNodes();
		await assertSucceeds(getDoc(doc(dbAs(env, OWNER), privatePath)));
	});

	it("hides everything from a non-member", async () => {
		await seedNodes();
		const db = dbAs(env, OUTSIDER);
		await assertFails(getDoc(doc(db, sharedPath)));
		await assertFails(getDoc(doc(db, privatePath)));
	});

	it("refuses a private node its own author could not read back", async () => {
		await seedHome();
		const db = dbAs(env, MEMBER);

		// Writing yourself out of your own private node would strand the document
		// where nobody can read or delete it.
		await assertFails(
			setDoc(doc(db, `${homePath}/nodes/orphan`), {
				title: "Orphan",
				visibility: "private",
				participantIds: [],
			}),
		);
		await assertSucceeds(
			setDoc(doc(db, `${homePath}/nodes/mine`), {
				title: "Mine",
				visibility: "private",
				participantIds: [MEMBER.uid],
			}),
		);
	});

	it("refuses a visibility outside the enum", async () => {
		await seedHome();
		await assertFails(
			setDoc(doc(dbAs(env, MEMBER), `${homePath}/nodes/weird`), {
				title: "Weird",
				visibility: "secret",
				participantIds: [MEMBER.uid],
			}),
		);
	});

	it("refuses stranding a private node by clearing its participants", async () => {
		await seedNodes();
		await assertFails(
			updateDoc(doc(dbAs(env, OWNER), privatePath), { participantIds: [] }),
		);
	});

	it("does not let a non-participant delete a private node", async () => {
		await seedNodes();
		await assertFails(deleteDoc(doc(dbAs(env, MEMBER), privatePath)));
	});
});

describe("homes/{homeId}/locations and /recurring", () => {
	it.each(["locations", "recurring"])("%s is member-only", async (name) => {
		await seedHome();
		const path = `${homePath}/${name}/item-1`;

		await assertSucceeds(
			setDoc(doc(dbAs(env, MEMBER), path), { name: "Basement" }),
		);
		await assertFails(
			setDoc(doc(dbAs(env, OUTSIDER), path), { name: "Basement" }),
		);
		await assertFails(getDoc(doc(dbAs(env, OUTSIDER), path)));
		await assertFails(getDoc(doc(dbAnon(env), path)));
	});
});
