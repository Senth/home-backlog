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
	increment,
	limit,
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
} from "@/tests/rules/helpers";

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

	it("takes addToAllProjects only as a bool", async () => {
		// The invitee reads this field and writes every shared root from it, so a
		// string here would be a truthy "yes" that nobody meant to tick.
		await seedHome();
		const fresh = "fresh@example.com";
		const freshPath = `${homePath}/invites/${emailHash(fresh)}`;
		const db = dbAs(env, OWNER);

		await assertFails(
			setDoc(doc(db, freshPath), {
				...inviteDoc(fresh),
				addToAllProjects: "yes",
			}),
		);
		await assertSucceeds(
			setDoc(doc(db, freshPath), {
				...inviteDoc(fresh),
				addToAllProjects: true,
			}),
		);
		// Absent is how every invitation written before #102 looks, and it reads
		// as off rather than as a document the owner can no longer edit.
		await assertSucceeds(setDoc(doc(db, freshPath), inviteDoc(fresh)));
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

		/**
		 * A card somebody else deleted while you were standing on its board. The
		 * screen has to be *told* it is gone so it can say so and bounce you up;
		 * reading a field off a null `resource` is an evaluation error, which
		 * denies the read and leaves a listener with a raw permission failure to
		 * log instead of a fact to act on.
		 */
		it("answers a member reading a node that is not there", async () => {
			await seedNodes();
			const snapshot = await assertSucceeds(
				getDoc(doc(dbAs(env, MEMBER), nodesPath, "never-existed")),
			);

			expect(snapshot.exists()).toBe(false);
		});

		it("still tells a non-member nothing, missing or not", async () => {
			await seedNodes();
			await assertFails(
				getDoc(doc(dbAs(env, OUTSIDER), nodesPath, "never-existed")),
			);
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
			"columns",
			"childCount",
			"doneCount",
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

		it("refuses a completedAt that is not a timestamp", async () => {
			// The agreement check alone is satisfied by any non-null value, and a
			// string typed as a Timestamp throws on the first .toDate() (#54).
			await assertFails(
				create(dbAs(env, MEMBER), "done-string", {
					status: "done",
					completedAt: "yesterday",
				}),
			);
		});

		/**
		 * `blocked` was in this enum and is not any more. A card is in exactly one
		 * status, so parking it in Blocked destroys the stage it was in — being
		 * blocked is a condition `blockedBy[]` carries, not a stage of work.
		 */
		it("refuses the status that used to exist", async () => {
			await assertFails(
				create(dbAs(env, MEMBER), "parked", { status: "blocked" }),
			);
		});

		/**
		 * The three stage columns #99 removed. Production was migrated before this
		 * list shrank, so nothing stored holds one — and a client that still writes
		 * one is writing a column no board draws.
		 */
		it.each([
			"research",
			"planning",
			"review",
		])("refuses the retired stage %s", async (status) => {
			await assertFails(
				create(dbAs(env, MEMBER), `stage-${status}`, {
					status,
				}),
			);
			await assertFails(
				create(dbAs(env, MEMBER), `column-${status}`, {
					columns: ["backlog", status, "done"],
				}),
			);
		});

		describe("the column set", () => {
			it("refuses a board with no columns at all", async () => {
				await assertFails(
					create(dbAs(env, MEMBER), "columnless", {
						columns: [],
					}),
				);
			});

			it("refuses a column nothing could ever be moved to", async () => {
				await assertFails(
					create(dbAs(env, MEMBER), "invented", {
						columns: ["backlog", "blocked"],
					}),
				);
			});

			it("refuses columns that are not a list", async () => {
				await assertFails(
					create(dbAs(env, MEMBER), "not-a-list", { columns: "backlog" }),
				);
			});

			it("accepts a board down to a single column", async () => {
				await assertSucceeds(
					create(dbAs(env, MEMBER), "one-column", { columns: ["backlog"] }),
				);
			});

			/**
			 * Frozen does not mean immutable. Per-board column configuration (#63)
			 * is exactly the feature that changes this value, and locking it here
			 * would make #63 a rules change before it could be a screen.
			 */
			it("lets the set be replaced with another valid one", async () => {
				await seedNodes();

				await assertSucceeds(
					updateDoc(doc(dbAs(env, MEMBER), sharedPath), {
						columns: ["backlog", "execution", "done"],
					}),
				);
				await assertFails(
					updateDoc(doc(dbAs(env, MEMBER), sharedPath), { columns: [] }),
				);
			});
		});

		/**
		 * `childCount` and `doneCount` are what make a card a board, and they are
		 * checked for their *type* and nothing else. See `models/node.ts` for why
		 * a bound on either one would be a bug rather than a tightening.
		 */
		describe("the counters", () => {
			it("accepts a node that starts with none of either", async () => {
				await assertSucceeds(
					create(dbAs(env, MEMBER), "fresh", { childCount: 0, doneCount: 0 }),
				);
			});

			it.each([
				["childCount", 1.5],
				["childCount", "2"],
				["doneCount", null],
				["doneCount", true],
			])("refuses a %s that is not an integer", async (field, value) => {
				await assertFails(
					create(dbAs(env, MEMBER), "bad-counter", { [field]: value }),
				);
			});

			/**
			 * Deliberately allowed, and not to be "fixed" into `doneCount >= 0`
			 * later. One device offline marks a step done while another deletes
			 * that step; `increment()` commutes, so the value can dip below zero on
			 * its way to the right answer. A bound would reject the whole batch —
			 * and the batch it would reject is a *delete*, whose atomicity is what
			 * keeps a subtree from being orphaned. `toNode` clamps on read.
			 */
			it("allows a count that has gone negative in an offline race", async () => {
				await seedNodes();

				await assertSucceeds(
					updateDoc(doc(dbAs(env, MEMBER), sharedPath), {
						doneCount: increment(-1),
					}),
				);
			});
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

	/**
	 * The shape `createNode` uses: the child and its parent's `childCount` in
	 * one commit, so the pair is atomic.
	 *
	 * The child's create still runs `inherits()`, which does a get() on the
	 * parent — and a get() reads *committed* state, which cannot see the
	 * parent's own update in this batch. That is sound here precisely because
	 * a counter bump changes neither the parent's visibility nor its
	 * participants, so the value the get() reads is the right one.
	 */
	describe("a create in one batch", () => {
		it("adds a card and counts it on its parent at once", async () => {
			await seedNodes();

			const db = dbAs(env, MEMBER);
			const batch = writeBatch(db);
			batch.set(
				doc(db, nodesPath, "step"),
				nodeDoc({ parentId: "shared-node", ancestorIds: ["shared-node"] }),
			);
			batch.update(doc(db, sharedPath), { childCount: increment(1) });

			await assertSucceeds(batch.commit());
		});

		it("counts a card created straight into Done", async () => {
			await seedNodes();

			const db = dbAs(env, MEMBER);
			const batch = writeBatch(db);
			batch.set(
				doc(db, nodesPath, "step"),
				nodeDoc({
					parentId: "shared-node",
					ancestorIds: ["shared-node"],
					status: "done",
					completedAt: new Date("2026-01-02T00:00:00Z"),
				}),
			);
			batch.update(doc(db, sharedPath), {
				childCount: increment(1),
				doneCount: increment(1),
			});

			await assertSucceeds(batch.commit());
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
				// A shared root that becomes a step drops its participants: they are
				// "whose project is this", the control that edits them is root-only,
				// and the board's default-hide filter bites at every depth. The write
				// already spends a parent get() for the parentId change, so this
				// costs nothing more.
				participantIds: [],
			});
			batch.update(doc(db, nodesPath, "child"), {
				ancestorIds: ["new-home", "moved"],
			});
			batch.update(doc(db, nodesPath, "grandchild"), {
				ancestorIds: ["new-home", "moved", "child"],
			});

			await assertSucceeds(batch.commit());
		});

		/**
		 * A batched write may make at most **twenty document access calls**, in
		 * total, across every document in it. An update rule that always read the
		 * parent would therefore cap a subtree move — and fail as a bare
		 * permission error, with nothing to say that size was the cause.
		 *
		 * The shape matters as much as the size: a rule evaluation caches a
		 * `get()` per *path*, so twenty siblings under one parent cost one call
		 * between them. What spends the budget is **distinct** parents, which is
		 * what a project of tasks that each have subtasks is. Twenty of those is
		 * an ordinary Saturday, so a three-node test proves nothing here.
		 */
		it("moves a subtree past a batch's document-access budget", async () => {
			await seedHome();
			// 32 distinct parent paths plus the home `get()` that `isMember` costs,
			// against a budget of twenty — clear of the cliff rather than three
			// calls past it, so this keeps catching the regression if the platform
			// limit is ever raised.
			const tasks = 30;
			await seed(env, async (db) => {
				await setDoc(doc(db, nodesPath, "old-home"), nodeDoc());
				await setDoc(doc(db, nodesPath, "new-home"), nodeDoc());
				await setDoc(
					doc(db, nodesPath, "moved"),
					nodeDoc({ parentId: "old-home", ancestorIds: ["old-home"] }),
				);
				for (let index = 0; index < tasks; index += 1) {
					await setDoc(
						doc(db, nodesPath, `task-${index}`),
						nodeDoc({ parentId: "moved", ancestorIds: ["old-home", "moved"] }),
					);
					await setDoc(
						doc(db, nodesPath, `subtask-${index}`),
						nodeDoc({
							parentId: `task-${index}`,
							ancestorIds: ["old-home", "moved", `task-${index}`],
						}),
					);
				}
			});

			const db = dbAs(env, MEMBER);
			const batch = writeBatch(db);
			batch.update(doc(db, nodesPath, "moved"), {
				parentId: "new-home",
				ancestorIds: ["new-home"],
			});
			// The two counter updates a reparent carries. Neither moves parentId,
			// visibility or participantIds, so neither spends a get() — which is
			// the whole reason they fit inside the budget at all.
			batch.update(doc(db, nodesPath, "old-home"), {
				childCount: increment(-1),
			});
			batch.update(doc(db, nodesPath, "new-home"), {
				childCount: increment(1),
			});
			for (let index = 0; index < tasks; index += 1) {
				batch.update(doc(db, nodesPath, `task-${index}`), {
					ancestorIds: ["new-home", "moved"],
				});
				batch.update(doc(db, nodesPath, `subtask-${index}`), {
					ancestorIds: ["new-home", "moved", `task-${index}`],
				});
			}

			await assertSucceeds(batch.commit());
		});

		it("still proves inheritance on a write that changes privacy", async () => {
			// What the budget fix must not give away: skipping the parent get() is
			// only sound while parentId, visibility and participantIds all stand
			// still. Narrowing a private child below its parent is the write that
			// would strand a subtree, and it stays refused.
			await seedHome();
			await seed(env, async (db) => {
				await setDoc(
					doc(db, nodesPath, "surprise"),
					nodeDoc({
						visibility: "private",
						participantIds: [OWNER.uid, MEMBER.uid],
					}),
				);
				await setDoc(
					doc(db, nodesPath, "cake"),
					nodeDoc({
						parentId: "surprise",
						ancestorIds: ["surprise"],
						visibility: "private",
						participantIds: [OWNER.uid, MEMBER.uid],
					}),
				);
			});

			const db = dbAs(env, MEMBER);
			await assertFails(
				updateDoc(doc(db, nodesPath, "cake"), {
					participantIds: [MEMBER.uid],
				}),
			);
			await assertFails(
				updateDoc(doc(db, nodesPath, "cake"), { visibility: "shared" }),
			);
			// An ordinary edit touches none of the three, and pays no get().
			await assertSucceeds(
				updateDoc(doc(db, nodesPath, "cake"), { title: "Order the cake" }),
			);
		});
	});

	/**
	 * #61. The rules below were already shipped and already correct — a private
	 * node has always been "the people on it" rather than one person, and the
	 * top-down ordering constraint has always been enforced. This feature is the
	 * first caller that exercises any of them, so this is where they get proved.
	 */
	describe("participants, assignees and the flip", () => {
		/** A third member, so "not a participant" is not the same as "not a member". */
		function threeMembers(): Record<string, string> {
			return {
				[OWNER.uid]: "owner",
				[MEMBER.uid]: "member",
				[INVITEE.uid]: "member",
			};
		}

		it("shows a private project to each of its participants and to nobody else", async () => {
			// Private is not "mine alone": two members planning something for a
			// third in the same household have no other way to express it, and the
			// participants list has always been allowed to hold several people.
			await seedHome(threeMembers());
			await seed(env, async (db) => {
				await setDoc(
					doc(db, nodesPath, "surprise"),
					nodeDoc({
						visibility: "private",
						participantIds: [OWNER.uid, MEMBER.uid],
					}),
				);
			});

			await assertSucceeds(
				getDoc(doc(dbAs(env, OWNER), nodesPath, "surprise")),
			);
			await assertSucceeds(
				getDoc(doc(dbAs(env, MEMBER), nodesPath, "surprise")),
			);
			await assertFails(getDoc(doc(dbAs(env, INVITEE), nodesPath, "surprise")));
		});

		it("refuses a private node the writer is not on, creating and updating alike", async () => {
			// There is no lockout path to defend against, only a bare permission
			// error to avoid — by writing the actor in.
			await seedHome(threeMembers());
			await seed(env, async (db) => {
				await setDoc(
					doc(db, nodesPath, "theirs"),
					nodeDoc({
						visibility: "private",
						participantIds: [OWNER.uid, INVITEE.uid],
					}),
				);
			});

			const db = dbAs(env, MEMBER);
			await assertFails(
				create(db, "not-mine", {
					visibility: "private",
					participantIds: [OWNER.uid],
				}),
			);
			await assertFails(
				updateDoc(doc(db, nodesPath, "theirs"), { title: "Peeking" }),
			);
		});

		it("refuses writing yourself out of a private node you share", async () => {
			await seedHome();
			await seed(env, async (db) => {
				await setDoc(
					doc(db, nodesPath, "surprise"),
					nodeDoc({
						visibility: "private",
						participantIds: [OWNER.uid, MEMBER.uid],
					}),
				);
			});

			await assertFails(
				updateDoc(doc(dbAs(env, MEMBER), nodesPath, "surprise"), {
					participantIds: [OWNER.uid],
				}),
			);
		});

		/**
		 * `[]` on a root used to mean "everybody in the home", a value no
		 * checkbox can draw honestly and one that silently put a new member on
		 * every project that predated them. A root names its people now (#102),
		 * and a descendant is untouched — participants are a question about a
		 * *project*.
		 */
		describe("a root names its people", () => {
			beforeEach(seedHome);

			it("refuses a shared root created with nobody on it", async () => {
				await assertFails(
					create(dbAs(env, MEMBER), "nobodys", { participantIds: [] }),
				);
			});

			it("accepts one that names somebody", async () => {
				await assertSucceeds(
					create(dbAs(env, MEMBER), "ours", {
						participantIds: [OWNER.uid, MEMBER.uid],
					}),
				);
			});

			it("refuses emptying a shared root's list", async () => {
				await seed(env, async (db) => {
					await setDoc(doc(db, nodesPath, "gutter"), nodeDoc());
				});

				await assertFails(
					updateDoc(doc(dbAs(env, MEMBER), nodesPath, "gutter"), {
						participantIds: [],
					}),
				);
			});

			it("lets a member add themselves to one, which is what accepting an invite does", async () => {
				await seed(env, async (db) => {
					await setDoc(doc(db, nodesPath, "gutter"), nodeDoc());
				});

				await assertSucceeds(
					updateDoc(doc(dbAs(env, MEMBER), nodesPath, "gutter"), {
						participantIds: [OWNER.uid, MEMBER.uid],
					}),
				);
			});

			it("leaves a shared step carrying an empty list, creating and updating alike", async () => {
				await seed(env, async (db) => {
					await setDoc(doc(db, nodesPath, "gutter"), nodeDoc());
				});
				const db = dbAs(env, MEMBER);
				const step = {
					parentId: "gutter",
					ancestorIds: ["gutter"],
					participantIds: [],
				};

				await assertSucceeds(create(db, "ladder", step));
				await assertSucceeds(
					updateDoc(doc(db, nodesPath, "ladder"), { participantIds: [] }),
				);
			});

			it("does not bite a private root, which always carries its creator", async () => {
				const db = dbAs(env, MEMBER);
				await assertSucceeds(
					create(db, "mine", {
						visibility: "private",
						participantIds: [MEMBER.uid],
					}),
				);
				await assertSucceeds(
					updateDoc(doc(db, nodesPath, "mine"), { title: "Still mine" }),
				);
			});
		});

		it("lets a shared project name participants that leave the writer out", async () => {
			// On a shared node participantIds is read by no rule — the read grant's
			// first disjunct alone lets every member in — so setting participants
			// there changes no permission and cannot lock its own author out. All it
			// does is feed the board's default-hide filter, which is a display
			// preference.
			await seedHome();

			await assertSucceeds(
				create(dbAs(env, MEMBER), "his-shed", {
					participantIds: [OWNER.uid],
				}),
			);
		});

		describe("a visibility flip, top-down", () => {
			beforeEach(async () => {
				await seedHome();
				await seed(env, async (db) => {
					await setDoc(doc(db, nodesPath, "garage"), nodeDoc());
					await setDoc(
						doc(db, nodesPath, "tiles"),
						nodeDoc({ parentId: "garage", ancestorIds: ["garage"] }),
					);
				});
			});

			it("refuses a child written to the new visibility before its parent", async () => {
				// Why the flip cannot be one batch: a rule's get() reads *committed*
				// state, so a child that runs ahead of its parent fails inheritance.
				await assertFails(
					updateDoc(doc(dbAs(env, MEMBER), nodesPath, "tiles"), {
						visibility: "private",
						participantIds: [MEMBER.uid],
					}),
				);
			});

			it("allows the same child once its parent has committed", async () => {
				const db = dbAs(env, MEMBER);
				await assertSucceeds(
					updateDoc(doc(db, nodesPath, "garage"), {
						visibility: "private",
						participantIds: [MEMBER.uid],
					}),
				);
				await assertSucceeds(
					updateDoc(doc(db, nodesPath, "tiles"), {
						visibility: "private",
						participantIds: [MEMBER.uid],
					}),
				);
			});

			it("is top-down in the other direction too", async () => {
				await seed(env, async (db) => {
					await setDoc(
						doc(db, nodesPath, "garage"),
						nodeDoc({
							visibility: "private",
							participantIds: [MEMBER.uid],
						}),
					);
					await setDoc(
						doc(db, nodesPath, "tiles"),
						nodeDoc({
							parentId: "garage",
							ancestorIds: ["garage"],
							visibility: "private",
							participantIds: [MEMBER.uid],
						}),
					);
				});

				const db = dbAs(env, MEMBER);
				await assertFails(
					updateDoc(doc(db, nodesPath, "tiles"), {
						visibility: "shared",
						participantIds: [],
					}),
				);
				await assertSucceeds(
					updateDoc(doc(db, nodesPath, "garage"), { visibility: "shared" }),
				);
				await assertSucceeds(
					updateDoc(doc(db, nodesPath, "tiles"), {
						visibility: "shared",
						participantIds: [],
					}),
				);
			});
		});

		describe("assigneeIds", () => {
			it("lets a document written before the field existed be updated", async () => {
				// The reason the field is validated present-only. request.resource.data
				// is the full post-update document, so requiring it would deny every
				// update to an older node — including the childCount bump that adding
				// a step to it performs — with no admin tooling here to unstick them.
				await seedHome();
				await seed(env, async (db) => {
					const data = nodeDoc();
					delete data.assigneeIds;
					await setDoc(doc(db, nodesPath, "elderly"), data);
				});

				const db = dbAs(env, MEMBER);
				await assertSucceeds(
					updateDoc(doc(db, nodesPath, "elderly"), {
						childCount: increment(1),
					}),
				);
				// And it gains the field the first time anything writes it.
				await assertSucceeds(
					updateDoc(doc(db, nodesPath, "elderly"), {
						assigneeIds: [MEMBER.uid],
					}),
				);
			});

			it("refuses an assigneeIds that is not a list", async () => {
				await seedHome();
				await assertFails(
					create(dbAs(env, MEMBER), "bad-assignees", {
						assigneeIds: MEMBER.uid,
					}),
				);
			});

			/**
			 * Assignment is not privacy, so `privacyUnchanged()` holds and the parent
			 * get() is skipped. Proved by size rather than by inspection: a batched
			 * write may make at most twenty document access calls in total, so
			 * thirty distinct parents landing at once is only possible if none of
			 * them is read.
			 */
			it("assigns deep nodes without spending a parent get()", async () => {
				await seedHome();
				const steps = 30;
				await seed(env, async (db) => {
					await setDoc(doc(db, nodesPath, "garage"), nodeDoc());
					for (let index = 0; index < steps; index += 1) {
						await setDoc(
							doc(db, nodesPath, `task-${index}`),
							nodeDoc({ parentId: "garage", ancestorIds: ["garage"] }),
						);
						await setDoc(
							doc(db, nodesPath, `step-${index}`),
							nodeDoc({
								parentId: `task-${index}`,
								ancestorIds: ["garage", `task-${index}`],
							}),
						);
					}
				});

				const db = dbAs(env, MEMBER);
				const batch = writeBatch(db);
				for (let index = 0; index < steps; index += 1) {
					batch.update(doc(db, nodesPath, `step-${index}`), {
						assigneeIds: [MEMBER.uid],
					});
				}

				await assertSucceeds(batch.commit());
			});
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

			// Both, since #102: a shared project names its participants, so the
			// owner is on the shared root as well as in the private one — which is
			// exactly the overlap the client's dedupe exists for.
			expect(result.docs.map((snapshot) => snapshot.id)).toEqual([
				"project",
				"surprise",
			]);
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
			// client-side. `participantIds` alone is what makes it safe; the
			// `visibility` clause is what keeps it from reading every card assigned
			// to me anywhere in the home.
			const result = await assertSucceeds(
				getDocs(
					query(
						board(dbAs(env, OWNER)),
						where("visibility", "==", "private"),
						where("participantIds", "array-contains", OWNER.uid),
					),
				),
			);

			expect(result.docs.map((snapshot) => snapshot.id)).toEqual(["surprise"]);
		});
	});
	/**
	 * Overview's four dated queries. Nothing else in the repo makes the claim
	 * that they are *permitted* — the app-side tests are pure functions over
	 * `Node[]`, and the emulator is the only place a query's safety is decided.
	 */
	describe("the overview queries", () => {
		const until = "2026-09-30";
		const since = new Date("2026-08-01T00:00:00Z");

		beforeEach(async () => {
			await seedHome();
			await seed(env, async (db) => {
				await setDoc(
					doc(db, nodesPath, "due-shared"),
					nodeDoc({ dueDate: "2026-09-01" }),
				);
				await setDoc(
					doc(db, nodesPath, "due-private"),
					nodeDoc({
						dueDate: "2026-09-02",
						visibility: "private",
						participantIds: [OWNER.uid],
					}),
				);
				await setDoc(
					doc(db, nodesPath, "done-shared"),
					nodeDoc({
						status: "done",
						completedAt: new Date("2026-08-20T00:00:00Z"),
					}),
				);
				await setDoc(
					doc(db, nodesPath, "done-private"),
					nodeDoc({
						status: "done",
						completedAt: new Date("2026-08-19T00:00:00Z"),
						visibility: "private",
						participantIds: [OWNER.uid],
					}),
				);
				// No due date and not done: what `dueDate >= ""` exists to exclude.
				await setDoc(doc(db, nodesPath, "undated"), nodeDoc());
			});
		});

		const nodes = (db: ReturnType<typeof dbAs>) => collection(db, nodesPath);

		const ids = (result: { docs: { id: string }[] }) =>
			result.docs.map((snapshot) => snapshot.id);

		it("runs the shared half of Coming up", async () => {
			// Q3. `visibility == 'shared'` is the read rule's first disjunct, so no
			// matching document can be denied.
			const result = await assertSucceeds(
				getDocs(
					query(
						nodes(dbAs(env, MEMBER)),
						where("archived", "==", false),
						where("completedAt", "==", null),
						where("visibility", "==", "shared"),
						where("dueDate", ">=", ""),
						where("dueDate", "<=", until),
						orderBy("dueDate"),
						limit(20),
					),
				),
			);

			// The private dated node is not in it, and neither is the undated one.
			expect(ids(result)).toEqual(["due-shared"]);
		});

		it("runs the participating half of Coming up", async () => {
			// Q4, the rule's second disjunct — which is what reaches the owner's own
			// private dated node. The shared one is in both halves, which is what
			// the client's dedupe exists for.
			const result = await assertSucceeds(
				getDocs(
					query(
						nodes(dbAs(env, OWNER)),
						where("archived", "==", false),
						where("completedAt", "==", null),
						where("participantIds", "array-contains", OWNER.uid),
						where("dueDate", ">=", ""),
						where("dueDate", "<=", until),
						orderBy("dueDate"),
						limit(20),
					),
				),
			);

			expect(ids(result)).toEqual(["due-shared", "due-private"]);
		});

		it("runs the shared half of Recently done", async () => {
			// Q5. `null` sorts below every timestamp, so the range excludes the
			// not-done nodes without a lower-bound trick of its own.
			const result = await assertSucceeds(
				getDocs(
					query(
						nodes(dbAs(env, MEMBER)),
						where("archived", "==", false),
						where("visibility", "==", "shared"),
						where("completedAt", ">=", since),
						orderBy("completedAt", "desc"),
						limit(20),
					),
				),
			);

			expect(ids(result)).toEqual(["done-shared"]);
		});

		it("runs the participating half of Recently done", async () => {
			// Q6.
			const result = await assertSucceeds(
				getDocs(
					query(
						nodes(dbAs(env, OWNER)),
						where("archived", "==", false),
						where("participantIds", "array-contains", OWNER.uid),
						where("completedAt", ">=", since),
						orderBy("completedAt", "desc"),
						limit(20),
					),
				),
			);

			expect(ids(result)).toEqual(["done-shared", "done-private"]);
		});

		/**
		 * What `dueDate >= ""` is actually worth, asked of the real thing rather
		 * than of either reading of the docs.
		 *
		 * Firestore orders values by *type* before value — `Null < Boolean <
		 * Number < Timestamp < String` — which is the reason to fear that
		 * `dueDate <= cutoff` alone returns every undated node in the home. This
		 * is the only place that fear can be settled, and the answer it gives is
		 * what the comment on `sharedDueQuery` is allowed to claim.
		 *
		 * The bound stays either way: the empty string is the smallest string, so
		 * it costs nothing and no index, and "every undated card in the house" is
		 * what this listener degrades to if the type-scoping below ever stops
		 * holding. This test is what would notice.
		 */
		it("excludes the undated node with or without the lower bound", async () => {
			const withoutBound = await assertSucceeds(
				getDocs(
					query(
						nodes(dbAs(env, MEMBER)),
						where("archived", "==", false),
						where("completedAt", "==", null),
						where("visibility", "==", "shared"),
						where("dueDate", "<=", until),
						orderBy("dueDate"),
						limit(20),
					),
				),
			);

			expect(ids(withoutBound)).toEqual(["due-shared"]);
		});

		it("refuses Coming up as one query", async () => {
			// What makes the pair necessary rather than stylistic: without the
			// visibility clause this matches a private node the member cannot read,
			// and Firestore rejects the whole query rather than filtering it.
			await assertFails(
				getDocs(
					query(
						nodes(dbAs(env, MEMBER)),
						where("archived", "==", false),
						where("completedAt", "==", null),
						where("dueDate", ">=", ""),
						where("dueDate", "<=", until),
						orderBy("dueDate"),
						limit(20),
					),
				),
			);
		});

		it("refuses Recently done as one query", async () => {
			await assertFails(
				getDocs(
					query(
						nodes(dbAs(env, MEMBER)),
						where("archived", "==", false),
						where("completedAt", ">=", since),
						orderBy("completedAt", "desc"),
						limit(20),
					),
				),
			);
		});
	});

	/**
	 * The picker's two home-wide search queries (Q-S1, Q-S2, #66) — one-shot
	 * `getDocsFromServer` reads fired debounced from the *Waiting on…* picker.
	 * Nothing else in the repo makes the claim that they are *permitted*: the
	 * emulator is the only place a query's safety is decided, as for the board
	 * and overview queries above.
	 */
	describe("the picker search queries", () => {
		beforeEach(async () => {
			await seedHome();
			await seed(env, async (db) => {
				await setDoc(
					doc(db, nodesPath, "open-shared"),
					nodeDoc({ updatedAt: new Date("2026-02-01T00:00:00Z") }),
				);
				await setDoc(
					doc(db, nodesPath, "done-shared"),
					nodeDoc({
						status: "done",
						completedAt: new Date("2026-08-20T00:00:00Z"),
					}),
				);
				await setDoc(
					doc(db, nodesPath, "archived-shared"),
					nodeDoc({ archived: true }),
				);
				await setDoc(
					doc(db, nodesPath, "open-private"),
					nodeDoc({
						visibility: "private",
						participantIds: [OWNER.uid],
						updatedAt: new Date("2026-03-01T00:00:00Z"),
					}),
				);
			});
		});

		const nodes = (db: ReturnType<typeof dbAs>) => collection(db, nodesPath);

		const ids = (result: { docs: { id: string }[] }) =>
			result.docs.map((snapshot) => snapshot.id);

		it("runs the shared half of the picker search", async () => {
			// Q-S1. Provably safe: `visibility == 'shared'` is the read rule's
			// first disjunct. The done and the archived card stay out, and so does
			// the private one.
			const result = await assertSucceeds(
				getDocs(
					query(
						nodes(dbAs(env, MEMBER)),
						where("archived", "==", false),
						where("completedAt", "==", null),
						where("visibility", "==", "shared"),
						orderBy("updatedAt", "desc"),
						limit(50),
					),
				),
			);

			expect(ids(result)).toEqual(["open-shared"]);
		});

		it("runs the participating half of the picker search", async () => {
			// Q-S2, the rule's second disjunct — which reaches the private card
			// the shared half cannot see. Newest `updatedAt` first, which is what
			// the composite index orders.
			const result = await assertSucceeds(
				getDocs(
					query(
						nodes(dbAs(env, OWNER)),
						where("archived", "==", false),
						where("completedAt", "==", null),
						where("participantIds", "array-contains", OWNER.uid),
						orderBy("updatedAt", "desc"),
						limit(50),
					),
				),
			);

			expect(ids(result)).toEqual(["open-private", "open-shared"]);
		});

		it("refuses the picker search as one unconstrained query", async () => {
			// What makes the pair necessary rather than stylistic: without one of
			// the two disjuncts this matches a private node the member cannot
			// read, and Firestore rejects the whole query rather than filtering it.
			await assertFails(
				getDocs(
					query(
						nodes(dbAs(env, MEMBER)),
						where("archived", "==", false),
						where("completedAt", "==", null),
						orderBy("updatedAt", "desc"),
						limit(50),
					),
				),
			);
		});
	});

	describe("createdVia", () => {
		beforeEach(seedHome);

		it("accepts a node the app wrote", async () => {
			await assertSucceeds(create(dbAs(env, MEMBER), "from-app"));
		});

		/**
		 * The mark a household relies on to tell an agent's forty cards from its
		 * own. A member who could write it could forge it — so the only writer of
		 * 'api' is the Cloud Function, which the Admin SDK puts outside these
		 * rules entirely.
		 */
		it("refuses a client claiming a node came from the API", async () => {
			await assertFails(
				create(dbAs(env, MEMBER), "forged", { createdVia: "api" }),
			);
		});

		it("refuses a value that is neither", async () => {
			await assertFails(
				create(dbAs(env, MEMBER), "invented", { createdVia: "cli" }),
			);
		});

		/**
		 * Present-only, for the same reason as assigneeIds: request.resource.data
		 * is the full post-update document, so requiring it would deny every
		 * update to every node written before this field existed — including the
		 * childCount bump that adding a step to an old project performs.
		 */
		it("accepts a node that has none at all", async () => {
			await assertSucceeds(
				create(dbAs(env, MEMBER), "from-before", { createdVia: undefined }),
			);
		});

		describe("once written", () => {
			const apiPath = `${nodesPath}/from-api`;
			const oldPath = `${nodesPath}/from-before`;

			beforeEach(async () => {
				await seed(env, async (db) => {
					// Only the function can write this, so the seed does what the
					// function does.
					await setDoc(doc(db, apiPath), nodeDoc({ createdVia: "api" }));
					await setDoc(doc(db, oldPath), nodeDoc({ createdVia: undefined }));
				});
			});

			/**
			 * The case the obvious rule shape gets wrong. Putting the 'app'-only
			 * test in validNode() would deny this — and curating what an agent
			 * wrote is the entire point of marking it.
			 */
			it("lets a member edit a node the API wrote", async () => {
				await assertSucceeds(
					updateDoc(doc(dbAs(env, MEMBER), apiPath), { title: "Renamed" }),
				);
			});

			it("refuses changing it, in both directions", async () => {
				await assertFails(
					updateDoc(doc(dbAs(env, MEMBER), apiPath), { createdVia: "app" }),
				);
				await assertFails(
					updateDoc(doc(dbAs(env, MEMBER), sharedPath), {
						createdVia: "api",
					}),
				);
			});

			it("refuses adding it to a node that lacks it", async () => {
				await assertFails(
					updateDoc(doc(dbAs(env, MEMBER), oldPath), { createdVia: "app" }),
				);
				await assertFails(
					updateDoc(doc(dbAs(env, MEMBER), oldPath), { createdVia: "api" }),
				);
			});

			it("refuses removing it", async () => {
				await assertFails(
					updateDoc(doc(dbAs(env, MEMBER), apiPath), {
						createdVia: deleteField(),
					}),
				);
			});

			it("still lets an old node be updated without it", async () => {
				await assertSucceeds(
					updateDoc(doc(dbAs(env, MEMBER), oldPath), { title: "Renamed" }),
				);
			});
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

describe("users/{uid}/apiKeys", () => {
	const keyPath = `users/${OWNER.uid}/apiKeys/key-1`;

	/**
	 * A key document in the shape `createApiKey` writes it. The secret itself is
	 * never stored — only its SHA-256 — so nothing here is a working credential.
	 */
	function apiKeyDoc(overrides: Record<string, unknown> = {}) {
		return {
			name: "research agent",
			secretHash: "0".repeat(64),
			tail: "3f9c",
			createdAt: new Date("2026-01-01T00:00:00Z"),
			lastUsedAt: null,
			...overrides,
		};
	}

	async function seedKey() {
		await seed(env, async (db) => {
			await setDoc(doc(db, keyPath), apiKeyDoc());
		});
	}

	it("is readable by its owner and nobody else", async () => {
		await seedKey();

		await assertSucceeds(getDoc(doc(dbAs(env, OWNER), keyPath)));
		await assertFails(getDoc(doc(dbAs(env, MEMBER), keyPath)));
		await assertFails(getDoc(doc(dbAnon(env), keyPath)));
	});

	it("lists only to its owner", async () => {
		await seedKey();
		const keys = (db: ReturnType<typeof dbAs>) =>
			getDocs(
				query(
					collection(db, "users", OWNER.uid, "apiKeys"),
					orderBy("createdAt"),
				),
			);

		await assertSucceeds(keys(dbAs(env, OWNER)));
		await assertFails(keys(dbAs(env, MEMBER)));
	});

	it("is revoked by its owner and by nobody else", async () => {
		await seedKey();

		await assertFails(deleteDoc(doc(dbAs(env, MEMBER), keyPath)));
		await assertSucceeds(deleteDoc(doc(dbAs(env, OWNER), keyPath)));
	});

	// A client that could write one of these could plant a hash whose secret it
	// already knows, which is a credential minted outside every check in the
	// rules. Minting is the callable's alone.
	it("cannot be created by anyone, including its own owner", async () => {
		await assertFails(setDoc(doc(dbAs(env, OWNER), keyPath), apiKeyDoc()));
		await assertFails(setDoc(doc(dbAs(env, MEMBER), keyPath), apiKeyDoc()));
	});

	it("cannot be updated by its owner", async () => {
		await seedKey();

		await assertFails(
			updateDoc(doc(dbAs(env, OWNER), keyPath), { name: "renamed" }),
		);
		await assertFails(
			updateDoc(doc(dbAs(env, OWNER), keyPath), {
				secretHash: "1".repeat(64),
			}),
		);
	});

	describe("the run records", () => {
		const runPath = `${keyPath}/runs/idem-1`;

		it("are readable and writable by nobody at all", async () => {
			await seed(env, async (db) => {
				await setDoc(doc(db, runPath), { ids: {}, rootId: "node-1" });
			});

			await assertFails(getDoc(doc(dbAs(env, OWNER), runPath)));
			await assertFails(getDoc(doc(dbAs(env, MEMBER), runPath)));
			await assertFails(
				setDoc(doc(dbAs(env, OWNER), runPath), { ids: {}, rootId: "node-1" }),
			);
			await assertFails(deleteDoc(doc(dbAs(env, OWNER), runPath)));
		});
	});
});

describe("homes/{homeId}/apiClients", () => {
	const clientPath = `${homePath}/apiClients/key-1`;

	function apiClientDoc(overrides: Record<string, unknown> = {}) {
		return {
			keyId: "key-1",
			ownerUid: OWNER.uid,
			ownerName: "Marcus",
			name: "research agent",
			lastUsedAt: new Date("2026-01-01T00:00:00Z"),
			...overrides,
		};
	}

	beforeEach(async () => {
		await seedHome();
		await seed(env, async (db) => {
			await setDoc(doc(db, clientPath), apiClientDoc());
		});
	});

	it("is readable by every member of the home", async () => {
		await assertSucceeds(getDoc(doc(dbAs(env, OWNER), clientPath)));
		await assertSucceeds(getDoc(doc(dbAs(env, MEMBER), clientPath)));
	});

	it("tells a non-member nothing", async () => {
		await assertFails(getDoc(doc(dbAs(env, OUTSIDER), clientPath)));
		await assertFails(getDoc(doc(dbAnon(env), clientPath)));
	});

	// The manage screen's list. Every document in the collection is readable by
	// every member, so nothing this can match could be denied.
	it("lists to a member ordered by last use, and not to a non-member", async () => {
		const clients = (db: ReturnType<typeof dbAs>) =>
			getDocs(
				query(
					collection(db, homePath, "apiClients"),
					orderBy("lastUsedAt", "desc"),
				),
			);

		await assertSucceeds(clients(dbAs(env, MEMBER)));
		await assertFails(clients(dbAs(env, OUTSIDER)));
	});

	// Written by the function only. A member who could write these could invent
	// an automation that never existed, or quietly erase the trace of one that
	// did — on the one screen a household consults to find out.
	it("is written by no client, member or owner", async () => {
		await assertFails(
			setDoc(
				doc(dbAs(env, OWNER), `${homePath}/apiClients/key-2`),
				apiClientDoc(),
			),
		);
		await assertFails(
			updateDoc(doc(dbAs(env, OWNER), clientPath), { name: "renamed" }),
		);
		await assertFails(deleteDoc(doc(dbAs(env, OWNER), clientPath)));
		await assertFails(deleteDoc(doc(dbAs(env, MEMBER), clientPath)));
	});
});
