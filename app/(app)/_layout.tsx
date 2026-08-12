import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";

/**
 * The signed-in half of the app, and the gate that keeps it that way.
 *
 * The redirect is declarative and runs *during render*, not from an effect: an
 * effect fires after its children have already mounted, which is how a
 * signed-out deep link to `/projects` briefly painted the empty board and its
 * tab bar before bouncing to login. Returning `<Redirect />` here means the tab
 * routes never mount at all.
 *
 * `AuthGate` guarantees this only renders once auth has resolved, so `user`
 * being null is an answer and not a not-yet.
 */
export default function AppLayout() {
	const { user } = useAuth();

	if (!user) return <Redirect href="/(auth)/login" />;

	return <Stack screenOptions={{ headerShown: false }} />;
}
