import { act, renderHook } from "@testing-library/react-native";
import type {
	DocumentData,
	FirestoreError,
	QuerySnapshot,
} from "firebase/firestore";
import { useLocations } from "@/hooks/use-locations";

jest.mock("@/config/firebase", () => ({ db: {} }));

jest.mock("@/hooks/use-online-status", () => ({ isOnline: () => true }));

jest.mock("firebase/firestore", () => ({
	collection: jest.fn(() => ({})),
	doc: jest.fn((...args: unknown[]) => ({
		id:
			typeof args[args.length - 1] === "string"
				? args[args.length - 1]
				: "new-location",
	})),
	query: jest.fn((value: unknown) => value),
	serverTimestamp: jest.fn(() => "server-timestamp"),
	setDoc: jest.fn(),
	updateDoc: jest.fn(),
	getDocsFromServer: jest.fn(),
	writeBatch: jest.fn(),
	onSnapshot: jest.fn(),
}));

import { onSnapshot } from "firebase/firestore";

const mockOnSnapshot = jest.mocked(onSnapshot);

/** The callbacks of the live listener — the last one `onSnapshot` opened. */
const live: {
	next: (value: QuerySnapshot<DocumentData>) => void;
	error: (reason: unknown) => void;
} = { next: jest.fn(), error: jest.fn() };

/** Only what the hook and `toLocation` read, plus what `isQueryAnswer` asks. */
function snapshot(
	documents: { id: string; parentId: string | null }[],
	fromCache = false,
) {
	return {
		docs: documents.map((document) => ({
			id: document.id,
			ref: { id: document.id },
			data: () => ({ parentId: document.parentId }),
		})),
		empty: documents.length === 0,
		metadata: { fromCache },
	} as unknown as QuerySnapshot<DocumentData>;
}

beforeEach(() => {
	jest.clearAllMocks();
	jest.useFakeTimers();
	// Every listener opened hands its callbacks back here; the latest pair is
	// the live one, which is the one a test delivers to.
	mockOnSnapshot.mockImplementation(
		(
			_query: unknown,
			_options: unknown,
			next: (value: QuerySnapshot<DocumentData>) => void,
			error?: (reason: FirestoreError) => void,
		) => {
			live.next = next;
			live.error = (error ?? (() => {})) as (reason: unknown) => void;
			return () => {};
		},
	);
});

afterEach(() => {
	jest.useRealTimers();
});

describe("useLocations", () => {
	it("answers an empty tree at once when there is no home", () => {
		const { result } = renderHook(() => useLocations(null));

		expect(result.current.loading).toBe(false);
		expect(result.current.locations).toEqual([]);
		expect(mockOnSnapshot).not.toHaveBeenCalled();
	});

	it("maps the collection into a parent-then-rank sorted tree", () => {
		const { result } = renderHook(() => useLocations("home-1"));
		expect(result.current.loading).toBe(true);

		act(() => {
			live.next(
				snapshot([
					{ id: "garden", parentId: "ute" },
					{ id: "ute", parentId: null },
					{ id: "basement", parentId: null },
				]),
			);
		});

		expect(result.current.loading).toBe(false);
		expect(result.current.failed).toBe(false);
		expect(result.current.locations.map((loc) => loc.id)).toEqual([
			"basement",
			"ute",
			"garden",
		]);
	});

	it("holds an empty cache-only snapshot while there is a connection", () => {
		const { result } = renderHook(() => useLocations("home-1"));

		act(() => {
			live.next(snapshot([], true));
		});

		// #101: "the cache has nothing" is not "there is nothing".
		expect(result.current.loading).toBe(true);
		expect(result.current.locations).toEqual([]);
	});

	it("retries a failure, and fails only once the ladder is spent", () => {
		const { result } = renderHook(() => useLocations("home-1"));
		const reason = new Error("unavailable");
		const consoleError = jest.spyOn(console, "error").mockImplementation();

		for (const delay of [400, 1200, 3000]) {
			act(() => {
				live.error(reason);
			});
			expect(result.current.failed).toBe(false);
			act(() => {
				jest.advanceTimersByTime(delay);
			});
		}

		// Three retries spent; the fourth failure is the last one.
		act(() => {
			live.error(reason);
		});
		expect(result.current.loading).toBe(false);
		expect(result.current.failed).toBe(true);

		// Try again reopens the listener, and an answer clears the failure.
		act(() => {
			result.current.retry();
		});
		act(() => {
			live.next(snapshot([{ id: "ute", parentId: null }]));
		});
		expect(result.current.failed).toBe(false);
		expect(result.current.locations.map((loc) => loc.id)).toEqual(["ute"]);
		// The spent ladder reports itself; the spy keeps the suite output clean.
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});
});
