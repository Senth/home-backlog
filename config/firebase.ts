import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, initializeAuth } from "firebase/auth";
import {
	connectFirestoreEmulator,
	getFirestore,
	initializeFirestore,
	persistentLocalCache,
	persistentMultipleTabManager,
} from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import { Platform } from "react-native";

const firebaseConfig = {
	apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "demo-api-key",
	authDomain:
		process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ??
		"home-backlog.firebaseapp.com",
	projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "home-backlog",
	storageBucket:
		process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ??
		"home-backlog.firebasestorage.app",
	messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
	appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? "",
};

const app = initializeApp(firebaseConfig);

// TODO(native): `initializeAuth` without a persistence adapter keeps the
// session in memory, so a native app forgets the user on relaunch. The fix is
// `getReactNativePersistence(AsyncStorage)`, which only exists in Firebase's
// React Native build and is absent from the `firebase/auth` typings entry.
// Wire it up as part of the native build work — web is unaffected.
const auth = Platform.OS === "web" ? getAuth(app) : initializeAuth(app);

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
 * There is no dev Firebase project — see `CLAUDE.md`. Local development
 * always targets the emulator suite, so a rules experiment or a bad migration
 * cannot reach the household's real data.
 *
 * `__DEV__` is false in an `expo export` bundle, so production builds and CI
 * never take this branch. Ports are offset from the sibling project's
 * (8050–8052) so both emulator suites can run side by side.
 */
if (__DEV__) {
	const host = "localhost";
	connectAuthEmulator(auth, `http://${host}:8061`, { disableWarnings: true });
	connectFirestoreEmulator(db, host, 8062);
	connectStorageEmulator(storage, host, 8063);
}

export { auth, db, storage };
