import type { DocumentData, QuerySnapshot } from "firebase/firestore";
import { isQueryAnswer, subscribeWithRetry } from "@/data/live-query";

/**
 * A stand-in for `onSnapshot`: it hands back the callbacks of every listener it
 * has opened, so a test can deliver a snapshot or a failure to whichever one is
 * live and count how many times it was re-opened.
 */
function fakeListener() {
	const opened: {
		next: (value: string) => void;
		error: (reason: unknown) => void;
		unsubscribed: boolean;
	}[] = [];

	const open = (
		next: (value: string) => void,
		error: (reason: unknown) => void,
	) => {
		const listener = { next, error, unsubscribed: false };
		opened.push(listener);
		return () => {
			listener.unsubscribed = true;
		};
	};

	const current = () => {
		const listener = opened[opened.length - 1];
		if (listener === undefined) throw new Error("Nothing has been opened.");
		return listener;
	};

	return { open, opened, current };
}

const delays = [10, 20, 30];

beforeEach(() => {
	jest.useFakeTimers();
});

afterEach(() => {
	jest.useRealTimers();
});

describe("subscribeWithRetry", () => {
	it("opens the listener and passes snapshots straight through", () => {
		const listener = fakeListener();
		const onNext = jest.fn();

		subscribeWithRetry(listener.open, onNext, jest.fn(), { delays });
		listener.current().next("a board");

		expect(listener.opened).toHaveLength(1);
		expect(onNext).toHaveBeenCalledWith("a board");
	});

	it("re-opens the listener after a failure instead of reporting it", () => {
		const listener = fakeListener();
		const onGaveUp = jest.fn();

		subscribeWithRetry(listener.open, jest.fn(), onGaveUp, { delays });
		listener.current().error(new Error("unavailable"));

		expect(onGaveUp).not.toHaveBeenCalled();
		expect(listener.opened).toHaveLength(1);

		jest.advanceTimersByTime(10);
		expect(listener.opened).toHaveLength(2);
	});

	it("waits longer before each retry", () => {
		const listener = fakeListener();

		subscribeWithRetry(listener.open, jest.fn(), jest.fn(), { delays });

		for (const delay of delays) {
			listener.current().error(new Error("unavailable"));
			jest.advanceTimersByTime(delay - 1);
			const before = listener.opened.length;
			jest.advanceTimersByTime(1);
			expect(listener.opened.length).toBe(before + 1);
		}
	});

	it("gives up once the retries are spent, with the last failure", () => {
		const listener = fakeListener();
		const onGaveUp = jest.fn();
		const last = new Error("the last one");

		subscribeWithRetry(listener.open, jest.fn(), onGaveUp, { delays });

		for (const delay of delays) {
			listener.current().error(new Error("unavailable"));
			jest.advanceTimersByTime(delay);
		}
		expect(onGaveUp).not.toHaveBeenCalled();

		listener.current().error(last);
		expect(onGaveUp).toHaveBeenCalledWith(last);
	});

	it("restores the budget on every snapshot, so a long-lived listener keeps its retries", () => {
		const listener = fakeListener();
		const onGaveUp = jest.fn();

		subscribeWithRetry(listener.open, jest.fn(), onGaveUp, { delays });

		// Spend every retry, then answer — which is a listener that recovered.
		for (const delay of delays) {
			listener.current().error(new Error("unavailable"));
			jest.advanceTimersByTime(delay);
		}
		listener.current().next("a board");

		// The next failure is the first one again, not the fourth.
		listener.current().error(new Error("unavailable"));
		expect(onGaveUp).not.toHaveBeenCalled();
		jest.advanceTimersByTime(10);
		expect(listener.opened).toHaveLength(delays.length + 2);
	});

	it("unsubscribing closes the live listener", () => {
		const listener = fakeListener();

		const unsubscribe = subscribeWithRetry(
			listener.open,
			jest.fn(),
			jest.fn(),
			{
				delays,
			},
		);
		unsubscribe();

		expect(listener.current().unsubscribed).toBe(true);
	});

	it("unsubscribing cancels a retry that has not fired yet", () => {
		const listener = fakeListener();
		const onGaveUp = jest.fn();

		const unsubscribe = subscribeWithRetry(listener.open, jest.fn(), onGaveUp, {
			delays,
		});
		listener.current().error(new Error("unavailable"));
		unsubscribe();

		jest.advanceTimersByTime(1000);
		expect(listener.opened).toHaveLength(1);
		expect(onGaveUp).not.toHaveBeenCalled();
	});

	it("says nothing after unsubscribing, however late the listener answers", () => {
		const listener = fakeListener();
		const onNext = jest.fn();
		const onGaveUp = jest.fn();

		const unsubscribe = subscribeWithRetry(listener.open, onNext, onGaveUp, {
			delays,
		});
		unsubscribe();

		listener.current().next("a board");
		listener.current().error(new Error("unavailable"));

		expect(onNext).not.toHaveBeenCalled();
		expect(onGaveUp).not.toHaveBeenCalled();
	});
});

