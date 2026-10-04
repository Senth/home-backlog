import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { waitForPendingWrites } from "firebase/firestore";
import type { ReactNode } from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";
import { Snackbar } from "react-native-paper";
import { OutboxProvider, useOutbox } from "@/contexts/OutboxContext";
import { replayIntent } from "@/data/outbox-replay";
import type { OutboxIntent } from "@/data/outbox-store";
import { isOnline } from "@/hooks/use-online-status";
import mockEn from "@/i18n/locales/en-US.json";

let mockStore: Record<string, string> = {};
let mockUid = "marcus";
let mockAuthLoading = false;
jest.mock("@react-native-async-storage/async-storage", () => ({
	getItem: jest.fn(async (key: string) => mockStore[key] ?? null),
	setItem: jest.fn(async (key: string, value: string) => {
		mockStore[key] = value;
	}),
}));
jest.mock("@/config/firebase", () => ({ db: {} }));
jest.mock("firebase/firestore", () => ({ waitForPendingWrites: jest.fn() }));
jest.mock("@/contexts/AuthContext", () => ({
	useAuth: () => ({ user: { uid: mockUid }, loading: mockAuthLoading }),
}));
jest.mock("@/data/outbox-replay", () => ({ replayIntent: jest.fn() }));
jest.mock("@/data/nodes", () => ({
	isUnavailable: (reason: { code?: string } | null) =>
		reason?.code === "unavailable",
}));
jest.mock("@/hooks/use-online-status", () => ({ isOnline: jest.fn() }));
jest.mock("react-native-paper", () => ({ Snackbar: jest.fn(() => null) }));
jest.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values: Record<string, unknown> = {}) => {
			const [group, name] = key.split(".");
			const strings = mockEn[group as keyof typeof mockEn] as Record<
				string,
				string
			>;
			const plural = values.count === 1 ? "one" : "other";
			return (strings[`${name}_${plural}`] ?? strings[name]).replace(
				/\{\{(\w+)\}\}/g,
				(_, field: string) => String(values[field]),
			);
		},
	}),
}));

const intent: OutboxIntent = {
	id: "move-1",
	homeId: "huset",
	kind: "moveLocation",
	queuedAt: 1,
	title: "Workshop",
	sourceParentId: null,
	sourceAncestorIds: [],
	locationId: "workshop",
	parentId: "garden",
	targetTitle: "Garden",
	rank: "a0",
};

function wrapper({ children }: { children: ReactNode }) {
	return <OutboxProvider>{children}</OutboxProvider>;
}

function open() {
	return renderHook(() => useOutbox(), { wrapper });
}

function stored(uid = "marcus"): OutboxIntent[] {
	return JSON.parse(mockStore[`outbox:${uid}`] ?? "[]");
}

function notice() {
	return jest.mocked(Snackbar).mock.calls.at(-1)?.[0];
}

let onlineListener: () => void;
let originalNavigator: PropertyDescriptor | undefined;
let originalWindow: PropertyDescriptor | undefined;

beforeEach(() => {
	mockStore = {};
	mockUid = "marcus";
	mockAuthLoading = false;
	jest.mocked(isOnline).mockReturnValue(false);
	jest.mocked(replayIntent).mockReset().mockResolvedValue();
	jest.mocked(waitForPendingWrites).mockReset().mockResolvedValue();
	jest.replaceProperty(Platform, "OS", "web");
	originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: {},
	});
	originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: {
			addEventListener: jest.fn((event: string, listener: () => void) => {
				if (event === "online") onlineListener = listener;
			}),
			removeEventListener: jest.fn(),
		},
	});
});

afterEach(() => {
	jest.restoreAllMocks();
	if (originalNavigator)
		Object.defineProperty(globalThis, "navigator", originalNavigator);
	else Reflect.deleteProperty(globalThis, "navigator");
	if (originalWindow)
		Object.defineProperty(globalThis, "window", originalWindow);
	else Reflect.deleteProperty(globalThis, "window");
});

