import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";

/**
 * The signed-out half. Mirror of `(app)/_layout.tsx`: a signed-in visitor who
 * deep-links to `/login` is redirected during render, so the login screen never
 * mounts and never flashes at someone who is already signed in.
 */
export default function AuthLayout() {
	const { user } = useAuth();

	if (user) return <Redirect href="/(app)/(tabs)/overview" />;

	return <Stack screenOptions={{ headerShown: false }} />;
}
