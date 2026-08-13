import { Redirect, Stack } from "expo-router";
import { SplashScreen } from "@/components/ui/SplashScreen";
import { useAuth } from "@/contexts/AuthContext";
import { HomeProvider, useHome } from "@/contexts/HomeContext";

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
 * being null is an answer and not a not-yet — and `HomeProvider` mounting
 * *inside* that answer is what stops the homes query racing sign-in.
 */
export default function AppLayout() {
	const { user } = useAuth();

	if (!user) return <Redirect href="/(auth)/login" />;

	return (
		<HomeProvider user={user}>
			<HomeGate />
		</HomeProvider>
	);
}

/**
 * The same argument as `AuthGate`, one level down: until the app knows which
 * home is active, every route it could mount is a guess. `/homes` and the tab
 * routes answer opposite questions, and showing either one early is how a
 * signed-in user with two homes watches the app open the wrong one and correct
 * itself.
 */
function HomeGate() {
	const { loading } = useHome();

	if (loading) return <SplashScreen />;

	return <Stack screenOptions={{ headerShown: false }} />;
}
