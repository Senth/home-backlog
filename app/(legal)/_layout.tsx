import { Stack } from "expo-router";

/**
 * The privacy policy and the terms of service. Deliberately outside both gated
 * groups: the policy is part of how someone decides to sign in, so it has to
 * render while signed out. The `(app)` gate must never see this visitor, and
 * the signed-in redirect in `(auth)` must never catch someone who is already
 * signed in — neither does, because this group asks `useAuth` nothing.
 */
export default function LegalLayout() {
	return <Stack screenOptions={{ headerShown: false }} />;
}
