import { act, renderHook } from "@testing-library/react-native";
import { useOverview } from "@/hooks/use-overview";
import { usePairedListener } from "@/hooks/use-paired-listener";
import { toCalendarDay } from "@/models/due-date";

jest.mock("@/contexts/AuthContext", () => ({
	useAuth: () => ({ user: { uid: "uid-me" } }),
}));

jest.mock("@/data/nodes", () => ({
	sharedPoolQuery: jest.fn(),
	participatingPoolQuery: jest.fn(),
	sharedDoneQuery: jest.fn(),
	participatingDoneQuery: jest.fn(),
}));

jest.mock("@/hooks/use-paired-listener", () => ({
	usePairedListener: jest.fn(() => ({
		nodes: [],
		loading: false,
		failed: false,
		retry: () => {},
	})),
}));

beforeEach(() => {
	jest.useFakeTimers();
});

afterEach(() => {
	jest.useRealTimers();
});

/** One render's worth of `usePairedListener` calls: roots, pool, done. */
function pairs() {
	return jest
		.mocked(usePairedListener)
		.mock.calls.slice(-3)
		.map(([key, build]) => ({ key, build }));
}

describe("useOverview", () => {
	/**
	 * The done pair's `doneSince(now)` is only as fresh as its subscription:
	 * a screen open since yesterday must re-ask it at the turnover. The pool
	 * pair carries no `now` at all (#166), and the roots pair never did, so
	 * neither may move with the day.
	 */
	it("re-subscribes the done pair at the day turnover, and nothing else", () => {
		const start = new Date();
		const midnight = new Date(
			start.getFullYear(),
			start.getMonth(),
			start.getDate() + 1,
		).getTime();
		renderHook(() => useOverview("home-1"));
		const [rootsBefore, poolBefore, doneBefore] = pairs();

		act(() => {
			jest.advanceTimersByTime(midnight - start.getTime() + 1);
		});
		const [rootsAfter, poolAfter, doneAfter] = pairs();

		expect(rootsAfter.key).toBe(rootsBefore.key);
		expect(rootsAfter.build).toBe(rootsBefore.build);
		expect(poolAfter.key).toBe(poolBefore.key);
		expect(poolAfter.build).toBe(poolBefore.build);
		expect(doneAfter.key).not.toBe(doneBefore.key);
		expect(doneAfter.key).toContain(toCalendarDay(new Date()));
		expect(doneAfter.build).not.toBe(doneBefore.build);
	});
});
