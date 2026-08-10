import { Redirect } from "expo-router";

/**
 * The root route exists only to hand off to the tabs. `AuthGate` in
 * `_layout.tsx` bounces to login if there is no session, so this never renders
 * anything for a signed-out visitor.
 */
export default function Index() {
	return <Redirect href="/(app)/(tabs)/projects" />;
}