it("queues offline, collapses moves, persists across remount, and Undo removes", async () => {
	const first = open();
	const runOnline = jest.fn();
	await act(async () => {
		expect(await first.result.current.submit(intent, runOnline)).toBe("queued");
		await first.result.current.submit(
			{ ...intent, id: "move-2", rank: "a1" },
			runOnline,
		);
	});
	expect(runOnline).not.toHaveBeenCalled();
	expect(stored()).toEqual([{ ...intent, id: "move-2", rank: "a1" }]);
	first.unmount();
	const second = open();
	await waitFor(() => expect(second.result.current.intents).toEqual(stored()));
	await act(async () => second.result.current.undo("move-2"));
	expect(second.result.current.intents).toEqual([]);
	expect(stored()).toEqual([]);
});

it("runs online, queues only unavailable, and rethrows other errors", async () => {
	jest.mocked(isOnline).mockReturnValue(true);
	const hook = open();
	await act(async () => {
		expect(
			await hook.result.current.submit(
				intent,
				jest.fn().mockResolvedValue(undefined),
			),
		).toBe("saved");
		expect(
			await hook.result.current.submit(
				intent,
				jest.fn().mockRejectedValue({ code: "unavailable" }),
			),
		).toBe("queued");
		const reason = { code: "permission-denied" };
		await expect(
			hook.result.current.submit(
				{ ...intent, id: "denied" },
				jest.fn().mockRejectedValue(reason),
			),
		).rejects.toBe(reason);
	});
	expect(stored()).toEqual([intent]);
});

it("drains all homes FIFO on online, after pending Firestore writes", async () => {
	mockStore["outbox:marcus"] = JSON.stringify([
		intent,
		{ ...intent, id: "move-2", homeId: "stugan" },
	]);
	let release!: () => void;
	jest.mocked(waitForPendingWrites).mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
			}),
	);
	const hook = open();
	await waitFor(() => expect(hook.result.current.intents).toHaveLength(2));
	jest.mocked(isOnline).mockReturnValue(true);
	act(() => onlineListener());
	await waitFor(() => expect(waitForPendingWrites).toHaveBeenCalledTimes(1));
	expect(replayIntent).not.toHaveBeenCalled();
	await act(async () => release());
	await waitFor(() => expect(hook.result.current.intents).toEqual([]));
	expect(
		jest.mocked(replayIntent).mock.calls.map(([value]) => value.id),
	).toEqual(["move-1", "move-2"]);
	expect(stored()).toEqual([]);
	expect(notice()?.visible).toBe(false);
});

it.each([{ code: "unavailable" }, new TypeError("Failed to fetch")])(
	"keeps retry and later intents until next reconnect: %p",
	async (reason) => {
		mockStore["outbox:marcus"] = JSON.stringify([
			intent,
			{ ...intent, id: "move-2" },
		]);
		jest.mocked(isOnline).mockReturnValue(true);
		jest.mocked(replayIntent).mockRejectedValueOnce(reason);
		const hook = open();
		await waitFor(() => expect(replayIntent).toHaveBeenCalledTimes(1));
		expect(stored()).toHaveLength(2);
		expect(notice()?.visible).toBe(false);
		act(() => onlineListener());
		await waitFor(() => expect(hook.result.current.intents).toEqual([]));
		expect(replayIntent).toHaveBeenCalledTimes(3);
	},
);

it("refuses and removes, names subject and target, aggregates refusals without action", async () => {
	mockStore["outbox:marcus"] = JSON.stringify([
		intent,
		{ ...intent, id: "move-2" },
		{ ...intent, id: "move-3" },
	]);
	jest.mocked(isOnline).mockReturnValue(true);
	jest
		.mocked(replayIntent)
		.mockRejectedValueOnce({ code: "move-own-subtree" })
		.mockRejectedValueOnce({ code: "target-gone" })
		.mockRejectedValueOnce({ code: "subtree-too-large" });
	const hook = open();
	await waitFor(() => expect(notice()?.visible).toBe(true));
	expect(hook.result.current.intents).toEqual([]);
	expect(stored()).toEqual([]);
	expect(notice()?.children).toBe(
		"Couldn't move Workshop: Garden was moved inside it while you were offline. and 2 more",
	);
	expect(notice()?.action).toBeUndefined();
	act(() => notice()?.onDismiss());
	expect(notice()?.visible).toBe(false);
});

