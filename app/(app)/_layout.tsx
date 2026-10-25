import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardCardsProvider } from "@/contexts/DashboardCardsContext";
import { OutboxProvider } from "@/contexts/OutboxContext";
import { markLaunch } from "@/utils/launch-timing";

/**
 * The signed-in half of the app, and the gate that keeps it that way.
 *
 * The redirect is declarative and runs *during render*, not from an effect: an
 * effect fires after its children have already mounted, which is how a
 * signed-out deep link to `/projects` briefly painted the empty board and its
 * tab bar before bouncing to login. Returning `<Redirect />` here means the tab
 * routes never mount at all.
 *
 * The root `AuthGate` waits for auth, fonts and the initial homes answer.
 * `HomeProvider` already wraps it for a signed-in user, so this layout owns
 * only the signed-out redirect and the app's route-level providers.
 */
export default function AppLayout() {
	const { user } = useAuth();

	if (!user) return <Redirect href="/(auth)/login" />;

	return (
		<OutboxProvider key={user.uid}>
			<HomeGate />
		</OutboxProvider>
	);
}

/**
 * The root `AuthGate` has already resolved the active home before routes mount.
 * Manual homes retries keep these routes mounted instead of showing a splash.
 */
function HomeGate() {
	markLaunch("router");

	// One set of card-config listeners above both routes that read them:
	// Overview stays mounted under the editor, and a second subscription
	// there would double the budget the spec sets.
	return (
		<DashboardCardsProvider>
			<Stack screenOptions={{ headerShown: false }} />
		</DashboardCardsProvider>
	);
}
