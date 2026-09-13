/**
 * `requestAnimationFrame` for the Node side of web server rendering.
 *
 * The SSR entry is `@expo/router-server`'s own render module, which never
 * evaluates this app's `index.ts` — so the polyfill has to ride the route
 * graph (`app/_layout.tsx`), whose modules the SSR bundle requires eagerly,
 * before any render. `react-native-worklets` flushes its web UI queue with
 * `requestAnimationFrame` (0.12 dropped the mock fallback 0.7 shipped), and
 * Node has none. Browsers and jsdom define it, so this is a no-op there.
 */

if (typeof globalThis.requestAnimationFrame === "undefined") {
	globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
		setTimeout(
			() => callback(performance.now()),
			0,
		)) as unknown as typeof requestAnimationFrame;
}