it("names deleted target and reports generic reason for other refusals", async () => {
	mockStore["outbox:marcus"] = JSON.stringify([intent]);
	jest.mocked(isOnline).mockReturnValue(true);
	jest.mocked(replayIntent).mockRejectedValueOnce({ code: "target-gone" });
	const first = open();
	await waitFor(() =>
		expect(notice()?.children).toBe(
			"Couldn't move Workshop: Garden was deleted while you were offline.",
		),
	);
	first.unmount();
	mockStore["outbox:marcus"] = JSON.stringify([intent]);
	jest
		.mocked(replayIntent)
		.mockRejectedValueOnce({ code: "permission-denied" });
	open();
	await waitFor(() =>
		expect(notice()?.children).toBe(
			`Couldn't sync Workshop. ${mockEn.error.saveFailed}`,
		),
	);
});

it.each([
	{ code: "subject-not-found" },
	{ code: "already-at-target" },
	undefined,
])("drops silently: %p", async (reason) => {
	mockStore["outbox:marcus"] = JSON.stringify([intent]);
	jest.mocked(isOnline).mockReturnValue(true);
	if (reason) jest.mocked(replayIntent).mockRejectedValueOnce(reason);
	const hook = open();
	await waitFor(() => expect(stored()).toEqual([]));
	expect(hook.result.current.intents).toEqual([]);
	expect(notice()?.visible).toBe(false);
});

it("second drainer waits on uid lock and reloads queue after first drains", async () => {
	mockStore["outbox:marcus"] = JSON.stringify([intent]);
	jest.mocked(isOnline).mockReturnValue(true);
	const locks = new Map<string, Promise<unknown>>();
	const request = jest.fn((name: string, work: () => Promise<unknown>) => {
		const next = (locks.get(name) ?? Promise.resolve()).then(work);
		locks.set(
			name,
			next.catch(() => {}),
		);
		return next;
	});
	Object.defineProperty(navigator, "locks", { value: { request } });
	let release!: () => void;
	jest.mocked(replayIntent).mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
			}),
	);
	const first = open();
	await waitFor(() => expect(replayIntent).toHaveBeenCalledTimes(1));
	const second = open();
	await waitFor(() =>
		expect(
			request.mock.calls.filter(([name]) => name === "outbox:marcus"),
		).toHaveLength(2),
	);
	expect(replayIntent).toHaveBeenCalledTimes(1);
	await act(async () => release());
	await waitFor(() => expect(second.result.current.intents).toEqual([]));
	expect(first.result.current.intents).toEqual([]);
	expect(replayIntent).toHaveBeenCalledTimes(1);
});

it("native drains on returning active", async () => {
	jest.replaceProperty(Platform, "OS", "ios");
	let change!: (state: AppStateStatus) => void;
	const remove = jest.fn();
	jest
		.spyOn(AppState, "addEventListener")
		.mockImplementation((_event, listener) => {
			change = listener;
			return { remove };
		});
	jest.mocked(isOnline).mockReturnValue(true);
	const hook = open();
	await act(async () => {
		await hook.result.current.submit(
			intent,
			jest.fn().mockRejectedValue({ code: "unavailable" }),
		);
	});
	act(() => change("background"));
	expect(replayIntent).not.toHaveBeenCalled();
	act(() => change("active"));
	await waitFor(() => expect(stored()).toEqual([]));
	hook.unmount();
	expect(remove).toHaveBeenCalled();
});

it("does not claim queued when persistence fails", async () => {
	const hook = open();
	jest
		.mocked(AsyncStorage.setItem)
		.mockRejectedValueOnce(new Error("Storage full"));
	await act(async () => {
		await expect(hook.result.current.submit(intent, jest.fn())).rejects.toThrow(
			"Storage full",
		);
	});
	expect(hook.result.current.intents).toEqual([]);
});

