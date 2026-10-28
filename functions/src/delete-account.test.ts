import { jest } from "@jest/globals";

const uid = "leaving";
const now = 1_800_000_000;
let members: Record<string, string> | undefined;
const recursiveDelete = jest.fn<() => Promise<void>>();
const deleteUser = jest.fn<() => Promise<void>>();
const write = jest.fn<() => Promise<void>>();
const homeRef = {
	collection: () => ({ where: () => ({ get: async () => ({ docs: [] }) }) }),
	update: write,
};
const userRef = {
	collection: () => ({
		get: async () => ({
			docs: [
				{ get: (field: string) => (field === "name" ? "Helper" : "secret") },
			],
		}),
	}),
};
const collection = jest.fn((name: string) => ({
	doc: () => userRef,
	where: () => ({
		get: async () => ({
			docs:
				name === "homes" && members
					? [
							{
								id: "home-1",
								ref: homeRef,
								get: (field: string) =>
									({
										name: "Huset",
										members,
										memberProfiles: { other: { displayName: "Anna" } },
									})[field],
							},
						]
					: [],
		}),
	}),
}));

jest.unstable_mockModule("./firestore.js", () => ({
	db: {
		collection,
		collectionGroup: () => ({
			where: () => ({ get: async () => ({ docs: [] }) }),
		}),
		recursiveDelete,
	},
	homesCollection: "homes",
	nodesCollection: "nodes",
	usersCollection: "users",
	apiKeysCollection: "apiKeys",
	apiClientsCollection: "apiClients",
	dashboardsCollection: "dashboards",
}));
jest.unstable_mockModule("firebase-admin/auth", () => ({
	getAuth: () => ({ deleteUser }),
}));

const { deleteAccount } = await import("./delete-account.js");

function call(data: unknown, authTime: unknown = now, signedIn = true) {
	return deleteAccount.run({
		data,
		auth: signedIn
			? { uid, token: { auth_time: authTime, email: "me@example.com" } }
			: undefined,
	} as Parameters<typeof deleteAccount.run>[0]);
}

beforeEach(() => {
	members = undefined;
	jest.spyOn(Date, "now").mockReturnValue(now * 1000);
	recursiveDelete.mockResolvedValue(undefined);
	deleteUser.mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

it("requires authentication before any reads", async () => {
	await expect(call({ dryRun: false }, now, false)).rejects.toMatchObject({
		code: "unauthenticated",
	});
	expect(collection).not.toHaveBeenCalled();
});

it.each([null, {}, { dryRun: "false" }, { dryRun: 0 }])(
	"rejects malformed input %j before reads",
	async (data) => {
		await expect(call(data)).rejects.toMatchObject({
			code: "invalid-argument",
		});
		expect(collection).not.toHaveBeenCalled();
	},
);

it("dry-runs a blocked plan even with a stale login, without writes or key secrets", async () => {
	members = { [uid]: "owner", other: "member" };
	await expect(call({ dryRun: true }, now - 301)).resolves.toEqual({
		homes: [
			{
				homeId: "home-1",
				name: "Huset",
				outcome: "blocked",
				otherMembers: ["Anna"],
				privateCardsDeleted: 0,
			},
		],
		apiKeys: [{ name: "Helper" }],
	});
	expect(write).not.toHaveBeenCalled();
	expect(recursiveDelete).not.toHaveBeenCalled();
	expect(deleteUser).not.toHaveBeenCalled();
});

it("re-plans a real run instead of trusting an earlier dry run", async () => {
	await call({ dryRun: true });
	members = { [uid]: "owner", other: "member" };
	await expect(call({ dryRun: false })).rejects.toMatchObject({
		code: "failed-precondition",
		message: "blocked",
	});
	expect(write).not.toHaveBeenCalled();
	expect(recursiveDelete).not.toHaveBeenCalled();
	expect(deleteUser).not.toHaveBeenCalled();
});

it.each([now - 301, undefined, "today", Number.NaN])(
	"refuses stale or invalid auth_time %s before writes",
	async (authTime) => {
		await expect(
			call({ dryRun: false }, authTime ?? null),
		).rejects.toMatchObject({
			code: "failed-precondition",
			message: "recent-login",
		});
		expect(recursiveDelete).not.toHaveBeenCalled();
		expect(deleteUser).not.toHaveBeenCalled();
	},
);

it("accepts a login exactly five minutes old and deletes Auth last", async () => {
	await call({ dryRun: false }, now - 300);
	expect(recursiveDelete).toHaveBeenCalledWith(userRef);
	expect(deleteUser).toHaveBeenCalledWith(uid);
	expect(recursiveDelete.mock.invocationCallOrder[0]).toBeLessThan(
		deleteUser.mock.invocationCallOrder[0],
	);
});

it("keeps Auth when user-tree deletion fails; a retry finishes", async () => {
	recursiveDelete.mockRejectedValueOnce(
		new Error("temporary deletion failure"),
	);
	await expect(call({ dryRun: false })).rejects.toThrow(
		"temporary deletion failure",
	);
	expect(deleteUser).not.toHaveBeenCalled();
	await call({ dryRun: false });
	expect(deleteUser).toHaveBeenCalledTimes(1);
});

it("treats an already missing Auth user as success but propagates other Auth failures", async () => {
	deleteUser.mockRejectedValueOnce({ code: "auth/user-not-found" });
	await expect(call({ dryRun: false })).resolves.toBeDefined();
	deleteUser.mockRejectedValueOnce(new Error("Auth unavailable"));
	await expect(call({ dryRun: false })).rejects.toThrow("Auth unavailable");
});
