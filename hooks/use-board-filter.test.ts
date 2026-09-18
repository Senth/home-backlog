import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useBoardFilter } from "@/hooks/use-board-filter";
import { type BoardFilter, boardFilterKey } from "@/models/board-filter";

// A real in-memory store, not bare `jest.fn`s: the state machine under test
// is set → reload, and only a store that outlives a mount can say it.
let mockStore: Record<string, string> = {};
jest.mock("@react-native-async-storage/async-storage", () => ({
	getItem: jest.fn(async (key: string) => mockStore[key] ?? null),
	setItem: jest.fn(async (key: string, value: string) => {
		mockStore[key] = value;
	}),
	removeItem: jest.fn(async (key: string) => {
		delete mockStore[key];
	}),
}));

const hour = 60 * 60 * 1000;
const t0 = 1_789_000_000_000;

const priorityFilter: BoardFilter = {
	mode: "open",
	reach: "board",
	conditions: [{ field: "priority", anyOf: ["high"] }],
};

const key = boardFilterKey("huset");

/** One board open, with `Date.now()` pinned wherever the test has moved it. */
const openBoard = () => renderHook(() => useBoardFilter("huset"));

describe("useBoardFilter", () => {
	beforeEach(() => {
		mockStore = {};
		jest.clearAllMocks();
		jest.spyOn(Date, "now").mockReturnValue(t0);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("set, reload, still there", async () => {
		const first = openBoard();
		await waitFor(() => expect(first.result.current.loading).toBe(false));
		expect(first.result.current.filter).toBeNull();

		act(() => first.result.current.setFilter(priorityFilter));
		expect(first.result.current.filter).toEqual(priorityFilter);
		first.unmount();

		const second = openBoard();
		await waitFor(() => expect(second.result.current.loading).toBe(false));
		expect(second.result.current.filter).toEqual(priorityFilter);
		second.unmount();
	});

	it("set, advance 25 hours, gone", async () => {
		const first = openBoard();
		await waitFor(() => expect(first.result.current.loading).toBe(false));
		act(() => first.result.current.setFilter(priorityFilter));
		first.unmount();

		jest.mocked(Date.now).mockReturnValue(t0 + 25 * hour);
		const second = openBoard();
		await waitFor(() => expect(second.result.current.loading).toBe(false));
		expect(second.result.current.filter).toBeNull();
		// Gone is gone: the expired blob is dropped, not left half-alive.
		await waitFor(() =>
			expect(jest.mocked(AsyncStorage.removeItem)).toHaveBeenCalledWith(key),
		);
		second.unmount();
	});

	it("set, touch at hour 23, advance 23 more, still there", async () => {
		const first = openBoard();
		await waitFor(() => expect(first.result.current.loading).toBe(false));
		act(() => first.result.current.setFilter(priorityFilter));
		first.unmount();

		jest.mocked(Date.now).mockReturnValue(t0 + 23 * hour);
		const second = openBoard();
		await waitFor(() =>
			expect(second.result.current.filter).toEqual(priorityFilter),
		);
		// The mount is a board open: the expiry slides out from now.
		await waitFor(() =>
			expect(JSON.parse(mockStore[key]).savedAt).toBe(t0 + 23 * hour),
		);
		second.unmount();

		jest.mocked(Date.now).mockReturnValue(t0 + 46 * hour);
		const third = openBoard();
		await waitFor(() => expect(third.result.current.loading).toBe(false));
		expect(third.result.current.filter).toEqual(priorityFilter);
		third.unmount();
	});

	it("an open with no filter ever stored writes nothing", async () => {
		const board = openBoard();
		await waitFor(() => expect(board.result.current.loading).toBe(false));
		expect(jest.mocked(AsyncStorage.setItem)).not.toHaveBeenCalled();
		expect(jest.mocked(AsyncStorage.removeItem)).not.toHaveBeenCalled();
		board.unmount();
	});

	it("every write lands on the one per-home key, never a per-board one", async () => {
		const board = openBoard();
		await waitFor(() => expect(board.result.current.loading).toBe(false));
		act(() => board.result.current.setFilter(priorityFilter));
		await waitFor(() => expect(mockStore[key]).toBeDefined());
		board.unmount();

		jest.mocked(Date.now).mockReturnValue(t0 + hour);
		const reopened = openBoard();
		await waitFor(() =>
			expect(reopened.result.current.filter).toEqual(priorityFilter),
		);
		await waitFor(() =>
			expect(jest.mocked(AsyncStorage.setItem)).toHaveBeenLastCalledWith(
				key,
				expect.any(String),
			),
		);
		reopened.unmount();

		expect(Object.keys(mockStore)).toEqual([key]);
		for (const set of jest.mocked(AsyncStorage.setItem).mock.calls) {
			expect(set[0]).toBe(key);
		}
		for (const removal of jest.mocked(AsyncStorage.removeItem).mock.calls) {
			expect(removal[0]).toBe(key);
		}
	});

	it("a clear that lands during the read is not resurrected by the read", async () => {
		const stored = JSON.stringify({
			v: 1,
			savedAt: t0,
			mode: "open",
			reach: "board",
			conditions: [{ field: "priority", anyOf: ["high"] }],
		});
		mockStore[key] = stored;

		// Hold the read open, so the clear can land while it is in flight.
		let release!: (raw: string) => void;
		jest.mocked(AsyncStorage.getItem).mockImplementationOnce(
			() =>
				new Promise<string>((resolve) => {
					release = resolve;
				}),
		);

		const board = openBoard();
		act(() => board.result.current.setFilter(null));
		expect(board.result.current.filter).toBeNull();

		// The read comes back with the filter the clear just removed.
		release(stored);
		await waitFor(() => expect(board.result.current.loading).toBe(false));

		expect(board.result.current.filter).toBeNull();
		// And the slide write must not put the cleared blob back in storage.
		expect(mockStore[key]).toBeUndefined();
		board.unmount();
	});

	it("switching homes re-points: each home holds its own filter", async () => {
		mockStore[boardFilterKey("stugan")] = JSON.stringify({
			v: 1,
			savedAt: t0,
			mode: "done",
			reach: "subtree",
			conditions: [],
		});

		const board = renderHook(
			({ homeId }: { homeId: string | null }) => useBoardFilter(homeId),
			{
				initialProps: { homeId: "huset" as string | null },
			},
		);
		await waitFor(() => expect(board.result.current.loading).toBe(false));
		act(() => board.result.current.setFilter(priorityFilter));

		board.rerender({ homeId: "stugan" });
		expect(board.result.current.filter).toBeNull();
		expect(board.result.current.loading).toBe(true);
		await waitFor(() =>
			expect(board.result.current.filter).toEqual({
				mode: "done",
				reach: "subtree",
				conditions: [],
			}),
		);
		board.unmount();
	});
});