/** Only the two fields `isQueryAnswer` looks at. */
function snapshot(empty: boolean, fromCache: boolean) {
	return { empty, metadata: { fromCache } } as QuerySnapshot<DocumentData>;
}

describe("isQueryAnswer", () => {
	it("takes anything the cache actually had", () => {
		// The offline case working: cards in hand are cards in hand.
		expect(isQueryAnswer(snapshot(false, true), true)).toBe(true);
	});

	it("takes an empty result the server confirmed", () => {
		expect(isQueryAnswer(snapshot(true, false), true)).toBe(true);
	});

	it("holds an empty cache-only result while there is a connection", () => {
		// #101: "the cache has nothing" is not "there is nothing", and online
		// there is a server answer on its way that can say which.
		expect(isQueryAnswer(snapshot(true, true), true)).toBe(false);
	});

	it("takes an empty cache-only result once offline, where nothing better is coming", () => {
		// A genuinely empty board in a shed reads as empty, not as broken.
		expect(isQueryAnswer(snapshot(true, true), false)).toBe(true);
	});
});

describe("subscribeWithRetry, on a value that is not an answer", () => {
	const isAnswer = (value: string) => value !== "from cache";

	it("passes nothing on, and does not fail straight away", () => {
		const listener = fakeListener();
		const onNext = jest.fn();
		const onGaveUp = jest.fn();

		subscribeWithRetry(listener.open, onNext, onGaveUp, { delays, isAnswer });
		listener.current().next("from cache");

		expect(onNext).not.toHaveBeenCalled();
		expect(onGaveUp).not.toHaveBeenCalled();
		// Still the same listener: the server answer arrives on it.
		expect(listener.opened).toHaveLength(1);
	});

	it("gives up if nothing better follows it", () => {
		const listener = fakeListener();
		const onGaveUp = jest.fn();

		subscribeWithRetry(listener.open, jest.fn(), onGaveUp, {
			delays,
			isAnswer,
		});
		listener.current().next("from cache");

		jest.advanceTimersByTime(4600);
		expect(onGaveUp).toHaveBeenCalled();
	});

	it("stops waiting as soon as a real answer arrives", () => {
		const listener = fakeListener();
		const onNext = jest.fn();
		const onGaveUp = jest.fn();

		subscribeWithRetry(listener.open, onNext, onGaveUp, { delays, isAnswer });
		listener.current().next("from cache");
		listener.current().next("a board");

		jest.advanceTimersByTime(10_000);
		expect(onNext).toHaveBeenCalledWith("a board");
		expect(onGaveUp).not.toHaveBeenCalled();
	});

	it("does not restore the retry budget, so a cache-then-reject loop still ends", () => {
		// The listener answers from cache, the server rejects it, and it does that
		// for ever. If a cache-only snapshot refilled the budget, `onGaveUp` would
		// never be reached and the screen would never say anything.
		const listener = fakeListener();
		const onGaveUp = jest.fn();

		subscribeWithRetry(listener.open, jest.fn(), onGaveUp, {
			delays,
			isAnswer,
		});

		for (const delay of delays) {
			listener.current().next("from cache");
			listener.current().error(new Error("permission-denied"));
			jest.advanceTimersByTime(delay);
		}
		listener.current().next("from cache");
		listener.current().error(new Error("permission-denied"));

		expect(onGaveUp).toHaveBeenCalled();
	});
});
