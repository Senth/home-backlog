import { randomUUID } from "node:crypto";
import { jest } from "@jest/globals";
import express from "express";
import { Timestamp } from "firebase-admin/firestore";

jest.unstable_mockModule("firebase-admin/auth", () => ({
	getAuth: () => ({ deleteUser: async () => {} }),
}));

const { db } = await import("./firestore.js");
const { deleteAccount } = await import("./delete-account.js");
const { deleteHome } = await import("./delete-home.js");
const { homeAccess, homeWrite, recordWrite } = await import("./auth.js");
const { registerWriteRoutes } = await import("./writes.js");
const { registerLocationRoutes } = await import("./locations.js");
const { registerLabelRoutes } = await import("./labels.js");
const { registerCardRoutes } = await import("./cards.js");
const { registerBulkRoute } = await import("./bulk-route.js");
const enabled = process.env.CASCADE_EMULATOR_TESTS === "1";

(enabled ? describe : describe.skip)(
	"account cascade on Firestore emulator",
	() => {
		const uid = `cascade-${randomUUID()}`;
		const other = `${uid}-other`;
		const home = db.collection("homes").doc(uid);
		const nodes = home.collection("nodes");
		const apiCaller = {
			uid: other,
			keyId: "test",
			keyName: "test",
			keyRef: db.doc(`users/${other}/apiKeys/test`),
		};
		function pauseParticipants() {
			let entered!: () => void;
			let resume!: () => void;
			const paused = new Promise<void>((resolve) => {
				entered = resolve;
			});
			const released = new Promise<void>((resolve) => {
				resume = resolve;
			});
			const prototype = Object.getPrototypeOf(
				nodes.where("archived", "==", false),
			);
			const get = prototype.get;
			let waiting = false;
			jest.spyOn(prototype, "get").mockImplementation(async function (
				this: typeof nodes,
			) {
				const snapshot = await get.call(this);
				if (
					this.path === nodes.path &&
					!waiting &&
					(await home.get()).get("deletionClaim")
				) {
					waiting = true;
					entered();
					await released;
				}
				return snapshot;
			});
			return { paused, resume };
		}
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
			const pause = pauseParticipants();
			const first = call();
			await pause.paused;
			try {
				await expect(call(other)).rejects.toMatchObject({
					code: "failed-precondition",
				});
			} finally {
				pause.resume();
				await first;
			}
			const remaining = (await home.get()).get("members") as Record<
				string,
				string
			>;
			expect(Object.values(remaining)).toEqual(["owner"]);
		});

		it("blocks server API access while cleanup owns the home", async () => {
			await home.update({
				deletionClaim: {
					id: "active",
					uid,
					expiresAt: Timestamp.fromMillis(Date.now() + 600_000),
				},
			});
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

		it("lets a remaining owner recover an abandoned invocation after expiry", async () => {
			await home.update({
				deletionClaim: {
					id: "abandoned",
					uid,
					expiresAt: Timestamp.fromMillis(Date.now() - 1000),
				},
			});
			const response = await patchAs(other, home.path, {
				name: { stringValue: "Recovered" },
			});
			expect(response.status).toBe(200);
			await expect(homeAccess(apiCaller, home.id)).resolves.toMatchObject({
				homeId: home.id,
			});
			await call(other);
			expect((await home.get()).get("members")).toEqual({ [uid]: "owner" });
		});

		it("rejects same-user overlapping invocations without releasing the first claim", async () => {
			await nodes.doc("root").set(node());
			const pause = pauseParticipants();
			const first = call();
			await pause.paused;
			try {
				await expect(call()).rejects.toMatchObject({
					code: "failed-precondition",
				});
				expect(
					(
						await patchAs(other, `${nodes.path}/root`, {
							participantIds: {
								arrayValue: { values: [{ stringValue: other }] },
							},
						})
					).status,
				).toBe(403);
			} finally {
				pause.resume();
				await first;
			}
		});

		it("fences expired cleanup against a newer invocation and surviving member edits", async () => {
			await nodes.doc("root").set(node());
			const pause = pauseParticipants();
			const first = call();
			const stopped = expect(first).rejects.toMatchObject({
				code: "failed-precondition",
			});
			await pause.paused;
			try {
				await home.update({
					"deletionClaim.expiresAt": Timestamp.fromMillis(0),
				});
				await call(other);
				expect(
					(
						await patchAs(uid, `${nodes.path}/root`, {
							title: { stringValue: "Keep this edit" },
						})
					).status,
				).toBe(200);
			} finally {
				pause.resume();
				await stopped;
			}
			expect((await nodes.doc("root").get()).get("title")).toBe(
				"Keep this edit",
			);
			expect((await home.get()).get("members")).toEqual({ [uid]: "owner" });
		});

		it.each([
			["nodes", { title: "Late node" }],
			["nodes:bulk", { nodes: [{ ref: "root", title: "Late tree" }] }],
			["locations", { title: "Late place" }],
			[
				"locations:bulk",
				{ locations: [{ ref: "root", title: "Late places" }] },
			],
			["labels", { title: "Late label", icon: "home", color: "red" }],
			["cards", { title: "Late card", scope: "shared" }],
		] as const)(
			"rejects in-flight %s writes crossing home deletion",
			async (path, body) => {
				await home.update({ members: { [uid]: "owner" } });
				const me = { ...apiCaller, uid };
				const app = express();
				app.use(express.json());
				app.use((_request, response, next) => {
					response.locals.caller = me;
					next();
				});
				for (const register of [
					registerWriteRoutes,
					registerLocationRoutes,
					registerLabelRoutes,
					registerCardRoutes,
					registerBulkRoute,
				])
					register(app);
				app.use(
					(
						error: { status?: number },
						_request: express.Request,
						response: express.Response,
						_next: express.NextFunction,
					) => {
						response.status(error.status ?? 500).json(error);
					},
				);
				const server = app.listen(0, "127.0.0.1");
				await new Promise<void>((resolve) => server.once("listening", resolve));
				let entered!: () => void;
				let resume!: () => void;
				const paused = new Promise<void>((resolve) => {
					entered = resolve;
				});
				const released = new Promise<void>((resolve) => {
					resume = resolve;
				});
				const prototype = Object.getPrototypeOf(home) as typeof home;
				const get = prototype.get;
				let waiting = false;
				jest.spyOn(prototype, "get").mockImplementation(async function (
					this: typeof home,
					...args: Parameters<typeof home.get>
				) {
					const snapshot = await get.apply(this, args);
					if (this.path === home.path && !waiting) {
						waiting = true;
						entered();
						await released;
					}
					return snapshot;
				});
				const address = server.address() as { port: number };
				const pending = fetch(
					`http://127.0.0.1:${address.port}/homes/${home.id}/${path}`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(body),
					},
				);
				await paused;
				try {
					await removeHome();
					resume();
					expect((await pending).status).toBe(404);
					expect((await home.get()).exists).toBe(false);
					for (const collection of await home.listCollections())
						expect((await collection.get()).empty).toBe(true);
				} finally {
					resume();
					await pending;
					await new Promise<void>((resolve, reject) =>
						server.close((error) => (error ? reject(error) : resolve())),
					);
				}
			},
		);

		it("does not recreate automation bookkeeping after deletion", async () => {
			const access = await homeAccess(apiCaller, home.id);
			await home.update({ members: { [uid]: "owner" } });
			await removeHome();
			await recordWrite(apiCaller, access);
			expect((await home.collection("apiClients").get()).empty).toBe(true);
		});

		it("rejects a pre-cleanup write even after the claim is released for a surviving member", async () => {
			const access = await homeAccess(apiCaller, home.id);
			await call();
			await expect(
				homeWrite(apiCaller, access, (transaction) =>
					transaction.set(nodes.doc("late"), node()),
				),
			).rejects.toMatchObject({ status: 409, code: "home_changed" });
			await recordWrite(apiCaller, access);
			expect((await nodes.doc("late").get()).exists).toBe(false);
			expect((await home.collection("apiClients").get()).empty).toBe(true);
			const current = await homeAccess(apiCaller, home.id);
			await homeWrite(apiCaller, current, (transaction) =>
				transaction.set(nodes.doc("new"), node({ participantIds: [other] })),
			);
			expect((await nodes.doc("new").get()).exists).toBe(true);
		});

		it("rejects invite acceptance while a sole home is claimed for deletion", async () => {
			await home.update({ members: { [uid]: "owner" } });
			await nodes.doc("root").set(node());
			const prototype = Object.getPrototypeOf(home) as typeof home;
			const listCollections = prototype.listCollections;
			let status: number | undefined;
			jest
				.spyOn(prototype, "listCollections")
				.mockImplementation(async function (this: typeof home) {
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
					return listCollections.call(this);
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
			const prototype = await db.runTransaction(
				async (transaction) =>
					Object.getPrototypeOf(transaction) as typeof transaction,
			);
			const remove = prototype.delete;
			let failed = false;
			jest.spyOn(prototype, "delete").mockImplementation(function (
				this: typeof prototype,
				...args: Parameters<typeof prototype.delete>
			) {
				if (args[0].path === nodes.doc("parent").path && !failed) {
					failed = true;
					throw new Error("node cleanup interrupted");
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
			const prototype = await db.runTransaction(
				async (transaction) =>
					Object.getPrototypeOf(transaction) as typeof transaction,
			);
			jest.spyOn(prototype, "delete").mockImplementationOnce(() => {
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
