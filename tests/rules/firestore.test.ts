import {
	assertFails,
	assertSucceeds,
	type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
	collection,
	collectionGroup,
	deleteDoc,
	deleteField,
	doc,
	FieldPath,
	getDoc,
	getDocs,
	orderBy,
	query,
	setDoc,
	updateDoc,
	where,
	writeBatch,
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
	NORDIC,
	nodeDoc,
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

	describe("leaving", () => {
		/** What the manage screen writes for "Leave this home". */
		function leave(db: ReturnType<typeof dbAs>, uid: string) {
			return updateDoc(doc(db, homePath), {
				[`members.${uid}`]: deleteField(),
				[`memberProfiles.${uid}`]: deleteField(),
				[`memberEmailHashes.${uid}`]: deleteField(),
			});
		}

		it("lets a member remove themselves", async () => {
			// The one membership change that is not an owner's to make. Without it
			// only owners could ever leave a home.
			await seedHome();

			await assertSucceeds(leave(dbAs(env, MEMBER), MEMBER.uid));
		});

		it("does not let them take somebody else with them", async () => {
			await seedHome();

			await assertFails(
				updateDoc(doc(dbAs(env, MEMBER), homePath), {
					[`members.${MEMBER.uid}`]: deleteField(),
					[`members.${OWNER.uid}`]: deleteField(),
				}),
			);
		});

		it("does not let them rename the home on the way out", async () => {
			await seedHome();

			await assertFails(
				updateDoc(doc(dbAs(env, MEMBER), homePath), {
					name: "Parting shot",
					[`members.${MEMBER.uid}`]: deleteField(),
				}),
			);
		});

		it("is not a way for a member to change their own role", async () => {
			// `leavesHome()` requires that you end up *gone*, not merely different —
			// otherwise the branch that lets you out would also let you promote
			// yourself on the way.
			await seedHome();

			await assertFails(
				updateDoc(doc(dbAs(env, MEMBER), homePath), {
					[`members.${MEMBER.uid}`]: "owner",
				}),
			);
		});

		it("traps the last owner until somebody else is one", async () => {
			await seedHome();

			await assertFails(leave(dbAs(env, OWNER), OWNER.uid));
		});

		it("lets an owner leave once there is a second one", async () => {
			await seedHome({ [OWNER.uid]: "owner", [MEMBER.uid]: "owner" });

			await assertSucceeds(leave(dbAs(env, OWNER), OWNER.uid));
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

	it("folds a non-ASCII address the same way the client does", async () => {
		// The rules hash `request.auth.token.email.lower()` (CEL) and the client
		// hashes `email.toLowerCase()` (JavaScript). Everything ASCII agrees; this
		// is the case that would fail quietly, for Swedish addresses only, with an
		// invitee who can never find an invitation that was really sent.
		await seedHome();
		const path = `${homePath}/invites/${emailHash(NORDIC.email)}`;
		await seed(env, async (db) => {
			await setDoc(doc(db, path), inviteDoc(NORDIC.email));
		});

		await assertSucceeds(getDoc(doc(dbAs(env, NORDIC), path)));
		await assertSucceeds(
			getDocs(
				query(
					collectionGroup(dbAs(env, NORDIC), "invites"),
					where("emailHash", "==", emailHash(NORDIC.email)),
				),
			),
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
	const nodesPath = `${homePath}/nodes`;
	const sharedPath = `${nodesPath}/shared-node`;
	const privatePath = `${nodesPath}/private-node`;

	/** Creating a node the way the app does: every field, with a value. */
	function create(
		db: ReturnType<typeof dbAs>,
		id: string,
		overrides: Record<string, unknown> = {},
	) {
		return setDoc(doc(db, nodesPath, id), nodeDoc(overrides));
	}

	async function seedNodes() {
		await seedHome();
		await seed(env, async (db) => {
			await setDoc(doc(db, sharedPath), nodeDoc());
			await setDoc(
				doc(db, privatePath),
				nodeDoc({
					title: "Birthday surprise",
					visibility: "private",
					participantIds: [OWNER.uid],
				}),
			);
		});
	}

	describe("visibility", () => {
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

			// Writing yourself out of your own private node would strand the
			// document where nobody can read or delete it.
			await assertFails(
				create(db, "orphan", { visibility: "private", participantIds: [] }),
			);
			await assertSucceeds(
				create(db, "mine", {
					visibility: "private",
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

	describe("the field set", () => {
		beforeEach(seedHome);

		it("accepts a node with every field written", async () => {
			await assertSucceeds(create(dbAs(env, MEMBER), "valid"));
		});

		it.each([
			"title",
			"status",
			"rank",
			"archived",
			"completedAt",
			"createdAt",
		])("refuses a node with no %s", async (field) => {
			const data = nodeDoc();
			delete data[field];

			await assertFails(
				setDoc(doc(dbAs(env, MEMBER), nodesPath, "incomplete"), data),
			);
		});

		it.each([
			["empty", ""],
			["over 200 characters", "x".repeat(201)],
			["not a string", 42],
		])("refuses a title that is %s", async (_label, title) => {
			await assertFails(create(dbAs(env, MEMBER), "bad-title", { title }));
		});

		it("accepts a title of exactly 200 characters", async () => {
			await assertSucceeds(
				create(dbAs(env, MEMBER), "long-title", { title: "x".repeat(200) }),
			);
		});

		it.each([
			["status", "in_progress"],
			["priority", "critical"],
			["effort", "a fortnight"],
			["visibility", "secret"],
		])("refuses a %s outside its enum", async (field, value) => {
			await assertFails(
				create(dbAs(env, MEMBER), "bad-enum", {
					[field]: value,
					// A private-looking node still has to be readable by its author,
					// so the visibility case fails on the enum and nothing else.
					participantIds: [MEMBER.uid],
				}),
			);
		});

		it.each([
			"2026-9-1",
			"01/09/2026",
			"not a date",
			"2026-09-30T00:00:00Z",
		])("refuses a dueDate of %s", async (dueDate) => {
			await assertFails(create(dbAs(env, MEMBER), "bad-date", { dueDate }));
		});

		it("accepts a dueDate that is a calendar day", async () => {
			await assertSucceeds(
				create(dbAs(env, MEMBER), "dated", { dueDate: "2026-09-30" }),
			);
		});

		it("refuses notes over 10 000 characters", async () => {
			await assertFails(
				create(dbAs(env, MEMBER), "wordy", { notes: "x".repeat(10001) }),
			);
			await assertSucceeds(
				create(dbAs(env, MEMBER), "long-notes", { notes: "x".repeat(10000) }),
			);
		});

		it("refuses a checklist over 200 items", async () => {
			const item = (index: number) => ({
				id: `c${index}`,
				text: "Buy brackets",
				done: false,
			});

			await assertFails(
				create(dbAs(env, MEMBER), "listy", {
					checklist: Array.from({ length: 201 }, (_value, index) =>
						item(index),
					),
				}),
			);
		});

		it("refuses more than 50 photos", async () => {
			const photo = (index: number) => ({
				id: `p${index}`,
				path: `homes/${HOME_ID}/nodes/snappy/p${index}.jpg`,
				uploadedAt: new Date("2026-01-01T00:00:00Z"),
				uploadedBy: MEMBER.uid,
			});

			await assertFails(
				create(dbAs(env, MEMBER), "snappy", {
					photos: Array.from({ length: 51 }, (_value, index) => photo(index)),
				}),
			);
		});

		it("keeps status and completedAt in agreement, both ways", async () => {
			// A completion date is not reconstructible after the fact, and deriving
			// it from updatedAt is wrong the moment anyone edits a finished node.
			await assertFails(
				create(dbAs(env, MEMBER), "done-undated", {
					status: "done",
					completedAt: null,
				}),
			);
			await assertFails(
				create(dbAs(env, MEMBER), "dated-undone", {
					status: "execution",
					completedAt: new Date("2026-01-01T00:00:00Z"),
				}),
			);
			await assertSucceeds(
				create(dbAs(env, MEMBER), "finished", {
					status: "done",
					completedAt: new Date("2026-01-01T00:00:00Z"),
				}),
			);
		});

		it("refuses changing createdAt or createdBy after the fact", async () => {
			await seedNodes();
			const db = dbAs(env, MEMBER);

			await assertFails(
				updateDoc(doc(db, sharedPath), {
					createdAt: new Date("2026-06-01T00:00:00Z"),
				}),
			);
			await assertFails(
				updateDoc(doc(db, sharedPath), { createdBy: MEMBER.uid }),
			);
			await assertSucceeds(
				updateDoc(doc(db, sharedPath), { title: "Fix the gutter, properly" }),
			);
		});
	});

	describe("the ancestor path", () => {
		beforeEach(async () => {
			await seedHome();
			await seed(env, async (db) => {
				await setDoc(doc(db, nodesPath, "project"), nodeDoc());
			});
		});

		it("is empty on a root node", async () => {
			const db = dbAs(env, MEMBER);

			await assertFails(
				create(db, "rootish", { parentId: null, ancestorIds: ["project"] }),
			);
			await assertSucceeds(
				create(db, "root", { parentId: null, ancestorIds: [] }),
			);
		});

		it("ends in the node's own parentId", async () => {
			const db = dbAs(env, MEMBER);

			await assertFails(
				create(db, "task", { parentId: "project", ancestorIds: [] }),
			);
			await assertFails(
				create(db, "task", { parentId: "project", ancestorIds: ["somewhere"] }),
			);
			await assertSucceeds(
				create(db, "task", { parentId: "project", ancestorIds: ["project"] }),
			);
		});

		it("never contains the node itself", async () => {
			// A node that is its own ancestor is a cycle: its subtree query returns
			// it, and every walk of the tree from it never terminates.
			await assertFails(
				create(dbAs(env, MEMBER), "loop", {
					parentId: "project",
					ancestorIds: ["loop", "project"],
				}),
			);
		});
	});

	describe("inherited privacy", () => {
		beforeEach(async () => {
			await seedHome();
			await seed(env, async (db) => {
				await setDoc(doc(db, nodesPath, "project"), nodeDoc());
				await setDoc(
					doc(db, nodesPath, "surprise"),
					nodeDoc({
						title: "Birthday surprise",
						visibility: "private",
						participantIds: [OWNER.uid, MEMBER.uid],
					}),
				);
			});
		});

		function child(
			db: ReturnType<typeof dbAs>,
			id: string,
			parentId: string,
			overrides: Record<string, unknown> = {},
		) {
			return create(db, id, {
				parentId,
				ancestorIds: [parentId],
				...overrides,
			});
		}

		it("refuses a private child under a shared parent", async () => {
			// The restriction this buys: a private card cannot live inside a shared
			// project. Without it nobody but its participants could ever *find* the
			// card again, so a reparent would strand it and a delete would orphan it.
			await assertFails(
				child(dbAs(env, MEMBER), "hidden", "project", {
					visibility: "private",
					participantIds: [MEMBER.uid],
				}),
			);
		});

		it("refuses a shared child under a private parent", async () => {
			await assertFails(
				child(dbAs(env, MEMBER), "leak", "surprise", { visibility: "shared" }),
			);
		});

		it("refuses a private child missing one of its parent's participants", async () => {
			await assertFails(
				child(dbAs(env, MEMBER), "narrower", "surprise", {
					visibility: "private",
					participantIds: [MEMBER.uid],
				}),
			);
		});

		it("allows a private child that adds a participant of its own", async () => {
			await assertSucceeds(
				child(dbAs(env, MEMBER), "wider", "surprise", {
					visibility: "private",
					participantIds: [OWNER.uid, MEMBER.uid, OUTSIDER.uid],
				}),
			);
		});

		it("allows a shared child under a shared parent", async () => {
			await assertSucceeds(child(dbAs(env, MEMBER), "task", "project"));
		});

		it("refuses a child of a parent that does not exist", async () => {
			// Bulk subtree create (#7) must therefore write top-down, one document
			// at a time — which is exactly the constraint that keeps a batch from
			// creating a private child under a parent the rules cannot yet see.
			await assertFails(child(dbAs(env, MEMBER), "orphan", "no-such-node"));
		});
	});

	describe("a reparent in one batch", () => {
		/**
		 * The proof that splitting the two invariants was necessary. A rule's
		 * get() reads *committed* state and cannot see the rest of a batch, so
		 * `ancestorIds` is validated structurally and privacy through a get() on a
		 * parent that the batch does not touch. Both hold here, in one commit.
		 */
		it("moves a node and rewrites its descendants at once", async () => {
			await seedHome();
			await seed(env, async (db) => {
				await setDoc(doc(db, nodesPath, "old-home"), nodeDoc());
				await setDoc(doc(db, nodesPath, "new-home"), nodeDoc());
				await setDoc(
					doc(db, nodesPath, "moved"),
					nodeDoc({ parentId: "old-home", ancestorIds: ["old-home"] }),
				);
				await setDoc(
					doc(db, nodesPath, "child"),
					nodeDoc({ parentId: "moved", ancestorIds: ["old-home", "moved"] }),
				);
				await setDoc(
					doc(db, nodesPath, "grandchild"),
					nodeDoc({
						parentId: "child",
						ancestorIds: ["old-home", "moved", "child"],
					}),
				);
			});

			const db = dbAs(env, MEMBER);
			const batch = writeBatch(db);
			batch.update(doc(db, nodesPath, "moved"), {
				parentId: "new-home",
				ancestorIds: ["new-home"],
			});
			batch.update(doc(db, nodesPath, "child"), {
				ancestorIds: ["new-home", "moved"],
			});
			batch.update(doc(db, nodesPath, "grandchild"), {
				ancestorIds: ["new-home", "moved", "child"],
			});

			await assertSucceeds(batch.commit());
		});
	});

	describe("the board queries", () => {
		beforeEach(async () => {
			await seedHome();
			await seed(env, async (db) => {
				await setDoc(doc(db, nodesPath, "project"), nodeDoc());
				await setDoc(
					doc(db, nodesPath, "surprise"),
					nodeDoc({
						visibility: "private",
						participantIds: [OWNER.uid],
						rank: "a1",
					}),
				);
			});
		});

		const board = (db: ReturnType<typeof dbAs>) =>
			collection(db, nodesPath) as ReturnType<typeof collection>;

		it("runs the shared half of a board load", async () => {
			// Q1. Provably safe: `visibility == 'shared'` is the read rule's first
			// disjunct, so no matching document can be denied.
			const result = await assertSucceeds(
				getDocs(
					query(
						board(dbAs(env, MEMBER)),
						where("archived", "==", false),
						where("parentId", "==", null),
						where("visibility", "==", "shared"),
						orderBy("rank"),
					),
				),
			);

			expect(result.docs.map((snapshot) => snapshot.id)).toEqual(["project"]);
		});

		it("runs the participating half of a board load", async () => {
			// Q2, the rule's second disjunct. Returns the private nodes I am in —
			// and any shared one I also participate in, which is why the client
			// dedupes the two results by id.
			const result = await assertSucceeds(
				getDocs(
					query(
						board(dbAs(env, OWNER)),
						where("archived", "==", false),
						where("parentId", "==", null),
						where("participantIds", "array-contains", OWNER.uid),
						orderBy("rank"),
					),
				),
			);

			expect(result.docs.map((snapshot) => snapshot.id)).toEqual(["surprise"]);
		});

		it("refuses an unconstrained list of the collection", async () => {
			// What makes the two-query shape necessary rather than stylistic: this
			// query matches a private node the member cannot read, and Firestore
			// rejects the whole query rather than filtering it.
			await assertFails(getDocs(board(dbAs(env, MEMBER))));
		});

		it("runs a shared subtree read, and refuses it unconstrained", async () => {
			const subtree = (db: ReturnType<typeof dbAs>, constrained: boolean) =>
				getDocs(
					constrained
						? query(
								board(db),
								where("visibility", "==", "shared"),
								where("ancestorIds", "array-contains", "project"),
							)
						: query(
								board(db),
								where("ancestorIds", "array-contains", "project"),
							),
				);

			await assertSucceeds(subtree(dbAs(env, MEMBER), true));
			await assertFails(subtree(dbAs(env, MEMBER), false));
		});

		it("runs a private subtree read as a participant", async () => {
			// The second array-contains is not expressible, so the ancestor test is
			// client-side. Bounded by how many private nodes one person is in.
			await assertSucceeds(
				getDocs(
					query(
						board(dbAs(env, OWNER)),
						where("participantIds", "array-contains", OWNER.uid),
					),
				),
			);
		});
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
