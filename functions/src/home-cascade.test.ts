import { jest } from "@jest/globals";

let members: Record<string, string> | undefined;
const homeRef = {
	get: async () => ({ data: () => (members ? { members } : undefined) }),
};
const doc = jest.fn(() => homeRef);
const collection = jest.fn(() => ({ doc }));
const recursiveDelete = jest.fn<() => Promise<void>>();

jest.unstable_mockModule("./firestore.js", () => ({
	db: { collection, recursiveDelete },
	homesCollection: "homes",
}));

const { deleteHomeTree, isSoleOwner } = await import("./home-cascade.js");
const { deleteHome } = await import("./delete-home.js");

beforeEach(() => {
	members = { owner: "owner" };
	recursiveDelete.mockResolvedValue(undefined);
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
		await deleteHomeTree("home-1");

		expect(collection).toHaveBeenCalledWith("homes");
		expect(doc).toHaveBeenCalledWith("home-1");
		expect(recursiveDelete).toHaveBeenCalledWith(homeRef);
	});

	it("propagates deletion failures", async () => {
		recursiveDelete.mockRejectedValue(new Error("deletion failed"));

		await expect(deleteHomeTree("home-1")).rejects.toThrow("deletion failed");
	});
});

describe("deleteHome callable", () => {
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
		expect(recursiveDelete).not.toHaveBeenCalled();
	});

	it.each([null, {}, { homeId: 1 }, { homeId: "" }, { homeId: "a/b/c" }])(
		"rejects invalid input %j without accessing Firestore",
		async (data) => {
			await expect(call(data)).rejects.toMatchObject({
				code: "invalid-argument",
			});
			expect(collection).not.toHaveBeenCalled();
			expect(recursiveDelete).not.toHaveBeenCalled();
		},
	);

	it.each(["member", "outsider"])("refuses a non-owner %s", async (uid) => {
		members = { owner: "owner", member: "member" };

		await expect(call({ homeId: "home-1" }, uid)).rejects.toMatchObject({
			code: "failed-precondition",
		});
		expect(recursiveDelete).not.toHaveBeenCalled();
	});

	it("refuses an owner while another member remains", async () => {
		members = { owner: "owner", member: "member" };

		await expect(call({ homeId: "home-1" })).rejects.toMatchObject({
			code: "failed-precondition",
		});
		expect(recursiveDelete).not.toHaveBeenCalled();
	});

	it("does not delete a missing home", async () => {
		members = undefined;

		await expect(call({ homeId: "home-1" })).rejects.toMatchObject({
			code: "failed-precondition",
		});
		expect(recursiveDelete).not.toHaveBeenCalled();
	});

	it("lets the sole owner delete the home tree", async () => {
		await call({ homeId: "home-1" });

		expect(doc).toHaveBeenCalledWith("home-1");
		expect(recursiveDelete).toHaveBeenCalledTimes(1);
		expect(recursiveDelete).toHaveBeenCalledWith(homeRef);
	});
});
