/**
 * Which caching strategy a request gets. Kept in its own file with no service
 * worker globals so it can be unit tested directly; `sw.js` pulls it in with
 * `importScripts`, which also makes the browser check it for updates.
 */

/** Content-hashed bundles and assets — safe to serve from cache forever. */
const IMMUTABLE_PREFIX = "/_expo/static/";

/**
 * Firebase Hosting's reserved namespace. It holds the OAuth handler and the
 * hidden auth iframe, and `authDomain` points at this origin so the redirect
 * survives Safari — which means Google's auth pages are now *same-origin* and
 * no longer excluded by the cross-origin check below.
 *
 * They must stay out of the cache entirely. `/__/auth/handler` and
 * `/__/auth/iframe` are both `mode === "navigate"` HTML responses, and the
 * navigate strategy stores every OK navigation as the one app shell — so a
 * single auth iframe load would overwrite the offline shell with Google's
 * sign-in page, and the next offline launch would boot that instead of the app.
 * Firebase's resolver loads that iframe on every start on mobile, Safari and
 * iOS, which is exactly where the offline shell matters most.
 */
const RESERVED_PREFIX = "/__/";

/**
 * @typedef {"passthrough" | "navigate" | "cache-first" | "stale-while-revalidate"} Strategy
 *
 * @param {{ method: string, mode: string, sameOrigin: boolean, pathname: string }} request
 * @returns {Strategy}
 */
function chooseStrategy({ method, mode, sameOrigin, pathname }) {
	// Writes must never be served or replayed from a cache.
	if (method !== "GET") return "passthrough";
	// Firestore, Google auth and fonts run their own offline handling — the
	// Firestore write queue in particular breaks if we answer for it.
	if (!sameOrigin) return "passthrough";
	// Same-origin now includes Firebase's own auth pages — see above.
	if (pathname.startsWith(RESERVED_PREFIX)) return "passthrough";
	// The app shell has to come from the network when there is one, so a new
	// deploy lands on the next reload instead of on the next service worker.
	if (mode === "navigate") return "navigate";
	if (pathname.startsWith(IMMUTABLE_PREFIX)) return "cache-first";
	return "stale-while-revalidate";
}

// Present when required from Jest, absent in the service worker scope.
if (typeof module !== "undefined" && module.exports) {
	module.exports = { chooseStrategy, IMMUTABLE_PREFIX, RESERVED_PREFIX };
}
