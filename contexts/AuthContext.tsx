import {
	signOut as firebaseSignOut,
	GoogleAuthProvider,
	onAuthStateChanged,
	signInWithCredential,
	type User,
} from "firebase/auth";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { type AuthErrorKey, mapAuthError } from "@/auth/errors";
import { consumeRedirectResult } from "@/auth/redirect";
import { auth } from "@/config/firebase";

interface AuthContextType {
	user: User | null;
	/**
	 * True until the app knows whether anyone is signed in. Nothing may route
	 * on the answer before this is false — see `AuthGate`.
	 */
	loading: boolean;
	/** i18n key for a failed return leg of `signInWithRedirect`, if any. */
	redirectError: AuthErrorKey | null;
	dismissRedirectError: () => void;
	/** Exchanges a Google ID token for a Firebase session (native flow). */
	signInWithGoogle: (idToken: string) => Promise<void>;
	signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * How long the splash is allowed to wait on the redirect leg before the app
 * routes on what `onAuthStateChanged` alone has told it. Long enough that a
 * healthy return from Google is never cut short, short enough that lie-fi does
 * not strand a signed-in user on a splash.
 */
const redirectGraceMs = 5000;

export function AuthProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<User | null>(null);
	const [sessionResolved, setSessionResolved] = useState(false);
	const [redirectResolved, setRedirectResolved] = useState(false);
	const [redirectError, setRedirectError] = useState<AuthErrorKey | null>(null);

	useEffect(() => {
		return onAuthStateChanged(auth, (nextUser) => {
			setUser(nextUser);
			setSessionResolved(true);
		});
	}, []);

	// Coming back from Google, `onAuthStateChanged` can report "no user" before
	// the redirect credential has been exchanged. Waiting for both is what stops
	// the login screen flashing on the way in.
	//
	// But this gate holds the whole router, and on a bad connection Firebase's
	// resolver can sit on a 30-60 s network timeout — a signed-in user with a
	// session already in IndexedDB would stare at a splash. The cap gives that
	// up after `redirectGraceMs`: a credential that lands later still arrives
	// through `onAuthStateChanged`, which is the only path that can actually
	// sign anyone in.
	useEffect(() => {
		let live = true;
		const settle = () => {
			if (live) setRedirectResolved(true);
		};
		const grace = setTimeout(settle, redirectGraceMs);

		consumeRedirectResult()
			.catch((error) => {
				// Handled: the message below reaches the user through the login
				// screen's Snackbar. Warn rather than error so a working, explained
				// failure does not read as a crash in the console.
				console.warn("Google sign-in redirect failed:", error);
				if (live) setRedirectError(mapAuthError(error));
			})
			.finally(() => {
				clearTimeout(grace);
				settle();
			});

		return () => {
			live = false;
			clearTimeout(grace);
		};
	}, []);

	const dismissRedirectError = useCallback(() => setRedirectError(null), []);

	const signInWithGoogle = useCallback(async (idToken: string) => {
		await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
	}, []);

	const signOut = useCallback(async () => {
		await firebaseSignOut(auth);
	}, []);

	const value = useMemo(
		() => ({
			user,
			loading: !sessionResolved || !redirectResolved,
			redirectError,
			dismissRedirectError,
			signInWithGoogle,
			signOut,
		}),
		[
			user,
			sessionResolved,
			redirectResolved,
			redirectError,
			dismissRedirectError,
			signInWithGoogle,
			signOut,
		],
	);

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
	const context = useContext(AuthContext);
	if (context === undefined) {
		throw new Error("useAuth must be used within an AuthProvider");
	}
	return context;
}
