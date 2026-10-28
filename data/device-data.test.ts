import AsyncStorage from "@react-native-async-storage/async-storage";
import { signOut } from "firebase/auth";
import { clearIndexedDbPersistence, terminate } from "firebase/firestore";
import { auth, db } from "@/config/firebase";
import { clearDeviceData as clearNativeDeviceData } from "@/data/device-data";
import { clearDeviceData } from "@/data/device-data.web";

jest.mock("@react-native-async-storage/async-storage", () => ({
	clear: jest.fn(),
}));
jest.mock("firebase/auth", () => ({ signOut: jest.fn() }));
jest.mock("firebase/firestore", () => ({
	terminate: jest.fn(),
	clearIndexedDbPersistence: jest.fn(),
}));
jest.mock("@/config/firebase", () => ({ auth: {}, db: {} }));

const replace = jest.fn();
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

beforeEach(() => {
	jest.resetAllMocks();
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: { location: { replace } },
	});
});

afterEach(() => {
	if (originalWindow) {
		Object.defineProperty(globalThis, "window", originalWindow);
	} else {
		Reflect.deleteProperty(globalThis, "window");
	}
});

it("clears storage, terminates and erases Firestore, signs out, then reloads login", async () => {
	const calls: string[] = [];
	jest.mocked(AsyncStorage.clear).mockImplementation(async () => {
		calls.push("storage");
	});
	jest.mocked(terminate).mockImplementation(async () => {
		calls.push("terminate");
	});
	jest.mocked(clearIndexedDbPersistence).mockImplementation(async () => {
		calls.push("cache");
	});
	jest.mocked(signOut).mockImplementation(async () => {
		calls.push("signOut");
	});
	replace.mockImplementation(() => calls.push("reload"));

	await clearDeviceData();

	expect(calls).toEqual(["storage", "terminate", "cache", "signOut", "reload"]);
	expect(terminate).toHaveBeenCalledWith(db);
	expect(clearIndexedDbPersistence).toHaveBeenCalledWith(db);
	expect(signOut).toHaveBeenCalledWith(auth);
	expect(replace).toHaveBeenCalledWith("/login");
});

it.each([AsyncStorage.clear, terminate, clearIndexedDbPersistence, signOut])(
	"propagates cleanup failure without reloading",
	async (step) => {
		const failure = new Error("cleanup failed");
		jest.mocked(step).mockRejectedValueOnce(failure);
		await expect(clearDeviceData()).rejects.toBe(failure);
		expect(replace).not.toHaveBeenCalled();
	},
);

it("clears native storage before signing out without terminating its memory cache", async () => {
	await clearNativeDeviceData();
	expect(AsyncStorage.clear).toHaveBeenCalledTimes(1);
	expect(signOut).toHaveBeenCalledWith(auth);
	expect(
		jest.mocked(AsyncStorage.clear).mock.invocationCallOrder[0],
	).toBeLessThan(jest.mocked(signOut).mock.invocationCallOrder[0]);
	expect(terminate).not.toHaveBeenCalled();
	expect(clearIndexedDbPersistence).not.toHaveBeenCalled();
	expect(replace).not.toHaveBeenCalled();
});
