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
 * @param {{ method: string, mode: string, sameOrigin: boolean, pathname: string, search: string }} request
 * @returns {Strategy}
 */
function chooseStrategy({ method, mode, sameOrigin, pathname, search }) {
	// Writes must never be served or replayed from a cache.
	if (method !== "GET") return "passthrough";
	// Firestore, Google auth and fonts run their own offline handling — the
	// Firestore write queue in particular breaks if we answer for it.
	if (!sameOrigin) return "passthrough";
	// Same-origin now includes Firebase's own auth pages — see above.
	if (pathname.startsWith(RESERVED_PREFIX)) return "passthrough";
	// The freshness check in `use-service-worker.web.ts` compares the deployed
	// shell against the running one; an answer from this cache would be the
	// very shell under judgment, so its marker request goes straight to the wire.
	if (search.includes("build-check")) return "passthrough";
	// The app shell has to come from the network when there is one, so a new
	// deploy lands on the next reload instead of on the next service worker.
	if (mode === "navigate") return "navigate";
	if (pathname.startsWith(IMMUTABLE_PREFIX)) return "cache-first";
	return "stale-while-revalidate";
}

/**
 * What a navigation gets when the network is gone and the shell was never
 * cached — an eviction under storage pressure, or a clear, after a successful
 * install. `Response.error()` there reads to the browser as a real connection
 * failure, so it paints its own network-error page over a working app (#322).
 *
 * The copy is hardcoded English, the one string in the app outside `t()`: a
 * service worker cannot reach the i18n bundle, and this file has no build step
 * that could bake a localized page out of it. The styling is inline and the
 * colors are CSS system colors for the same reason — `theme/tokens.ts` is out
 * of reach here, and `Canvas`/`CanvasText` under `color-scheme: light dark`
 * follow the OS setting without naming a palette. Unstyled, this page renders
 * as a Times New Roman line in the corner, which reads as the breakage it
 * exists to deny.
 */
const OFFLINE_SHELL_HTML = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline</title>
<style>
:root { color-scheme: light dark }
body {
	margin: 0;
	min-height: 100vh;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 8px;
	padding: 24px;
	box-sizing: border-box;
	text-align: center;
	background: Canvas;
	color: CanvasText;
	font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
h1 { margin: 0; font-size: 20px; font-weight: 600 }
p { margin: 0; max-width: 28rem; font-size: 15px; line-height: 1.5; opacity: 0.75 }
</style>
<h1>You're offline</h1>
<p>This page was never saved for offline use. Reconnect and reload.</p>
</html>
`;

/** 503, because the app is the thing that is unavailable, not the URL. */
const OFFLINE_SHELL_INIT = {
	status: 503,
	headers: {
		"Content-Type": "text/html; charset=utf-8",
		"Cache-Control": "no-store",
	},
};

/**
 * What an offline navigation answers with: the cached shell when there is one,
 * the offline page's ingredients when there is not. The choice lives here,
 * clear of `Response` and every other worker global, so both branches are unit
 * tested; `sw.js` turns the second one into an actual response.
 *
 * @param {unknown} cached the `cache.match(SHELL_URL)` result, or undefined
 * @returns {unknown} the cached response, or `{ html, init }`
 */
function offlineNavigationResponse(cached) {
	return cached ?? { html: OFFLINE_SHELL_HTML, init: OFFLINE_SHELL_INIT };
}

// Present when required from Jest, absent in the service worker scope.
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		chooseStrategy,
		offlineNavigationResponse,
		IMMUTABLE_PREFIX,
		RESERVED_PREFIX,
		OFFLINE_SHELL_HTML,
		OFFLINE_SHELL_INIT,
	};
}
