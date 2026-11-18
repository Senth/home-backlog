import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useInstallOffer } from "@/hooks/use-install-offer";
import { installOfferKey } from "@/models/install-offer";

let mockStore: Record<string, string> = {};
let mockCanInstall = true;
const mockPromptInstall = jest.fn(async () => {});

jest.mock("@react-native-async-storage/async-storage", () => ({
	getItem: jest.fn(async (key: string) => mockStore[key] ?? null),
	setItem: jest.fn(async (key: string, value: string) => {
		mockStore[key] = value;
	}),
}));

jest.mock("@/hooks/use-install-prompt", () => ({
	useInstallPrompt: () => ({
		canInstall: mockCanInstall,
		promptInstall: mockPromptInstall,
	}),
}));

describe("useInstallOffer", () => {
	beforeEach(() => {
		mockStore = {};
		mockCanInstall = true;
	});

	it("stays hidden until storage loads, then offers install", async () => {
		let releaseRead!: (value: string | null) => void;
		jest.mocked(AsyncStorage.getItem).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					releaseRead = resolve;
				}),
		);

		const { result } = await renderHook(() => useInstallOffer());
		expect(result.current.visible).toBe(false);

		await act(async () => releaseRead(null));
		expect(result.current.visible).toBe(true);

		await act(async () => result.current.install());
		expect(mockPromptInstall).toHaveBeenCalledTimes(1);
	});

	it("keeps a dismissed offer hidden after remount", async () => {
		const first = await renderHook(() => useInstallOffer());
		await waitFor(() => expect(first.result.current.visible).toBe(true));

		await act(() => first.result.current.dismiss());
		await waitFor(() =>
			expect(mockStore[installOfferKey]).toBe(JSON.stringify(true)),
		);
		await first.unmount();

		let releaseRead!: (value: string | null) => void;
		jest.mocked(AsyncStorage.getItem).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					releaseRead = resolve;
				}),
		);
		const second = await renderHook(() => useInstallOffer());
		expect(second.result.current.visible).toBe(false);

		await act(async () => releaseRead(mockStore[installOfferKey]));
		expect(second.result.current.visible).toBe(false);
		await second.unmount();
	});

	it("never offers install when the browser cannot install", async () => {
		mockCanInstall = false;
		const { result } = await renderHook(() => useInstallOffer());

		await waitFor(() =>
			expect(jest.mocked(AsyncStorage.getItem)).toHaveBeenCalledWith(
				installOfferKey,
			),
		);
		expect(result.current.visible).toBe(false);
	});

	it("hides immediately on dismiss even while a read is pending", async () => {
		let releaseRead!: (value: string | null) => void;
		jest.mocked(AsyncStorage.getItem).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					releaseRead = resolve;
				}),
		);

		const { result } = await renderHook(() => useInstallOffer());
		await act(() => result.current.dismiss());
		await act(async () => releaseRead(null));

		expect(result.current.visible).toBe(false);
	});
});
