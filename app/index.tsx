import { Redirect } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";

/**
 * The root route only decides where to send you. It never renders while auth is
 * unresolved — `AuthGate` in `_layout.tsx` shows the splash instead of the
 * router until then — so `user` here is an answer, not a guess. Redirecting to
 * the tabs unconditionally is what used to flash the empty Projects board at a
 * signed-out visitor.
 */
export default function Index() {
	const { user } = useAuth();

	return <Redirect href={user ? "/(app)/(tabs)/projects" : "/(auth)/login"} />;
}
