import { act, renderHook } from "@testing-library/react-native";
import type { DocumentData, Query, QuerySnapshot } from "firebase/firestore";
import { subscribeWithRetry } from "@/data/live-query";
import { usePairedListener } from "@/hooks/use-paired-listener";

jest.mock("firebase/firestore", () => ({ onSnapshot: jest.fn() }));

jest.mock("@/data/live-query", () => ({
	isQueryAnswer: jest.requireActual("@/data/live-query").isQueryAnswer,
	subscribeWithRetry: jest.fn(),
}));

const labels = { shared: "shared half", participating: "participating half" };

/** The two queries are opaque to this test — the fake never opens them. */
const pair = {
	shared: {} as Query<DocumentData>,
	participating: {} as Query<DocumentData>,
};

/** Stable across renders, as the hook requires. */
const build = () => pair;

/** One entry per subscribed half, in subscribe order: shared, participating. */
const halves: Array<{
	next: (value: unknown) => void;
	error: (reason: unknown) => void;
}> = [];

beforeEach(() => {
	halves.length = 0;
	jest
		.mocked(subscribeWithRetry)
		.mockImplementation((_open, onNext, onGaveUp) => {
			halves.push({ next: onNext, error: (reason) => onGaveUp(reason) });
			return () => {};
		});
});

/** A server-answered snapshot carrying the given document ids. */
const answer = (ids: string[]) =>
	({
		docs: ids.map((id) => ({ id, data: () => ({ title: id }) })),
	}) as unknown as QuerySnapshot<DocumentData>;

describe("usePairedListener", () => {
	/**
	 * `build` is held constant across the rerender, so the reopened listeners
	 * are attributable to the `key` alone — a `key` change must be enough on
	 * its own, because `key` drives the clear but `build` is what reopens.
	 */
	it("a key change clears the rows, re-raises loading and reopens the listeners", () => {
		const { result, rerender } = renderHook(
			({ key }: { key: string }) => usePairedListener(key, build, labels),
			{ initialProps: { key: "huset" } },
		);

		act(() => {
			halves[0].next(answer(["shared-1"]));
			halves[1].next(answer(["done-1"]));
		});
		expect(result.current.nodes).toHaveLength(2);
		expect(result.current.loading).toBe(false);
		expect(result.current.failed).toBe(false);

		rerender({ key: "stugan" });

		expect(halves).toHaveLength(4);
		expect(result.current.nodes).toHaveLength(0);
		expect(result.current.loading).toBe(true);
		expect(result.current.failed).toBe(false);

		act(() => {
			halves[2].next(answer(["shared-2"]));
			halves[3].next(answer(["done-2"]));
		});
		expect(result.current.nodes).toHaveLength(2);
		expect(result.current.loading).toBe(false);
	});

	it("one failed half is not failure while the other is still loading", () => {
		const consoleError = jest.spyOn(console, "error").mockImplementation();
		const { result } = renderHook(() =>
			usePairedListener("huset", build, labels),
		);

		act(() => {
			halves[0].error(new Error("shared half gave up"));
		});
		expect(result.current.loading).toBe(true);
		expect(result.current.failed).toBe(false);

		act(() => {
			halves[1].next(answer(["done-1"]));
		});
		expect(result.current.loading).toBe(false);
		expect(result.current.failed).toBe(true);

		consoleError.mockRestore();
	});
});
