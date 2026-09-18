import { act, renderHook } from "@testing-library/react-native";
import { participatingDoneQuery, sharedDoneQuery } from "@/data/nodes";
import { useOverview } from "@/hooks/use-overview";
import { usePairedListener } from "@/hooks/use-paired-listener";
import { toCalendarDay } from "@/models/due-date";
import type { CardCondition } from "@/models/filter";
import { doneWithinDays } from "@/models/overview";
import type { Card } from "@/models/overview-cards";

jest.mock("@/contexts/AuthContext", () => ({
	useAuth: () => ({ user: { uid: "uid-me" } }),
}));

let mockCards: Card[] = [];

jest.mock("@/contexts/DashboardCardsContext", () => ({
	useDashboardCardsConfig: () => ({ cards: mockCards }),
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
	mockCards = [];
	jest.useFakeTimers();
});

afterEach(() => {
	jest.useRealTimers();
});

const base = {
	id: "card",
	seedId: null,
	title: null,
	conditions: [],
	sort: null,
	shown: 5,
	max: 20,
	empty: { mode: "hide" } as const,
	rank: "a0",
};

const openCard = (): Card => ({ ...base, kind: "open" });
const doneCard = (conditions: CardCondition[]): Card => ({
	...base,
	id: "done-card",
	kind: "done",
	conditions,
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

	/** The ceiling the plan pins: a card asking for 500 gets a query at 365. */
	it("builds the done pair at the widest card window, clamped at the ceiling", () => {
		mockCards = [
			openCard(),
			doneCard([{ field: "completedAt", is: "within", n: 500 }]),
		];
		renderHook(() => useOverview("home-1"));
		const [, , done] = pairs();
		void done.build();

		expect(jest.mocked(sharedDoneQuery)).toHaveBeenCalledWith("home-1", 365);
		expect(jest.mocked(participatingDoneQuery)).toHaveBeenCalledWith(
			"home-1",
			"uid-me",
			365,
		);
	});

	it("floors the done pair's window when no done card exists", () => {
		mockCards = [openCard()];
		renderHook(() => useOverview("home-1"));
		const [, , done] = pairs();
		void done.build();

		expect(jest.mocked(sharedDoneQuery)).toHaveBeenCalledWith(
			"home-1",
			doneWithinDays,
		);
		expect(jest.mocked(participatingDoneQuery)).toHaveBeenCalledWith(
			"home-1",
			"uid-me",
			doneWithinDays,
		);
	});

	it("re-opens the done pair when the card config widens the window", () => {
		mockCards = [openCard()];
		const view = renderHook(() => useOverview("home-1"));
		const [, , before] = pairs();

		mockCards = [doneCard([{ field: "completedAt", is: "within", n: 90 }])];
		view.rerender(undefined);

		const [, , after] = pairs();
		expect(after.build).not.toBe(before.build);
	});
});
