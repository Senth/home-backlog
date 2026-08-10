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
import { auth } from "@/config/firebase";

interface AuthContextType {
	user: User | null;
	/** True until Firebase has reported the restored session, if any. */
	loading: boolean;
	/** Exchanges a Google ID token for a Firebase session (native flow). */
	signInWithGoogle: (idToken: string) => Promise<void>;
	signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<User | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		return onAuthStateChanged(auth, (nextUser) => {
			setUser(nextUser);
			setLoading(false);
		});
	}, []);

	const signInWithGoogle = useCallback(async (idToken: string) => {
		await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
	}, []);

	const signOut = useCallback(async () => {
		await firebaseSignOut(auth);
	}, []);

	const value = useMemo(
		() => ({ user, loading, signInWithGoogle, signOut }),
		[user, loading, signInWithGoogle, signOut],
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
