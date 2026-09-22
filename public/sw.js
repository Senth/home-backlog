/**
 * Hand-rolled runtime-caching service worker — no Workbox, no precache
 * manifest, no build step. Assets are cached the first time they are used,
 * which is enough because the app cannot be used before signing in online once.
 *
 * The worker takes over the moment it installs (`skipWaiting`) and claims its
 * pages on activation (`clients.claim`), because a worker that waits is the
 * bug this file used to be (#264): an Android PWA launched off a sleeping
 * phone would keep the old shell, and every content-hashed bundle it names is
 * still a cache-first hit, so a complete, coherent old build lived forever
 * behind a worker that was waiting for a Reload tap the user had no reason to
 * know about.
 *
 * Taking over is not the same as swapping the page under the user. That
 * decision belongs to `hooks/use-service-worker.web.ts`, which reloads inside
 * the first seconds after boot — before anyone can be mid-edit — and raises
 * the update banner after that.
 *
 * Bump `VERSION` whenever this file changes, so `activate` drops the old cache.
 */

importScripts("./sw-routing.js");

// Bumped with every change to this file, see the header. v5 adds the offline
// navigation fallback; anything older may hold a shell naming bundles the
// origin no longer serves.
const VERSION = "v5";
const CACHE = `home-backlog-${VERSION}`;
/** Enough to boot the SPA offline; every route renders from this shell. */
const SHELL_URL = "/";
/** The brand mark is precached with the shell: the splash and the login screen
 *  both exist to say "this is not broken", and they are exactly the screens a
 *  first offline visit reaches. Its path is fixed rather than content-hashed,
 *  which is why it can be named here at all. `/index.html` is not on the list:
 *  it 301s to `/` under `cleanUrls`, so precaching it would store a
 *  redirect-resolved duplicate under a key nothing reads. */
const PRECACHE_URLS = [SHELL_URL, "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll(PRECACHE_URLS);
			// Claim as soon as the precache is in, so the launch after a deploy
			// runs the new worker — never the old one still waiting.
			await self.skipWaiting();
		})(),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(
				keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
			);
			// Pages opened before this worker installed have no controller
			// otherwise; without `claim` they would keep the old shell until
			// they were closed and reopened — the exact exit #264 describes.
			await self.clients.claim();
		})(),
	);
});

self.addEventListener("fetch", (event) => {
	const request = event.request;
	const url = new URL(request.url);
	const strategy = chooseStrategy({
		method: request.method,
		mode: request.mode,
		sameOrigin: url.origin === self.location.origin,
		pathname: url.pathname,
		search: url.search,
	});

	switch (strategy) {
		case "passthrough":
			return;
		case "navigate":
			event.respondWith(networkFirst(request));
			return;
		case "cache-first":
			event.respondWith(cacheFirst(request));
			return;
		default:
			event.respondWith(staleWhileRevalidate(event));
	}
});

/** Cache-writable responses only: a redirect or an error must not be stored.
 *  `cache.put` throws on a redirected response, which would reject the whole
 *  `respondWith` and paint a browser error page. */
function isCacheable(response) {
	return (
		Boolean(response) &&
		response.ok &&
		!response.redirected &&
		response.type !== "opaque"
	);
}

async function networkFirst(request) {
	// Opened inside the `try`: `caches.open` itself rejects when site data is
	// blocked (private browsing), and a rejection escaping this function is the
	// browser network-error page #322 is about.
	let cache;
	try {
		cache = await caches.open(CACHE);
		// `no-store` bypasses the browser HTTP cache, not just ours. Without it
		// "network-first" can be answered by an hour-old shell the HTTP cache
		// is still allowed to hold — the origin header is what actually made
		// the shell stale in production (#264).
		const response = await fetch(request, { cache: "no-store" });
		// Every route is stored as the one shell, never under its own URL. A
		// per-route copy would go stale independently, and because each exported
		// HTML file names a content-hashed bundle, an old copy would boot old app
		// code offline while other routes ran the new build.
		if (isCacheable(response)) await cache.put(SHELL_URL, response.clone());
		return response;
	} catch {
		// The shell renders any route client-side, so one entry covers them all.
		// No cache at all, or no shell in it: answer with our own page rather
		// than `Response.error()`, which the browser paints as a network error
		// over a working app (#322).
		const cached = cache
			? await cache.match(SHELL_URL).catch(() => undefined)
			: undefined;
		const answer = offlineNavigationResponse(cached);
		return answer instanceof Response
			? answer
			: new Response(answer.html, answer.init);
	}
}

async function cacheFirst(request) {
	const cache = await caches.open(CACHE);
	const cached = await cache.match(request);
	if (cached) return cached;
	const response = await fetch(request);
	if (isCacheable(response)) await cache.put(request, response.clone());
	return response;
}

async function staleWhileRevalidate(event) {
	const request = event.request;
	const cache = await caches.open(CACHE);
	const cached = await cache.match(request);

	const revalidated = fetch(request)
		.then(async (response) => {
			if (isCacheable(response)) await cache.put(request, response.clone());
			return response;
		})
		.catch(() => undefined);

	if (cached) {
		// Keep the worker alive for the background refresh after we have answered.
		event.waitUntil(revalidated);
		return cached;
	}
	return (await revalidated) ?? Response.error();
}
