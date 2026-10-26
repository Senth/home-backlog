import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";

function storedUser(uid = "stored-user") {
	return { uid, _stopProactiveRefresh: jest.fn() };
}

type User = ReturnType<typeof storedUser>;
interface Auth {
	currentUser: User | null;
	operations: Promise<void>;
	_isInitialized: boolean;
	persistenceManager: {
		setCurrentUser: jest.Mock;
		removeCurrentUser: jest.Mock;
	};
	beforeStateQueue: { runMiddleware: jest.Mock };
	authStateSubscription: { next: jest.Mock };
	idTokenSubscription: { next: jest.Mock };
	queue: (action: () => Promise<void>) => Promise<void>;
	_updateCurrentUser: (user: User | null) => Promise<void>;
	reloadAndSetCurrentUserOrClear: (user: User) => Promise<void>;
}

describe.each(["browser-cjs/index-DBOuNQej.js", "esm/index-4NFEPWkC.js"])(
	"stored-session initialization in %s",
	(file) => {
		const source = readFileSync(
			`node_modules/@firebase/auth/dist/${file}`,
			"utf8",
		);
		const start = source.indexOf("class AuthImpl {");
		const authClass = source.slice(start, source.indexOf("\n}\n", start) + 2);
		let user: User;
		let resolveReload: () => void;
		let rejectReload: (error: { code: string }) => void;
		let reload: jest.Mock;
		let auth: Auth;

		beforeEach(() => {
			user = storedUser();
			const pending = new Promise<void>((resolve, reject) => {
				resolveReload = resolve;
				rejectReload = reject;
			});
			reload = jest.fn(() => pending);
			const AuthImpl = runInNewContext(`(${authClass})`, {
				_reloadWithoutSaving: reload,
				_assert: (condition: boolean) => {
					if (!condition) throw new Error("Auth assertion failed");
				},
				_errorWithCustomMessage: (
					_auth: unknown,
					code: string,
					message: string,
				) => Object.assign(new Error(message), { code }),
			});
			auth = Object.assign(Object.create(AuthImpl.prototype), {
				currentUser: null,
				operations: Promise.resolve(),
				_isInitialized: true,
				persistenceManager: {
					setCurrentUser: jest.fn().mockResolvedValue(undefined),
					removeCurrentUser: jest.fn().mockResolvedValue(undefined),
				},
				beforeStateQueue: {
					runMiddleware: jest.fn().mockResolvedValue(undefined),
				},
				authStateSubscription: { next: jest.fn() },
				idTokenSubscription: { next: jest.fn() },
			});
		});

		it("resolves with the stored user before the network answers, then persists the refresh", async () => {
			let initialized = false;
			const initialization = auth
				.queue(() => auth.reloadAndSetCurrentUserOrClear(user))
				.then(() => {
					initialized = true;
				});
			await setImmediate();
			expect(auth.currentUser).toBe(user);
			expect(initialized).toBe(true);
			expect(reload).toHaveBeenCalledWith(user);
			expect(auth.persistenceManager.setCurrentUser).toHaveBeenCalledTimes(1);
			resolveReload();
			await initialization;
			await setImmediate();
			expect(auth.persistenceManager.setCurrentUser.mock.calls).toEqual([
				[user],
				[user],
			]);
		});

		it.each([
			["auth/network-request-failed", false],
			["auth/user-disabled", true],
			["auth/user-token-expired", true],
			["auth/user-not-found", true],
		])("handles %s without blocking initialization", async (code, signOut) => {
			await auth.queue(() => auth.reloadAndSetCurrentUserOrClear(user));
			rejectReload({ code });
			await setImmediate();
			expect(auth.currentUser).toBe(signOut ? null : user);
			expect(auth.authStateSubscription.next.mock.calls).toEqual(
				signOut ? [[null]] : [],
			);
			expect(auth.persistenceManager.setCurrentUser).toHaveBeenCalledTimes(1);
		});

		it.each([null, storedUser("new-user")])(
			"does not clear a changed session after a stale reload fails: %p",
			async (nextUser) => {
				await auth.queue(() => auth.reloadAndSetCurrentUserOrClear(user));
				await auth._updateCurrentUser(nextUser);
				rejectReload({ code: "auth/user-token-expired" });
				await setImmediate();
				expect(auth.currentUser).toBe(nextUser);
				expect(auth.authStateSubscription.next.mock.calls).toEqual([
					[nextUser],
				]);
			},
		);

		it.each(["success", "revoked"])(
			"checks identity inside the real queue after queued sign-out: %s",
			async (result) => {
				await auth.queue(() => auth.reloadAndSetCurrentUserOrClear(user));
				let release!: () => void;
				void auth.queue(
					() =>
						new Promise<void>((resolve) => {
							release = resolve;
						}),
				);
				const signOut = auth._updateCurrentUser(null);
				await setImmediate();
				if (result === "success") resolveReload();
				else rejectReload({ code: "auth/user-token-expired" });
				await setImmediate();
				release();
				await signOut;
				await setImmediate();
				expect(auth.currentUser).toBeNull();
				expect(auth.persistenceManager.setCurrentUser.mock.calls).toEqual([
					[user],
				]);
				expect(auth.authStateSubscription.next.mock.calls).toEqual([[null]]);
			},
		);

		it("does not clear a replacement sign-in queued before a revoked reload", async () => {
			await auth.queue(() => auth.reloadAndSetCurrentUserOrClear(user));
			let release!: () => void;
			void auth.queue(
				() =>
					new Promise<void>((resolve) => {
						release = resolve;
					}),
			);
			const replacement = storedUser("replacement");
			const signIn = auth._updateCurrentUser(replacement);
			await setImmediate();
			rejectReload({ code: "auth/user-token-expired" });
			await setImmediate();
			release();
			await signIn;
			await setImmediate();
			expect(auth.currentUser).toBe(replacement);
			expect(auth.authStateSubscription.next.mock.calls).toEqual([
				[replacement],
			]);
			expect(auth.persistenceManager.removeCurrentUser).not.toHaveBeenCalled();
		});

		it("keeps the validated user in memory when background persistence fails without detached rejection", async () => {
			await auth.queue(() => auth.reloadAndSetCurrentUserOrClear(user));
			auth.persistenceManager.setCurrentUser.mockRejectedValueOnce(
				new Error("storage unavailable"),
			);
			resolveReload();
			await setImmediate();
			expect(auth.currentUser).toBe(user);
			await expect(auth.queue(async () => {})).resolves.toBeUndefined();
		});

		it("preserves the session when sign-out middleware rejects without detached rejection", async () => {
			await auth.queue(() => auth.reloadAndSetCurrentUserOrClear(user));
			auth.beforeStateQueue.runMiddleware.mockRejectedValueOnce(
				new Error("sign-out blocked"),
			);
			rejectReload({ code: "auth/user-token-expired" });
			await setImmediate();
			expect(auth.currentUser).toBe(user);
			expect(auth.authStateSubscription.next).not.toHaveBeenCalled();
			expect(auth.persistenceManager.removeCurrentUser).not.toHaveBeenCalled();
			await expect(auth.queue(async () => {})).resolves.toBeUndefined();
		});

		it("notifies sign-out even when removing the revoked user from storage fails without detached rejection", async () => {
			await auth.queue(() => auth.reloadAndSetCurrentUserOrClear(user));
			auth.persistenceManager.removeCurrentUser.mockRejectedValueOnce(
				new Error("storage unavailable"),
			);
			rejectReload({ code: "auth/user-token-expired" });
			await setImmediate();
			expect(auth.currentUser).toBeNull();
			expect(auth.authStateSubscription.next).toHaveBeenCalledWith(null);
			await expect(auth.queue(async () => {})).resolves.toBeUndefined();
		});
	},
);
