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
function child(
	id: string,
	payload: string | number[] = "",
	collectionId = "nodes",
) {
	return {
		id,
		path: `homes/home-1/${collectionId}/${id}`,
		listCollections: async () => [],
		data: (): Record<string, string | number[]> =>
			Array.isArray(payload) ? { values: payload } : { payload },
	};
}
function deletionBytes(ref: ReturnType<typeof child>) {
	const stringBytes = (value: string) => Buffer.byteLength(value) + 1;
	const segments = ref.path.split("/");
	const nameBytes =
		16 + segments.reduce((sum, part) => sum + stringBytes(part), 0);
	const parentBytes =
		16 +
		segments.slice(0, -2).reduce((sum, part) => sum + stringBytes(part), 0);
	let bytes = nameBytes + 32;
	for (const [field, value] of Object.entries(ref.data())) {
		const fieldBytes = stringBytes(field);
		const values = Array.isArray(value) ? value : [value, value];
		bytes +=
			fieldBytes +
			(Array.isArray(value) ? value.length * 8 : stringBytes(value));
		for (const entry of values)
			bytes +=
				nameBytes +
				parentBytes +
				fieldBytes +
				(typeof entry === "number" ? 8 : Math.min(stringBytes(entry), 1500)) +
				32;
	}
	return bytes;
}

function indexedChildren(length = 30_000) {
	return Array.from({ length: 3 }, (_, i) =>
		child(
			String(i).padStart(20, "0"),
			Array.from({ length }, (_, value) => value),
			"recurring",
		),
	);
}
const childRef = child("child");
let children = [childRef];
let committed: unknown[][];
let attempted: unknown[][];
const readClaim = jest.fn(() => homeRef.get());
const childCollection = { id: "nodes", listDocuments: async () => children };
const doc = jest.fn(() => homeRef);
const collection = jest.fn(() => ({ doc }));

