import { jest } from "@jest/globals";
import { Timestamp } from "firebase-admin/firestore";

let members: Record<string, string> | undefined;
let claim: unknown;
const remove = jest.fn();
const homeRef = {
	get: async () => ({
		data: () => (members ? { members } : undefined),
		get: () => claim,
	}),
	listCollections: async () => [childCollection],
};
const childRef = { id: "child", listCollections: async () => [] };
const childCollection = { id: "nodes", listDocuments: async () => [childRef] };
const doc = jest.fn(() => homeRef);
const collection = jest.fn(() => ({ doc }));

jest.unstable_mockModule("./firestore.js", () => ({
	db: {
		collection,
		runTransaction: async (run: (transaction: unknown) => unknown) =>
			run({
				get: () => homeRef.get(),
				update: (_ref: unknown, data: { deletionClaim?: unknown }) => {
					if (data.deletionClaim) claim = data.deletionClaim;
				},
				delete: remove,
			}),
	},
	homesCollection: "homes",
	maxBatchWrites: 500,
}));

const { deleteHomeTree, isSoleOwner } = await import("./home-cascade.js");
const { deleteHome } = await import("./delete-home.js");

beforeEach(() => {
	members = { owner: "owner" };
	claim = {
		id: "claim",
		expiresAt: Timestamp.fromMillis(Date.now() + 600_000),
	};
	remove.mockReset();
});

describe("isSoleOwner", () => {
	it.each([
		[{ owner: "owner" }, "owner", true],
		[{ owner: "owner", member: "member" }, "owner", false],
		[{ owner: "owner", other: "owner" }, "owner", false],
		[{ member: "member" }, "member", false],
		[{ owner: "owner" }, "outsider", false],
		[{}, "owner", false],
	] as const)("checks %j for %s", (membership, uid, expected) => {
		expect(isSoleOwner(membership, uid)).toBe(expected);
	});
});

describe("deleteHomeTree", () => {
	it("awaits recursive deletion of the entire home document tree", async () => {
		await deleteHomeTree("home-1", "claim");

		expect(collection).toHaveBeenCalledWith("homes");
		expect(doc).toHaveBeenCalledWith("home-1");
		expect(remove).toHaveBeenNthCalledWith(1, childRef);
		expect(remove).toHaveBeenLastCalledWith(homeRef);
	});

	it("propagates deletion failures", async () => {
		remove.mockImplementationOnce(() => {
			throw new Error("deletion failed");
		});

		await expect(deleteHomeTree("home-1", "claim")).rejects.toThrow(
			"deletion failed",
		);
	});

	it("keeps the home until child deletion succeeds, so a failed callable can retry", async () => {
		claim = undefined;
		remove.mockImplementationOnce(() => {
			throw new Error("descendant failed");
		});
		await expect(
			deleteHome.run({
				data: { homeId: "home-1" },
				auth: { uid: "owner", token: {} },
			} as Parameters<typeof deleteHome.run>[0]),
		).rejects.toThrow("descendant failed");
		expect(remove).not.toHaveBeenCalledWith(homeRef);
		await deleteHomeTree("home-1", (claim as { id: string }).id);
		expect(remove).toHaveBeenLastCalledWith(homeRef);
	});
});

describe("deleteHome callable", () => {
	beforeEach(() => {
		claim = undefined;
	});
	function call(data: unknown, uid: string | null = "owner") {
		return deleteHome.run({
			data,
			auth: uid ? { uid, token: {} } : undefined,
		} as Parameters<typeof deleteHome.run>[0]);
	}

	it("requires authentication before reading or deleting anything", async () => {
		await expect(call({ homeId: "home-1" }, null)).rejects.toMatchObject({
			code: "unauthenticated",
		});
		expect(collection).not.toHaveBeenCalled();
		expect(remove).not.toHaveBeenCalled();
	});

	it.each([null, {}, { homeId: 1 }, { homeId: "" }, { homeId: "a/b/c" }])(
		"rejects invalid input %j without accessing Firestore",
		async (data) => {
			await expect(call(data)).rejects.toMatchObject({
				code: "invalid-argument",
			});
			expect(collection).not.toHaveBeenCalled();
			expect(remove).not.toHaveBeenCalled();
		},
	);

	it.each(["member", "outsider"])("refuses a non-owner %s", async (uid) => {
		members = { owner: "owner", member: "member" };

		await expect(call({ homeId: "home-1" }, uid)).rejects.toMatchObject({
			code: "failed-precondition",
		});
		expect(remove).not.toHaveBeenCalled();
	});

	it("refuses an owner while another member remains", async () => {
		members = { owner: "owner", member: "member" };

		await expect(call({ homeId: "home-1" })).rejects.toMatchObject({
			code: "failed-precondition",
		});
		expect(remove).not.toHaveBeenCalled();
	});

	it("does not delete a missing home", async () => {
		members = undefined;

		await expect(call({ homeId: "home-1" })).rejects.toMatchObject({
			code: "failed-precondition",
		});
		expect(remove).not.toHaveBeenCalled();
	});

	it("lets the sole owner delete the home tree", async () => {
		await call({ homeId: "home-1" });

		expect(doc).toHaveBeenCalledWith("home-1");
		expect(remove).toHaveBeenCalledTimes(2);
		expect(remove).toHaveBeenCalledWith(homeRef);
	});
});
