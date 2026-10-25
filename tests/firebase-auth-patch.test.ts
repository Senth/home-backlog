import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";

describe.each(["browser-cjs/index-DBOuNQej.js", "esm/index-4NFEPWkC.js"])(
	"stored-session initialization in %s",
	(file) => {
		const source = readFileSync(
			`node_modules/@firebase/auth/dist/${file}`,
			"utf8",
		);
		const start = source.indexOf(
			"async reloadAndSetCurrentUserOrClear(user) {",
		);
		const method = source.slice(
			start,
			source.indexOf("    useDeviceLanguage()", start),
		);
		const user = { uid: "stored-user" };
		let resolveReload: () => void;
		let rejectReload: (error: { code: string }) => void;
		let reload: jest.Mock;
		let auth: {
			currentUser: typeof user | null;
			directlySetCurrentUser: jest.Mock;
			_persistUserIfCurrent: jest.Mock;
			_updateCurrentUser: jest.Mock;
			reloadAndSetCurrentUserOrClear: (
				storedUser: typeof user,
			) => Promise<void>;
		};

		beforeEach(() => {
			const pending = new Promise<void>((resolve, reject) => {
				resolveReload = resolve;
				rejectReload = reject;
			});
			reload = jest.fn(() => pending);
			auth = {
				currentUser: null,
				directlySetCurrentUser: jest.fn(async (nextUser) => {
					auth.currentUser = nextUser;
				}),
				_persistUserIfCurrent: jest.fn(async () => {}),
				_updateCurrentUser: jest.fn(async (nextUser) => {
					auth.currentUser = nextUser;
				}),
				...runInNewContext(`({ ${method} })`, { _reloadWithoutSaving: reload }),
			};
		});

		it("resolves with the stored user before the network answers, then persists the refresh", async () => {
			let initialized = false;
			const initialization = auth
				.reloadAndSetCurrentUserOrClear(user)
				.then(() => {
					initialized = true;
				});
			await setImmediate();
			expect(auth.currentUser).toBe(user);
			expect(initialized).toBe(true);
			expect(reload).toHaveBeenCalledWith(user);
			expect(auth._persistUserIfCurrent).not.toHaveBeenCalled();
			resolveReload();
			await initialization;
			await setImmediate();
			expect(auth._persistUserIfCurrent).toHaveBeenCalledWith(user);
			expect(auth.directlySetCurrentUser).toHaveBeenCalledTimes(1);
		});

		it.each([
			["auth/network-request-failed", false],
			["auth/user-disabled", true],
			["auth/user-token-expired", true],
			["auth/user-not-found", true],
		])("handles %s without blocking initialization", async (code, signOut) => {
			const initialization = auth.reloadAndSetCurrentUserOrClear(user);
			await setImmediate();
			rejectReload({ code });
			await initialization;
			await setImmediate();
			expect(auth.currentUser).toBe(signOut ? null : user);
			expect(auth._updateCurrentUser.mock.calls).toEqual(
				signOut ? [[null]] : [],
			);
			expect(auth.directlySetCurrentUser.mock.calls).toEqual([[user]]);
			expect(auth._persistUserIfCurrent).not.toHaveBeenCalled();
		});

		it.each([null, { uid: "new-user" }])(
			"does not clear a changed session after a stale reload fails: %p",
			async (nextUser) => {
				const initialization = auth.reloadAndSetCurrentUserOrClear(user);
				await setImmediate();
				auth.currentUser = nextUser;
				rejectReload({ code: "auth/user-token-expired" });
				await initialization;
				await setImmediate();
				expect(auth.currentUser).toBe(nextUser);
				expect(auth._updateCurrentUser).not.toHaveBeenCalled();
				expect(auth.directlySetCurrentUser.mock.calls).toEqual([[user]]);
			},
		);

		it("does not restore the stored user after sign-out during a successful reload", async () => {
			const initialization = auth.reloadAndSetCurrentUserOrClear(user);
			await setImmediate();
			auth.currentUser = null;
			resolveReload();
			await initialization;
			await setImmediate();
			expect(auth.currentUser).toBeNull();
			expect(auth._persistUserIfCurrent).toHaveBeenCalledWith(user);
			expect(auth.directlySetCurrentUser.mock.calls).toEqual([[user]]);
		});
	},
);
