/**
 * Hand-rolled runtime-caching service worker — no Workbox, no precache
 * manifest, no build step. Assets are cached the first time they are used,
 * which is enough because the app cannot be used before signing in online once.
 *
 * Deliberately never calls `skipWaiting()` on its own: a worker swap reloads
 * the page, and a reload loses whatever the user was typing. The waiting worker
 * only takes over when the user taps Reload in the in-app update banner.
 *
 * Bump `VERSION` whenever this file changes, so `activate` drops the old cache.
 */

importScripts("./sw-routing.js");

const VERSION = "v1";
const CACHE = `home-backlog-${VERSION}`;
/** Enough to boot the SPA offline; every route renders from this shell. */
const SHELL_URL = "/index.html";
const PRECACHE_URLS = ["/", SHELL_URL];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE).then((cache) => cache.addAll(PRECACHE_URLS)),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(
				keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
			);
		})(),
	);
});

self.addEventListener("message", (event) => {
	// Only ever reached from the update banner's Reload action.
	if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
	const request = event.request;
	const url = new URL(request.url);
	const strategy = chooseStrategy({
		method: request.method,
		mode: request.mode,
		sameOrigin: url.origin === self.location.origin,
		pathname: url.pathname,
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

/** Cache-writable responses only: a redirect or an error must not be stored. */
function isCacheable(response) {
	return Boolean(response) && response.ok && response.type !== "opaque";
}

async function networkFirst(request) {
	const cache = await caches.open(CACHE);
	try {
		const response = await fetch(request);
		// Every route is stored as the one shell, never under its own URL. A
		// per-route copy would go stale independently, and because each exported
		// HTML file names a content-hashed bundle, an old copy would boot old app
		// code offline while other routes ran the new build.
		if (isCacheable(response)) await cache.put(SHELL_URL, response.clone());
		return response;
	} catch {
		// The shell renders any route client-side, so one entry covers them all.
		return (await cache.match(SHELL_URL)) ?? Response.error();
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
