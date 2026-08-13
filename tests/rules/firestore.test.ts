import {
	assertFails,
	assertSucceeds,
	type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
	collection,
	collectionGroup,
	deleteDoc,
	doc,
	FieldPath,
	getDoc,
	getDocs,
	query,
	setDoc,
	updateDoc,
	where,
} from "firebase/firestore";
import {
	createTestEnv,
	dbAnon,
	dbAs,
	emailHash,
	HOME_ID,
	hashesFor,
	homeDoc,
	INVITEE,
	inviteDoc,
	MEMBER,
	OUTSIDER,
	OWNER,
	ownerAndMember,
	profilesFor,
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
		await setDoc(doc(db, homePath), homeDoc(members));
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
			setDoc(doc(db, "homes/new-owned"), homeDoc({ [OWNER.uid]: "owner" })),
		);
		// Creating a home you are only a member of would leave it ownerless.
		await assertFails(
			setDoc(doc(db, "homes/new-member"), homeDoc({ [OWNER.uid]: "member" })),
		);
		// And you cannot hand a fresh home to somebody else.
		await assertFails(
			setDoc(doc(db, "homes/new-other"), homeDoc({ [MEMBER.uid]: "owner" })),
		);
	});

	it("refuses a home created with somebody else's address hash as its creator's", async () => {
		// Otherwise the "already a member?" check the invite form runs — which
		// compares a typed address against these hashes — could be made to
		// answer for an address its owner never gave anyone.
		await assertFails(
			setDoc(doc(dbAs(env, OWNER), "homes/new-liar"), {
				...homeDoc({ [OWNER.uid]: "owner" }),
				memberEmailHashes: { [OWNER.uid]: emailHash(MEMBER.email) },
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

	it("lets an owner rewrite membership", async () => {
		await seedHome();

		await assertSucceeds(
			updateDoc(doc(dbAs(env, OWNER), homePath), {
				members: { ...ownerAndMember(), [OUTSIDER.uid]: "member" },
			}),
		);
	});

	describe("the name", () => {
		it.each([
			["empty", ""],
			["over 60 characters", "x".repeat(61)],
			["not a string", 42],
		])("refuses a name that is %s, on create", async (_label, name) => {
			await assertFails(
				setDoc(doc(dbAs(env, OWNER), "homes/new-badname"), {
					...homeDoc({ [OWNER.uid]: "owner" }),
					name,
				}),
			);
		});

		it.each([
			["empty", ""],
			["over 60 characters", "x".repeat(61)],
		])("refuses a name that is %s, on update", async (_label, name) => {
			await seedHome();

			await assertFails(updateDoc(doc(dbAs(env, OWNER), homePath), { name }));
			await assertFails(updateDoc(doc(dbAs(env, MEMBER), homePath), { name }));
		});

		it("accepts exactly 60 characters", async () => {
			await seedHome();

			await assertSucceeds(
				updateDoc(doc(dbAs(env, OWNER), homePath), { name: "x".repeat(60) }),
			);
		});
	});

	describe("the last owner", () => {
		it("cannot be created away", async () => {
			await assertFails(
				setDoc(
					doc(dbAs(env, OWNER), "homes/new-ownerless"),
					homeDoc({ [OWNER.uid]: "member" }),
				),
			);
		});

		it("cannot demote themselves", async () => {
			await seedHome();

			await assertFails(
				updateDoc(doc(dbAs(env, OWNER), homePath), {
					members: { ...ownerAndMember(), [OWNER.uid]: "member" },
				}),
			);
		});

		it("cannot remove themselves and leave a member behind", async () => {
			await seedHome();

			await assertFails(
				updateDoc(doc(dbAs(env, OWNER), homePath), {
					members: { [MEMBER.uid]: "member" },
				}),
			);
		});

		it("cannot be removed by the other owner demoting themselves at the same time", async () => {
			await seedHome({ [OWNER.uid]: "owner", [MEMBER.uid]: "owner" });

			await assertFails(
				updateDoc(doc(dbAs(env, OWNER), homePath), {
					members: { [OWNER.uid]: "member", [MEMBER.uid]: "member" },
				}),
			);
		});

		it("may step down once somebody else is an owner", async () => {
			await seedHome({ [OWNER.uid]: "owner", [MEMBER.uid]: "owner" });

			await assertSucceeds(
				updateDoc(doc(dbAs(env, OWNER), homePath), {
					members: { [OWNER.uid]: "member", [MEMBER.uid]: "owner" },
				}),
			);
		});
	});

	describe("profiles and email hashes", () => {
		it("lets a member maintain their own profile entry", async () => {
			await seedHome();

			await assertSucceeds(
				updateDoc(doc(dbAs(env, MEMBER), homePath), {
					[`memberProfiles.${MEMBER.uid}`]: {
						displayName: "Nadia",
						photoURL: null,
					},
				}),
			);
		});

		it("does not let a member touch somebody else's", async () => {
			await seedHome();

			await assertFails(
				updateDoc(doc(dbAs(env, MEMBER), homePath), {
					[`memberProfiles.${OWNER.uid}`]: {
						displayName: "Not Marcus",
						photoURL: null,
					},
				}),
			);
			await assertFails(
				updateDoc(doc(dbAs(env, MEMBER), homePath), {
					[`memberEmailHashes.${OWNER.uid}`]: emailHash(OUTSIDER.email),
				}),
			);
		});

		it("lets an owner touch anyone's, because removing a member removes theirs", async () => {
			await seedHome();

			await assertSucceeds(
				updateDoc(doc(dbAs(env, OWNER), homePath), {
					members: { [OWNER.uid]: "owner" },
					memberProfiles: profilesFor({ [OWNER.uid]: "owner" }),
					memberEmailHashes: hashesFor({ [OWNER.uid]: "owner" }),
				}),
			);
		});

		it.each([
			["a member", MEMBER],
			["an owner", OWNER],
		])("does not let %s claim a hash that is not their own address", async (_label, user) => {
			await seedHome();

			await assertFails(
				updateDoc(doc(dbAs(env, user), homePath), {
					[`memberEmailHashes.${user.uid}`]: emailHash(OUTSIDER.email),
				}),
			);
		});
	});

	describe("delete", () => {
		it("is allowed to an owner who is the home's only member", async () => {
			await seedHome({ [OWNER.uid]: "owner" });

			await assertSucceeds(deleteDoc(doc(dbAs(env, OWNER), homePath)));
		});

		it("is refused while anyone else is still in the home", async () => {
			// Nodes, locations and recurring rules resolve membership through a
			// get() on this document, so deleting it strands them — permanently,
			// for everyone. Only a sole member may do that, and only to themselves.
			await seedHome();

			await assertFails(deleteDoc(doc(dbAs(env, OWNER), homePath)));
		});

		it("is refused to a member", async () => {
			await seedHome();

			await assertFails(deleteDoc(doc(dbAs(env, MEMBER), homePath)));
		});
	});

	describe("the homes-I-belong-to query", () => {
		it("returns my homes and is refused nobody else's", async () => {
			await seedHome();
			await seed(env, async (db) => {
				await setDoc(
					doc(db, "homes/other-home"),
					homeDoc({ [OUTSIDER.uid]: "owner" }),
				);
			});

			const mine = (uid: string, db: ReturnType<typeof dbAs>) =>
				getDocs(
					query(
						collection(db, "homes"),
						where(new FieldPath("members", uid), "in", ["owner", "member"]),
					),
				);

			// Provably safe: a home I am not in has no `members.<uid>` subfield, so
			// it cannot match, and everything that can match satisfies `get, list`.
			const result = await assertSucceeds(mine(MEMBER.uid, dbAs(env, MEMBER)));
			expect(result.docs.map((snapshot) => snapshot.id)).toEqual([HOME_ID]);

			// Asking for somebody else's homes matches documents I cannot read, and
			// Firestore rejects the whole query rather than filtering it.
			await assertFails(mine(OUTSIDER.uid, dbAs(env, MEMBER)));
		});
	});
});

describe("invites", () => {
	const invitePath = `${homePath}/invites/${emailHash(INVITEE.email)}`;

	async function seedInvite(role = "member") {
		await seedHome();
		await seed(env, async (db) => {
			await setDoc(doc(db, invitePath), inviteDoc(INVITEE.email, role));
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

	it("lets only an owner issue them, and only with a real role", async () => {
		await seedHome();
		const fresh = "fresh@example.com";
		const freshPath = `${homePath}/invites/${emailHash(fresh)}`;

		await assertFails(
			setDoc(doc(dbAs(env, MEMBER), freshPath), inviteDoc(fresh)),
		);
		await assertFails(
			setDoc(doc(dbAs(env, OWNER), freshPath), inviteDoc(fresh, "superuser")),
		);
		await assertSucceeds(
			setDoc(doc(dbAs(env, OWNER), freshPath), inviteDoc(fresh)),
		);
	});

	it("refuses an emailHash field that disagrees with the document id", async () => {
		// The collection-group query trusts the *field*. If the two could differ,
		// an owner could address an invite to one person and have it surface in
		// somebody else's pending list.
		await seedHome();
		const fresh = "fresh@example.com";
		const freshPath = `${homePath}/invites/${emailHash(fresh)}`;

		await assertFails(
			setDoc(doc(dbAs(env, OWNER), freshPath), {
				...inviteDoc(fresh),
				emailHash: emailHash(OUTSIDER.email),
			}),
		);

		await seed(env, async (db) => {
			await setDoc(doc(db, freshPath), inviteDoc(fresh));
		});
		await assertFails(
			updateDoc(doc(dbAs(env, OWNER), freshPath), {
				emailHash: emailHash(OUTSIDER.email),
			}),
		);
	});

	it("shows an invitee their own invite and no one else's", async () => {
		await seedInvite();
		const otherPath = `${homePath}/invites/${emailHash("other@example.com")}`;
		await seed(env, async (db) => {
			await setDoc(doc(db, otherPath), inviteDoc("other@example.com"));
		});

		const db = dbAs(env, INVITEE);
		await assertSucceeds(getDoc(doc(db, invitePath)));
		await assertFails(getDoc(doc(db, otherPath)));
	});

	it("lets an owner list a home's pending invitations, and not a member", async () => {
		// The manage screen renders the pending section only for an owner. For a
		// member some documents in the collection would be denied, and Firestore
		// rejects the entire query rather than filtering it.
		await seedInvite();

		await assertSucceeds(
			getDocs(collection(dbAs(env, OWNER), homePath, "invites")),
		);
		await assertFails(
			getDocs(collection(dbAs(env, MEMBER), homePath, "invites")),
		);
	});

	describe("the collection-group query", () => {
		async function seedTwoHomesInvitingTheInvitee() {
			await seed(env, async (db) => {
				for (const id of ["home-a", "home-b"]) {
					await setDoc(doc(db, "homes", id), homeDoc({ [OWNER.uid]: "owner" }));
					await setDoc(
						doc(db, "homes", id, "invites", emailHash(INVITEE.email)),
						inviteDoc(INVITEE.email),
					);
				}
			});
		}

		const myInvites = (db: ReturnType<typeof dbAs>, hash: string) =>
			getDocs(
				query(collectionGroup(db, "invites"), where("emailHash", "==", hash)),
			);

		it("finds an invitee their invitations across homes they cannot read", async () => {
			await seedTwoHomesInvitingTheInvitee();

			const result = await assertSucceeds(
				myInvites(dbAs(env, INVITEE), emailHash(INVITEE.email)),
			);

			expect(result.docs).toHaveLength(2);
			// The home id is only reachable through the invite's own path — the
			// invitee cannot read the home document that would name it.
			expect(
				result.docs.map((snapshot) => snapshot.ref.parent.parent?.id).sort(),
			).toEqual(["home-a", "home-b"]);
			await assertFails(getDoc(doc(dbAs(env, INVITEE), "homes/home-a")));
		});

		it("refuses a query for somebody else's hash", async () => {
			await seedTwoHomesInvitingTheInvitee();

			await assertFails(
				myInvites(dbAs(env, INVITEE), emailHash(OUTSIDER.email)),
			);
		});

		it("grants no write", async () => {
			// Reads widen to the collection group; writes stay on the nested rule,
			// where only an owner of that home can reach them.
			await seedTwoHomesInvitingTheInvitee();
			const path = `homes/home-a/invites/${emailHash(INVITEE.email)}`;

			await assertFails(
				setDoc(
					doc(dbAs(env, INVITEE), path),
					inviteDoc(INVITEE.email, "owner"),
				),
			);
			await assertFails(
				updateDoc(doc(dbAs(env, INVITEE), path), { role: "owner" }),
			);
			await assertFails(
				setDoc(
					doc(
						dbAs(env, INVITEE),
						`homes/home-a/invites/${emailHash(OUTSIDER.email)}`,
					),
					inviteDoc(OUTSIDER.email),
				),
			);
		});
	});
});

describe("invite acceptance", () => {
	const invitePath = `${homePath}/invites/${emailHash(INVITEE.email)}`;

	async function seedInvite(role = "member") {
		await seedHome();
		await seed(env, async (db) => {
			await setDoc(doc(db, invitePath), inviteDoc(INVITEE.email, role));
		});
	}

	/** What the app writes when someone taps Join: three dotted paths, no read. */
	function accept(
		db: ReturnType<typeof dbAs>,
		{
			uid = INVITEE.uid,
			role = "member",
			hash = emailHash(INVITEE.email),
		}: { uid?: string; role?: string; hash?: string } = {},
	) {
		return updateDoc(doc(db, homePath), {
			[`members.${uid}`]: role,
			[`memberProfiles.${uid}`]: { displayName: "Nadia", photoURL: null },
			[`memberEmailHashes.${uid}`]: hash,
		});
	}

	it("lets an invitee add exactly themselves with exactly the granted role", async () => {
		await seedInvite("member");

		await assertSucceeds(accept(dbAs(env, INVITEE)));
	});

	it("refuses a role the invite did not grant", async () => {
		await seedInvite("member");

		await assertFails(accept(dbAs(env, INVITEE), { role: "owner" }));
	});

	it("refuses adding anyone other than the invitee", async () => {
		await seedInvite("member");

		await assertFails(
			accept(dbAs(env, INVITEE), {
				uid: OUTSIDER.uid,
				hash: emailHash(OUTSIDER.email),
			}),
		);
	});

	it("refuses a hash that is not the invitee's own address", async () => {
		await seedInvite("member");

		await assertFails(
			accept(dbAs(env, INVITEE), { hash: emailHash(OUTSIDER.email) }),
		);
	});

	it("refuses an unverified email", async () => {
		await seedInvite("member");

		await assertFails(accept(dbAs(env, INVITEE, { emailVerified: false })));
	});

	it("refuses when there is no invite at all", async () => {
		await seedHome();

		await assertFails(accept(dbAs(env, INVITEE)));
	});

	it("refuses touching another member's profile on the way in", async () => {
		await seedInvite("member");

		await assertFails(
			updateDoc(doc(dbAs(env, INVITEE), homePath), {
				[`members.${INVITEE.uid}`]: "member",
				[`memberEmailHashes.${INVITEE.uid}`]: emailHash(INVITEE.email),
				[`memberProfiles.${OWNER.uid}`]: {
					displayName: "Hijacked",
					photoURL: null,
				},
			}),
		);
	});

	it("refuses a membership change smuggled in alongside another field", async () => {
		await seedInvite("member");

		await assertFails(
			updateDoc(doc(dbAs(env, INVITEE), homePath), {
				name: "Hijacked",
				[`members.${INVITEE.uid}`]: "member",
				[`memberEmailHashes.${INVITEE.uid}`]: emailHash(INVITEE.email),
			}),
		);
	});

	it("lets the invitee delete their own invite once consumed", async () => {
		await seedInvite("member");
		await accept(dbAs(env, INVITEE));

		await assertSucceeds(deleteDoc(doc(dbAs(env, INVITEE), invitePath)));
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
