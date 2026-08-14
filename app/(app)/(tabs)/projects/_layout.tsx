import { Stack } from "expo-router";

/**
 * Drill-down is a Stack **inside** the Projects tab, so the tab bar stays put at
 * every depth — and browser back, the PWA back gesture, reload and a shared link
 * all work, because every board is a real route.
 *
 * No header: each board screen renders its own `Appbar`, which carries the
 * breadcrumbs and the account menu.
 */
export default function ProjectsLayout() {
	return <Stack screenOptions={{ headerShown: false }} />;
}
