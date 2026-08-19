import type {
	DocumentData,
	QuerySnapshot,
	Unsubscribe,
} from "firebase/firestore";

/**
 * How long to wait before each re-subscribe, in milliseconds.
 *
 * Three entries is three retries and a little under five seconds. The waits
 * grow because the failure this exists for is a connection that is not up
 * *yet*; they stop because a splash screen held any longer is its own kind of
 * broken, and `/homes` is at least a screen with a way forward on it.
 */
const retryDelays = [400, 1200, 3000];

/**
 * How long a listener may sit on a cache-only non-answer before that counts as
 * a failure. The same budget as the retry ladder, for the same reason: this is
 * how long the connection is given to turn up.
 */
const pendingTimeout = retryDelays.reduce((total, delay) => total + delay, 0);

/** Opening a listener: `onSnapshot`'s shape, with the query already bound. */
type OpenListener<T> = (
	onNext: (value: T) => void,
	onError: (reason: unknown) => void,
) => Unsubscribe;

interface RetryOptions<T> {
	/** Only ever passed by the tests. */
	delays?: readonly number[];
	/**
	 * Whether a value that arrived is an **answer**. A snapshot that is not one
	 * is neither passed on nor counted: it does not restore the retry budget, and
	 * if nothing better follows it within `pendingTimeout` the query has failed.
	 *
	 * Defaults to "everything is an answer". `isQueryAnswer` is the Firestore one.
	 */
	isAnswer?: (value: T) => boolean;
}

/**
 * Whether a query snapshot actually answers the query.
 *
 * A Firestore listener raises its **first event from the local cache**, and an
 * empty cache-only snapshot is "I do not know yet", not "there is nothing".
 * Treated as an answer it is #101 exactly: a cold start on a phone whose cache
 * has been evicted lifts the splash on `homes = []`, the ladder bounces to
 * `/homes`, and the household is told it is not in any home. No listener ever
 * failed, so no retry could have corrected it.
 *
 * `hooks/use-node.ts` has held the same line for a single document since it
 * shipped — "Not in the cache is not not there" — and this is that rule for a
 * query.
 *
 * Three ways to be an answer:
 *
 * - **Not empty.** The cache had something, which is the offline case working.
 * - **Not from the cache.** The server said so, empty or not; that is final.
 * - **Offline.** Nothing better is coming, so the cache's word is the best
 *   there is — which is what keeps a genuinely empty board in a shed reading as
 *   empty rather than as broken. Read live rather than captured, because the
 *   whole point is the transition.
 *
 * Only reachable with `{ includeMetadataChanges: true }` on the listener: a
 * server confirmation that an empty result is *still* empty changes nothing but
 * `fromCache`, and Firestore suppresses metadata-only events by default. Held
 * without it, a genuinely empty board online would wait for an event that is
 * never sent.
 */
export function isQueryAnswer(
	snapshot: QuerySnapshot<DocumentData>,
	online: boolean,
): boolean {
	return !snapshot.empty || !snapshot.metadata.fromCache || !online;
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
 * The budget is restored by every snapshot that **answers**, so a listener that
 * has been up for an hour is never one failure away from having no retries
 * left — and a listener answering only from the cache cannot refill it forever
 * while the server keeps rejecting it.
 */
export function subscribeWithRetry<T>(
	open: OpenListener<T>,
	onNext: (value: T) => void,
	onGaveUp: (reason: unknown) => void,
	{ delays = retryDelays, isAnswer = everything }: RetryOptions<T> = {},
): Unsubscribe {
	let stopped = false;
	let attempt = 0;
	let unsubscribe: Unsubscribe | null = null;
	let retry: ReturnType<typeof setTimeout> | null = null;
	let pending: ReturnType<typeof setTimeout> | null = null;

	const stopWaiting = () => {
		if (pending !== null) clearTimeout(pending);
		pending = null;
	};

	const start = () => {
		if (stopped) return;

		unsubscribe = open(
			(value) => {
				if (stopped) return;

				if (!isAnswer(value)) {
					// Nothing to re-open: this listener is alive and will deliver the
					// server's answer the moment there is a connection. It just cannot
					// be waited on for ever.
					pending ??= setTimeout(() => {
						pending = null;
						onGaveUp(new Error("The query only ever answered from the cache."));
					}, pendingTimeout);
					return;
				}

				stopWaiting();
				attempt = 0;
				onNext(value);
			},
			(reason) => {
				if (stopped) return;
				// Firestore has already torn this one down. Holding on to its
				// unsubscribe would only risk calling it twice.
				unsubscribe = null;
				// The ladder takes over the waiting from here.
				stopWaiting();

				const delay = delays[attempt];
				if (delay === undefined) {
					onGaveUp(reason);
					return;
				}

				attempt += 1;
				retry = setTimeout(start, delay);
			},
		);
	};

	start();

	return () => {
		stopped = true;
		if (retry !== null) clearTimeout(retry);
		stopWaiting();
		unsubscribe?.();
	};
}

const everything = () => true;