jest.unstable_mockModule("./firestore.js", () => ({
	db: {
		collection,
		getAll: async (...refs: typeof children) =>
			refs.map((ref) => ({ ref, data: ref.data })),
		runTransaction: async (run: (transaction: unknown) => unknown) => {
			const deleted: unknown[] = [];
			const result = await run({
				get: readClaim,
				update: (_ref: unknown, data: { deletionClaim?: unknown }) => {
					if (data.deletionClaim) claim = data.deletionClaim;
				},
				delete: (ref: unknown) => {
					remove(ref);
					deleted.push(ref);
				},
			});
			attempted.push(deleted);
			const bytes = children
				.filter((ref) => deleted.includes(ref))
				.reduce((total, ref) => total + deletionBytes(ref), 0);
			if (bytes > 10 * 1024 * 1024)
				throw Object.assign(
					new Error(
						"3 INVALID_ARGUMENT: Transaction too big. Decrease transaction size.",
					),
					{ code: 3 },
				);
			if (deleted.length > 500) throw new Error("transaction limit exceeded");
			committed.push(deleted);
			children = children.filter((ref) => !deleted.includes(ref));
			return result;
		},
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
	children = [childRef];
	committed = [];
	attempted = [];
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
	it("bisects indexed-array chunks exceeding the transaction size limit and checks each claim", async () => {
		const documents = indexedChildren();
		children = [...documents];
		expect(documents.map(deletionBytes)).toEqual([
			4_320_099, 4_320_099, 4_320_099,
		]);

		await deleteHomeTree("home-1", "claim");

		expect(attempted.map((chunk) => chunk.length)).toEqual([3, 1, 2, 1]);
		expect(committed).toEqual([[documents[0]], documents.slice(1), [homeRef]]);
		expect(readClaim).toHaveBeenCalledTimes(attempted.length);
	});

	it("bisects oversized indexed-array pairs down to single-document transactions", async () => {
		const documents = indexedChildren(39_000);
		children = [...documents];

		await deleteHomeTree("home-1", "claim");

		expect(attempted.map((chunk) => chunk.length)).toEqual([2, 1, 1, 1, 1]);
		expect(committed).toEqual([...documents.map((ref) => [ref]), [homeRef]]);
		expect(readClaim).toHaveBeenCalledTimes(attempted.length);
	});

	it("stops split retries after claim replacement and resumes without duplicate deletions", async () => {
		const documents = indexedChildren();
		children = [...documents];
		readClaim.mockImplementationOnce(() => homeRef.get());
		readClaim.mockImplementationOnce(async () => {
			const current = claim;
			claim = { id: "replacement", expiresAt: Timestamp.fromMillis(0) };
			return { data: () => ({ members: members ?? {} }), get: () => current };
		});

		await expect(deleteHomeTree("home-1", "claim")).rejects.toThrow("blocked");
		expect(committed).toEqual([[documents[0]]]);
		expect(readClaim).toHaveBeenCalledTimes(3);
		expect(remove).not.toHaveBeenCalledWith(homeRef);

		claim = {
			id: "retry",
			expiresAt: Timestamp.fromMillis(Date.now() + 600_000),
		};
		await deleteHomeTree("home-1", "retry");
		expect(committed.flat()).toEqual([...documents, homeRef]);
	});

	it("surfaces a transaction size error for a single document without retrying", async () => {
		const error = Object.assign(new Error("Transaction too big"), { code: 3 });
		remove.mockImplementationOnce(() => {
			throw error;
		});

		await expect(deleteHomeTree("home-1", "claim")).rejects.toBe(error);
		expect(readClaim).toHaveBeenCalledTimes(1);
		expect(committed).toEqual([]);
	});

	it("does not bisect unrelated INVALID_ARGUMENT failures", async () => {
		children = indexedChildren();
		const error = Object.assign(new Error("Invalid field path"), { code: 3 });
		remove.mockImplementationOnce(() => {
			throw error;
		});

		await expect(deleteHomeTree("home-1", "claim")).rejects.toBe(error);
		expect(readClaim).toHaveBeenCalledTimes(1);
		expect(committed).toEqual([]);
	});

	it("bounds small-document chunks by document count", async () => {
		children = Array.from({ length: 501 }, (_, i) => child(String(i)));
		await deleteHomeTree("home-1", "claim");

		expect(committed.map((chunk) => chunk.length)).toEqual([500, 1, 1]);
		expect(readClaim).toHaveBeenCalledTimes(3);
	});

	it("bounds deletion chunks by bytes as well as document count", async () => {
		const documents = Array.from({ length: 501 }, (_, i) =>
			child(String(i), "å".repeat(15_000)),
		);
		children = [...documents];
		await deleteHomeTree("home-1", "claim");

		expect(committed.length).toBeGreaterThan(3);
		expect(committed.flat()).toEqual([...documents, homeRef]);
		expect(readClaim).toHaveBeenCalledTimes(committed.length);
	});

	it("deletes a document above the estimated byte budget alone", async () => {
		const large = child("large", "x".repeat(600_000));
		children = [childRef, large, child("last")];
		await deleteHomeTree("home-1", "claim");

		expect(committed).toContainEqual([large]);
		expect(committed.flat()).toHaveLength(4);
	});

	it("revalidates the claim between byte-bounded chunks and retries remaining documents", async () => {
		const documents = Array.from({ length: 100 }, (_, i) =>
			child(String(i), "x".repeat(30_000)),
		);
		children = [...documents];
		readClaim.mockImplementationOnce(async () => {
			const current = claim;
			claim = { id: "replacement", expiresAt: Timestamp.fromMillis(0) };
			return { data: () => ({ members: members ?? {} }), get: () => current };
		});

		await expect(deleteHomeTree("home-1", "claim")).rejects.toThrow("blocked");
		expect(committed).toHaveLength(1);
		expect(committed[0].length).toBeLessThan(documents.length);
		expect(remove).not.toHaveBeenCalledWith(homeRef);
		claim = {
			id: "retry",
			expiresAt: Timestamp.fromMillis(Date.now() + 600_000),
		};
		await deleteHomeTree("home-1", "retry");
		expect(committed.flat()).toEqual([...documents, homeRef]);
	});

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
