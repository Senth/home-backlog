/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { onSnapshot } from "firebase/firestore";
import { seedGlobalCards } from "@/data/cards";
import { useDashboardCards } from "@/hooks/use-dashboard-cards";

jest.mock("firebase/firestore", () => ({ onSnapshot: jest.fn() }));

jest.mock("@/contexts/AuthContext", () => ({
	useAuth: () => ({ user: { uid: "u1" } }),
}));
jest.mock("@/data/cards", () => ({
	globalCardsRef: jest.fn(() => ({})),
	homeCardsRef: jest.fn(() => ({})),
	sharedCardsRef: jest.fn(() => ({})),
	seedGlobalCards: jest.fn(),
}));
jest.mock("@/hooks/use-online-status", () => ({
	isOnline: () => true,
}));

/** Fire the newest config listener with one snapshot. */
const answer = (snapshot: Record<string, unknown>) => {
	const [, , onNext] = (onSnapshot as jest.Mock).mock.calls.at(-1) as [
		unknown,
		unknown,
		(value: Record<string, unknown>) => void,
	];
	act(() => onNext(snapshot));
};
const miss = () =>
	answer({ exists: () => false, metadata: { fromCache: false } });
const hit = () =>
	answer({
		exists: () => true,
		metadata: { fromCache: false },
		data: () => ({ cards: {} }),
	});

describe("useDashboardCards", () => {
	beforeAll(() => {
		jest.spyOn(console, "error").mockImplementation(() => {});
	});

	it("a rejected seed flags the config failed, so the screen offers a retry", async () => {
		(onSnapshot as jest.Mock).mockImplementation(() => () => {});
		(seedGlobalCards as jest.Mock).mockRejectedValue(new Error("offline"));
		const { result } = renderHook(() => useDashboardCards(null));

		miss();
		await waitFor(() => expect(seedGlobalCards).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(result.current.failed).toBe(true));
	});

	it("retry reopens the config, and a later answer clears the failure", async () => {
		(onSnapshot as jest.Mock).mockImplementation(() => () => {});
		(seedGlobalCards as jest.Mock)
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce(undefined);
		const { result } = renderHook(() => useDashboardCards(null));

		miss();
		await waitFor(() => expect(result.current.failed).toBe(true));

		act(() => result.current.retry());
		miss();
		await waitFor(() => expect(seedGlobalCards).toHaveBeenCalledTimes(2));
		hit();
		await waitFor(() => expect(result.current.failed).toBe(false));
	});
});