it("concurrent submissions preserve both and keep uid stores separate", async () => {
	const first = open();
	await act(async () => {
		await Promise.all([
			first.result.current.submit(intent, jest.fn()),
			first.result.current.submit(
				{ ...intent, id: "other", locationId: "other" },
				jest.fn(),
			),
		]);
	});
	expect(stored()).toHaveLength(2);
	first.unmount();
	mockUid = "anna";
	const second = open();
	await act(async () =>
		second.result.current.submit({ ...intent, id: "anna" }, jest.fn()),
	);
	expect(stored("anna")).toEqual([{ ...intent, id: "anna" }]);
	expect(stored()).toHaveLength(2);
});

it("waits for auth, then drains on mount", async () => {
	mockAuthLoading = true;
	mockStore["outbox:marcus"] = JSON.stringify([intent]);
	jest.mocked(isOnline).mockReturnValue(true);
	const hook = open();
	expect(waitForPendingWrites).not.toHaveBeenCalled();
	mockAuthLoading = false;
	hook.rerender({});
	await waitFor(() => expect(stored()).toEqual([]));
	expect(replayIntent).toHaveBeenCalledWith(intent, "marcus");
});

it("keeps queue when pending Firestore writes cannot flush", async () => {
	mockStore["outbox:marcus"] = JSON.stringify([intent]);
	jest.mocked(isOnline).mockReturnValue(true);
	jest
		.mocked(waitForPendingWrites)
		.mockRejectedValueOnce({ code: "unavailable" });
	const hook = open();
	await waitFor(() => expect(waitForPendingWrites).toHaveBeenCalledTimes(1));
	expect(stored()).toEqual([intent]);
	expect(replayIntent).not.toHaveBeenCalled();
	expect(notice()?.visible).toBe(false);
	act(() => onlineListener());
	await waitFor(() => expect(hook.result.current.intents).toEqual([]));
	expect(stored()).toEqual([]);
});

it("keeps a replacement queued during replay and replays it next", async () => {
	mockStore["outbox:marcus"] = JSON.stringify([intent]);
	jest.mocked(isOnline).mockReturnValue(true);
	let release!: () => void;
	jest.mocked(replayIntent).mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
			}),
	);
	const hook = open();
	await waitFor(() => expect(replayIntent).toHaveBeenCalledTimes(1));
	const replacement = { ...intent, id: "replacement", rank: "a1" };
	await act(async () => {
		await hook.result.current.submit(
			replacement,
			jest.fn().mockRejectedValue({ code: "unavailable" }),
		);
	});
	expect(stored()).toEqual([replacement]);
	await act(async () => release());
	await waitFor(() => expect(stored()).toEqual([]));
	expect(
		jest.mocked(replayIntent).mock.calls.map(([value]) => value.id),
	).toEqual(["move-1", "replacement"]);
});

it("unmount during pending writes stops replay and removes reconnect listener", async () => {
	mockStore["outbox:marcus"] = JSON.stringify([intent]);
	jest.mocked(isOnline).mockReturnValue(true);
	let release!: () => void;
	jest.mocked(waitForPendingWrites).mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
			}),
	);
	const hook = open();
	await waitFor(() => expect(waitForPendingWrites).toHaveBeenCalledTimes(1));
	hook.unmount();
	await act(async () => release());
	expect(replayIntent).not.toHaveBeenCalled();
	expect(stored()).toEqual([intent]);
	expect(window.removeEventListener).toHaveBeenCalledWith(
		"online",
		onlineListener,
	);
});

it("reports unreadable storage and does not replace its contents", async () => {
	mockStore["outbox:marcus"] = "broken JSON";
	const hook = open();
	await waitFor(() => expect(notice()?.children).toBe(mockEn.error.saveFailed));
	await act(async () => {
		await expect(
			hook.result.current.submit(intent, jest.fn()),
		).rejects.toThrow();
	});
	expect(mockStore["outbox:marcus"]).toBe("broken JSON");
});
