import { initializeApp } from "firebase/app";
import {
	browserLocalPersistence,
	browserSessionPersistence,
	connectAuthEmulator,
	getAuth,
	indexedDBLocalPersistence,
	initializeAuth,
} from "firebase/auth";
import {
	connectFirestoreEmulator,
	getFirestore,
	initializeFirestore,
	persistentLocalCache,
	persistentMultipleTabManager,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import { Platform } from "react-native";

/**
 * The origin Firebase's OAuth handler is served from.
 *
 * It defaults to the origin the app itself is served from, not
 * `<project>.firebaseapp.com`. Firebase Hosting reserves `/__/auth/` on every
 * domain it serves, so `https://<app origin>/__/auth/handler` exists and is
 * *same-origin* with the app — which is what lets `signInWithRedirect` survive
 * Safari's third-party storage blocking. A cross-origin handler makes the
 * handshake depend on storage Safari discards, and the sign-in dead-ends.
 *
 * Adding a host means adding it to the Firebase authorized-domain list *and*
 * registering `https://<host>/__/auth/handler` as an authorized redirect URI on
 * the web OAuth client — see `docs/OPERATIONS.md`.
 *
 * The literal is the fallback for a context with no `window`: native, and the
 * static prerender of `expo export`. Neither reaches the web redirect flow.
 */
function defaultAuthDomain(): string {
	if (Platform.OS === "web" && typeof window !== "undefined") {
		return window.location.hostname;
	}
	return "home-backlog.firebaseapp.com";
}

const firebaseConfig = {
	apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "demo-api-key",
	// `||`, not `??`: an unset key in `.env.local` arrives as an empty string,
	// and an empty `authDomain` breaks the handler URL rather than falling back.
	authDomain:
		process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || defaultAuthDomain(),
	projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "home-backlog",
	storageBucket:
		process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ??
		"home-backlog.firebasestorage.app",
	messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
	appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? "",
};

const app = initializeApp(firebaseConfig);

/**
 * Web session persistence, written out rather than inherited.
 *
 * "Signing in remembers you" is the app's headline promise, and until now it
 * rested on whatever `getAuth()` happens to default to. This array *is* that
 * default, so nothing changes today — but a future Firebase major cannot alter
 * it behind our backs, and the promise is now stated where it is enforced.
 *
 * The chain is kept rather than pinning IndexedDB alone: a browser that blocks
 * IndexedDB (a Firefox private window, some embedded webviews) would fail
 * outright and make sign-in impossible, where the chain degrades to a
 * session-only login that still works.
 *
 * `popupRedirectResolver` is deliberately **not** set here, and passed to
 * `signInWithRedirect` / `getRedirectResult` per call instead. Given it at
 * init, `@firebase/auth` awaits `resolver._initialize()` *before*
 * `initializeCurrentUser()` whenever `_shouldInitProactively` — which is
 * `_isMobileBrowser() || _isSafari() || _isIOS()`, so every phone this app
 * targets. That loads the handler iframe on a 30–60 s network timeout, and
 * until it settles the first `onAuthStateChanged` cannot fire: on lie-fi a
 * user whose session is already in IndexedDB would sit on the splash for half
 * a minute. Per call, the iframe loads only when someone is actually signing
 * in.
 *
 * TODO(native): `initializeAuth` without a persistence adapter keeps the
 * session in memory, so a native app forgets the user on relaunch. The fix is
 * `getReactNativePersistence(AsyncStorage)`, which only exists in Firebase's
 * React Native build and is absent from the `firebase/auth` typings entry.
 * Wire it up as part of the native build work — web is unaffected.
 */
function createAuth() {
	if (Platform.OS !== "web") return initializeAuth(app);

	try {
		return initializeAuth(app, {
			persistence: [
				indexedDBLocalPersistence,
				browserLocalPersistence,
				browserSessionPersistence,
			],
		});
	} catch {
		// Fast Refresh can re-run this module while the Auth instance from the
		// previous evaluation is still registered, which `initializeAuth` treats
		// as an error. The existing instance already has the settings above.
		return getAuth(app);
	}
}

const auth = createAuth();

// IndexedDB persistence is what makes the installed PWA usable offline: reads
// come from cache and writes queue until reconnect. The multi-tab manager keeps
// the installed app and a browser tab from fighting over the lease — with the
// single-tab manager the second one to open throws `failed-precondition`.
// Native has no IndexedDB for the JS SDK, so it stays on the memory cache.
const db =
	Platform.OS === "web"
		? initializeFirestore(app, {
				localCache: persistentLocalCache({
					tabManager: persistentMultipleTabManager(),
				}),
			})
		: getFirestore(app);

const storage = getStorage(app);

/**
 * The callables, in the region the functions are actually deployed to.
 *
 * `getFunctions(app)` defaults to `us-central1`, where none of them exists — and
 * the failure is a CORS error on a URL that does not resolve, which says nothing
 * about regions. Firestore and Storage are both in `europe-west1` and cannot be
 * moved, so the functions are there too; this literal and the one in
 * `functions/src/options.ts` have to agree.
 *
 * Only `createApiKey` is called from here. Everything else the API does is
 * reached over HTTP by an agent, not by this app.
 */
const functionsRegion = "europe-west1";
const functions = getFunctions(app, functionsRegion);

/**
 * There is no dev Firebase project — see `CLAUDE.md`. Local development
 * always targets the emulator suite, so a rules experiment or a bad migration
 * cannot reach the household's real data.
 *
 * `__DEV__` is false in an `expo export` bundle, so production builds and CI
 * never take this branch. The ports are the ones `scripts/dev-stack.sh up`
 * allocated for this worktree and exports as `EXPO_PUBLIC_EMULATOR_*` — never
 * literals, so two worktrees can each run a stack at once.
 */
if (__DEV__) {
	const authPort = Number(process.env.EXPO_PUBLIC_EMULATOR_AUTH);
	const firestorePort = Number(process.env.EXPO_PUBLIC_EMULATOR_FIRESTORE);
	const storagePort = Number(process.env.EXPO_PUBLIC_EMULATOR_STORAGE);
	const functionsPort = Number(process.env.EXPO_PUBLIC_EMULATOR_FUNCTIONS);
	if (!authPort || !firestorePort || !storagePort || !functionsPort) {
		throw new Error(
			"Emulator ports are missing from the environment — start the stack with scripts/dev-stack.sh up, which sets EXPO_PUBLIC_EMULATOR_*",
		);
	}
	const host = "localhost";
	connectAuthEmulator(auth, `http://${host}:${authPort}`, {
		disableWarnings: true,
	});
	connectFirestoreEmulator(db, host, firestorePort);
	connectStorageEmulator(storage, host, storagePort);
	connectFunctionsEmulator(functions, host, functionsPort);
}

export { auth, db, functions, storage };
