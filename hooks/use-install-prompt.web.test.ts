import { act, renderHook } from "@testing-library/react-native";

let useInstallPrompt: typeof import("@/hooks/use-install-prompt.web").useInstallPrompt;
const target = new EventTarget();
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

beforeAll(async () => {
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: target,
	});
	({ useInstallPrompt } = await import("@/hooks/use-install-prompt.web"));
});

beforeEach(async () => {
	await act(() => target.dispatchEvent(new Event("appinstalled")));
});

afterAll(() => {
	if (originalWindow) {
		Object.defineProperty(globalThis, "window", originalWindow);
	} else {
		Reflect.deleteProperty(globalThis, "window");
	}
});

function installEvent(outcome: "accepted" | "dismissed" = "accepted") {
	return Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
		prompt: jest.fn(async () => {}),
		userChoice: Promise.resolve({ outcome }),
	});
}

it("captures an install offer before any hook mounts", async () => {
	const event = installEvent();
	target.dispatchEvent(event);
	const { result } = await renderHook(useInstallPrompt);

	expect(event.defaultPrevented).toBe(true);
	expect(result.current.canInstall).toBe(true);
});

it("shares install offers and appinstalled across hook instances", async () => {
	const first = await renderHook(useInstallPrompt);
	const second = await renderHook(useInstallPrompt);
	expect(first.result.current.canInstall).toBe(false);
	expect(second.result.current.canInstall).toBe(false);

	await act(() => target.dispatchEvent(installEvent()));
	expect(first.result.current.canInstall).toBe(true);
	expect(second.result.current.canInstall).toBe(true);

	await act(() => target.dispatchEvent(new Event("appinstalled")));
	expect(first.result.current.canInstall).toBe(false);
	expect(second.result.current.canInstall).toBe(false);
});

it.each(["accepted", "dismissed"] as const)(
	"consumes the shared prompt once when installation is %s",
	async (outcome) => {
		const first = await renderHook(useInstallPrompt);
		const second = await renderHook(useInstallPrompt);
		const event = installEvent(outcome);
		await act(() => target.dispatchEvent(event));

		await act(() => first.result.current.promptInstall());
		expect(event.prompt).toHaveBeenCalledTimes(1);
		expect(first.result.current.canInstall).toBe(false);
		expect(second.result.current.canInstall).toBe(false);

		await act(() => second.result.current.promptInstall());
		expect(event.prompt).toHaveBeenCalledTimes(1);
	},
);

it("consumes the shared prompt before concurrent callers await userChoice", async () => {
	const first = await renderHook(useInstallPrompt);
	const second = await renderHook(useInstallPrompt);
	let resolveChoice!: (choice: { outcome: "accepted" }) => void;
	const event = Object.assign(installEvent(), {
		userChoice: new Promise<{ outcome: "accepted" }>((resolve) => {
			resolveChoice = resolve;
		}),
	});
	await act(() => target.dispatchEvent(event));
	const calls: Promise<void>[] = [];

	await act(() => {
		calls.push(first.result.current.promptInstall());
		calls.push(second.result.current.promptInstall());
	});
	expect(event.prompt).toHaveBeenCalledTimes(1);
	expect(first.result.current.canInstall).toBe(false);
	expect(second.result.current.canInstall).toBe(false);

	await act(async () => {
		resolveChoice({ outcome: "accepted" });
		await Promise.all(calls);
	});
});

it("handles prompt rejection without offering the consumed event again", async () => {
	const first = await renderHook(useInstallPrompt);
	const second = await renderHook(useInstallPrompt);
	const event = installEvent();
	event.prompt.mockRejectedValueOnce(new Error("Prompt unavailable"));
	await act(() => target.dispatchEvent(event));

	await act(async () => {
		await expect(first.result.current.promptInstall()).resolves.toBeUndefined();
	});
	expect(first.result.current.canInstall).toBe(false);
	expect(second.result.current.canInstall).toBe(false);

	await act(() => second.result.current.promptInstall());
	expect(event.prompt).toHaveBeenCalledTimes(1);
});
