// The service worker's routing table is plain JS served from `public/`, so it
// is required by path rather than imported through the module graph.
const { chooseStrategy, OFFLINE_SHELL_HTML, OFFLINE_SHELL_INIT } =
	require("@/public/sw-routing.js") as {
		chooseStrategy: (request: {
			method: string;
			mode: string;
			sameOrigin: boolean;
			pathname: string;
			search: string;
		}) => string;
		OFFLINE_SHELL_HTML: string;
		OFFLINE_SHELL_INIT: { status: number; headers: Record<string, string> };
	};

const GET = {
	method: "GET",
	mode: "cors",
	sameOrigin: true,
	pathname: "/whatever",
	search: "",
};

describe("chooseStrategy", () => {
	it("never touches writes", () => {
		expect(chooseStrategy({ ...GET, method: "POST" })).toBe("passthrough");
	});

	it("never touches cross-origin requests", () => {
		// Firestore, Google auth and fonts manage their own offline behavior.
		expect(chooseStrategy({ ...GET, sameOrigin: false })).toBe("passthrough");
	});

	it("leaves cross-origin navigations alone too", () => {
		expect(
			chooseStrategy({ ...GET, sameOrigin: false, mode: "navigate" }),
		).toBe("passthrough");
	});

	it("never touches Firebase's reserved namespace", () => {
		// `authDomain` is the app's own origin, so the OAuth handler and the
		// hidden auth iframe are same-origin. Caching either would overwrite the
		// offline app shell with Google's sign-in page.
		expect(
			chooseStrategy({
				...GET,
				mode: "navigate",
				pathname: "/__/auth/handler",
			}),
		).toBe("passthrough");
		expect(
			chooseStrategy({ ...GET, mode: "navigate", pathname: "/__/auth/iframe" }),
		).toBe("passthrough");
		expect(chooseStrategy({ ...GET, pathname: "/__/firebase/init.json" })).toBe(
			"passthrough",
		);
	});

	it("serves navigations network-first", () => {
		expect(chooseStrategy({ ...GET, mode: "navigate", pathname: "/" })).toBe(
			"navigate",
		);
	});

	it("serves content-hashed bundles cache-first", () => {
		expect(
			chooseStrategy({
				...GET,
				pathname: "/_expo/static/js/web/entry-abc123.js",
			}),
		).toBe("cache-first");
	});

	it("revalidates everything else in the background", () => {
		expect(chooseStrategy({ ...GET, pathname: "/icons/icon-192.png" })).toBe(
			"stale-while-revalidate",
		);
	});

	it("passes the shell freshness check through to the wire", () => {
		// The marker query in use-service-worker.web.ts must never be answered
		// from cache: the check compares the deployed shell against the cached
		// one, so an answer from this worker always reads as fresh.
		expect(
			chooseStrategy({
				...GET,
				pathname: "/",
				search: "?build-check=1789074600000",
			}),
		).toBe("passthrough");
	});
});

describe("the offline navigation fallback", () => {
	it("is HTML the browser will render instead of its own error page", () => {
		// `Response.error()` here reads as a real connection failure (#322).
		expect(OFFLINE_SHELL_INIT.status).toBe(503);
		expect(OFFLINE_SHELL_INIT.headers["Content-Type"]).toBe(
			"text/html; charset=utf-8",
		);
		expect(new Response(OFFLINE_SHELL_HTML, OFFLINE_SHELL_INIT).type).not.toBe(
			"error",
		);
	});

	it("says what happened and what to do about it", () => {
		expect(OFFLINE_SHELL_HTML).toContain("<!doctype html>");
		expect(OFFLINE_SHELL_HTML).toContain("offline");
		expect(OFFLINE_SHELL_HTML).toContain("reload");
	});

	it("is never stored by the HTTP cache", () => {
		// A 503 kept by the browser cache would outlive the outage.
		expect(OFFLINE_SHELL_INIT.headers["Cache-Control"]).toBe("no-store");
	});
});
