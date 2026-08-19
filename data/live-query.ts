import type { Unsubscribe } from "firebase/firestore";

/**
 * How long to wait before each re-subscribe, in milliseconds.
 *
 * Three entries is three retries and a little under five seconds. The waits
 * grow because the failure this exists for is a connection that is not up
 * *yet*; they stop because a splash screen held any longer is its own kind of
 * broken, and `/homes` is at least a screen with a way forward on it.
 */
const retryDelays = [400, 1200, 3000];

/** Opening a listener: `onSnapshot`'s shape, with the query already bound. */
type OpenListener<T> = (
	onNext: (value: T) => void,
	onError: (reason: unknown) => void,
) => Unsubscribe;

interface RetryOptions {
	/** Only ever passed by the tests. */
	delays?: readonly number[];
}

/**
 * `onSnapshot`, except that a failure is not the end of it.
 *
 * A Firestore listener is **terminated** by its own error callback. It never
 * reconnects, so every screen behind it keeps whatever it had at the moment it
 * broke — and what a query that has never answered has is nothing. The app
 * cannot tell that apart from an empty collection, so a single failed homes
 * query renders as "You are not in any home yet." on a household with a board
 * full of cards, and stays that way until the app is force quit and reopened.
 * That is #101, and a cold PWA start — a phone waking with an expired token and
 * no connection up yet — is exactly when it happens.
 *
 * A failure therefore re-opens the listener rather than reporting it, and
 * `onGaveUp` is reached only once the connection has had several seconds to
 * turn up. It then means what the plain error callback used to mean.
 *
 * The budget is restored by every snapshot that arrives, so a listener that has
 * been up for an hour is never one failure away from having no retries left.
 */
export function subscribeWithRetry<T>(
	open: OpenListener<T>,
	onNext: (value: T) => void,
	onGaveUp: (reason: unknown) => void,
	{ delays = retryDelays }: RetryOptions = {},
): Unsubscribe {
	let stopped = false;
	let attempt = 0;
	let unsubscribe: Unsubscribe | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const start = () => {
		if (stopped) return;

		unsubscribe = open(
			(value) => {
				if (stopped) return;
				attempt = 0;
				onNext(value);
			},
			(reason) => {
				if (stopped) return;
				// Firestore has already torn this one down. Holding on to its
				// unsubscribe would only risk calling it twice.
				unsubscribe = null;

				const delay = delays[attempt];
				if (delay === undefined) {
					onGaveUp(reason);
					return;
				}

				attempt += 1;
				timer = setTimeout(start, delay);
			},
		);
	};

	start();

	return () => {
		stopped = true;
		if (timer !== null) clearTimeout(timer);
		unsubscribe?.();
	};
}
