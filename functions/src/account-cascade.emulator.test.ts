import { randomUUID } from "node:crypto";
import { jest } from "@jest/globals";

jest.unstable_mockModule("firebase-admin/auth", () => ({
	getAuth: () => ({ deleteUser: async () => {} }),
}));

const { db } = await import("./firestore.js");
const { deleteAccount } = await import("./delete-account.js");
const { deleteHome } = await import("./delete-home.js");
const { homeAccess } = await import("./auth.js");
const enabled = process.env.CASCADE_EMULATOR_TESTS === "1";

(enabled ? describe : describe.skip)(
	"account cascade on Firestore emulator",
	() => {
		const uid = `cascade-${randomUUID()}`;
		const other = `${uid}-other`;
		const home = db.collection("homes").doc(uid);
		const nodes = home.collection("nodes");
		const call = (caller = uid) =>
			deleteAccount.run({
				data: { dryRun: false },
				auth: { uid: caller, token: { auth_time: Date.now() / 1000 } },
			} as Parameters<typeof deleteAccount.run>[0]);
		const removeHome = () =>
			deleteHome.run({
				data: { homeId: home.id },
				auth: { uid, token: {} },
			} as Parameters<typeof deleteHome.run>[0]);

		function node(overrides: Record<string, unknown> = {}) {
			return {
				title: "Project",
				parentId: null,
				ancestorIds: [],
				participantIds: [uid],
				assigneeIds: [uid],
				visibility: "shared",
				status: "backlog",
				columns: ["backlog"],
				rank: "a0",
				childCount: 0,
				doneCount: 0,
				locationId: null,
				locationAncestorIds: [],
				blockedBy: [],
				dueDate: null,
				priority: null,
				effort: null,
				notes: "",
				checklist: [],
				archived: false,
				completedAt: null,
				createdAt: new Date(),
				updatedAt: new Date(),
				createdBy: uid,
				...overrides,
			};
		}

		async function patchAs(
			caller: string,
			path: string,
			fields: Record<string, unknown>,
		) {
			const project = process.env.GCLOUD_PROJECT;
			const encode = (value: unknown) =>
				Buffer.from(JSON.stringify(value)).toString("base64url");
			const token = `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: caller, user_id: caller, aud: project, iss: `https://securetoken.google.com/${project}`, iat: Date.now() / 1000, exp: Date.now() / 1000 + 3600, firebase: { sign_in_provider: "custom" } })}.`;
			const mask = Object.keys(fields)
				.map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
				.join("&");
			return fetch(
				`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${project}/databases/(default)/documents/${path}?${mask}`,
				{
					method: "PATCH",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ fields }),
				},
			);
		}

		beforeAll(() => {
			if (!process.env.FIRESTORE_EMULATOR_HOST)
				throw new Error("Firestore emulator required");
		});
		beforeEach(async () => {
			await db.recursiveDelete(home);
			await home.set({
				name: "Cascade test",
				members: { [uid]: "owner", [other]: "owner" },
			});
		});
		afterEach(async () => {
			jest.restoreAllMocks();
			await db.recursiveDelete(home);
		});
		afterAll(async () => {
			await db.terminate();
		});

		it("serializes concurrent owner departures and leaves an owner", async () => {
			let entered: () => void = () => {};
			let resume: () => void = () => {};
			const paused = new Promise<void>((resolve) => {
				entered = resolve;
			});
			const released = new Promise<void>((resolve) => {
				resume = resolve;
			});
			const prototype = Object.getPrototypeOf(home) as typeof home;
			const update = prototype.update;
			let waiting = false;
			jest.spyOn(prototype, "update").mockImplementation(async function (
				this: typeof home,
				...args: Parameters<typeof home.update>
			) {
				if (this.path === home.path && !waiting) {
					waiting = true;
					entered();
					await released;
				}
				return update.apply(this, args);
			});
			const first = call();
			await paused;
			try {
				await expect(call(other)).rejects.toMatchObject({
					code: "failed-precondition",
				});
			} finally {
				resume();
				await first;
			}
			const remaining = (await home.get()).get("members") as Record<
				string,
				string
			>;
			expect(Object.values(remaining)).toEqual(["owner"]);
		});

		it("blocks server API access while cleanup owns the home", async () => {
			await home.update({ deletionClaim: uid });
			await expect(
				homeAccess(
					{
						uid: other,
						keyId: "test",
						keyName: "test",
						keyRef: db.doc(`users/${other}/apiKeys/test`),
					},
					home.id,
				),
			).rejects.toMatchObject({ status: 404 });
		});

		it("rejects invite acceptance while a sole home is claimed for deletion", async () => {
			await home.update({ members: { [uid]: "owner" } });
			await nodes.doc("root").set(node());
			const recursiveDelete = db.recursiveDelete.bind(db);
			let status: number | undefined;
			jest.spyOn(db, "recursiveDelete").mockImplementation(async (ref) => {
				if (status === undefined) {
					status = (
						await patchAs(uid, home.path, {
							members: {
								mapValue: {
									fields: {
										[uid]: { stringValue: "owner" },
										[other]: { stringValue: "member" },
									},
								},
							},
						})
					).status;
				}
				return recursiveDelete(ref);
			});
			await removeHome();
			expect(status).toBe(403);
		});

		it("promotes surviving private subtrees and repairs counters before a retry", async () => {
			await nodes
				.doc("parent")
				.set(node({ visibility: "private", childCount: 2 }));
			await nodes.doc("deleted").set(
				node({
					visibility: "private",
					parentId: "parent",
					ancestorIds: ["parent"],
				}),
			);
			await nodes.doc("kept").set(
				node({
					visibility: "private",
					parentId: "parent",
					ancestorIds: ["parent"],
					participantIds: [uid, other],
					childCount: 1,
					doneCount: 1,
				}),
			);
			await nodes.doc("grandchild").set(
				node({
					visibility: "private",
					parentId: "kept",
					ancestorIds: ["parent", "kept"],
					participantIds: [uid, other],
					status: "done",
					completedAt: new Date(),
				}),
			);
			const prototype = Object.getPrototypeOf(home) as typeof home;
			const remove = prototype.delete;
			let failed = false;
			jest.spyOn(prototype, "delete").mockImplementation(function (
				this: typeof home,
				...args: Parameters<typeof home.delete>
			) {
				if (this.path === nodes.doc("parent").path && !failed) {
					failed = true;
					return Promise.reject(new Error("node cleanup interrupted"));
				}
				return remove.apply(this, args);
			});
			await expect(call()).rejects.toThrow("node cleanup interrupted");
			expect((await nodes.doc("deleted").get()).exists).toBe(false);
			expect((await nodes.doc("parent").get()).exists).toBe(true);
			jest.restoreAllMocks();
			await call();
			expect((await nodes.doc("parent").get()).exists).toBe(false);
			expect((await nodes.doc("kept").get()).data()).toMatchObject({
				parentId: null,
				ancestorIds: [],
				participantIds: [other],
				childCount: 1,
				doneCount: 1,
			});
			expect((await nodes.doc("grandchild").get()).data()).toMatchObject({
				parentId: "kept",
				ancestorIds: ["kept"],
			});
		});

		it("keeps a shared root editable by remaining members", async () => {
			await nodes.doc("root").set(node());
			await call();
			expect((await nodes.doc("root").get()).get("participantIds")).toEqual([
				other,
			]);
			const response = await patchAs(other, `${nodes.path}/root`, {
				title: { stringValue: "Still editable" },
			});
			expect(await response.text()).not.toContain("PERMISSION_DENIED");
			expect(response.status).toBe(200);
		});

		it("retains the home when descendant deletion fails and retries the callable", async () => {
			await home.update({ members: { [uid]: "owner" } });
			await nodes.doc("root").set(node());
			jest.spyOn(db, "recursiveDelete").mockImplementationOnce(async (ref) => {
				if (ref.path === home.path) await home.delete();
				throw new Error("descendant failed");
			});
			await expect(removeHome()).rejects.toThrow("descendant failed");
			expect((await home.get()).exists).toBe(true);
			jest.restoreAllMocks();
			await removeHome();
			expect((await home.get()).exists).toBe(false);
			expect((await nodes.get()).empty).toBe(true);
		});
	},
);
