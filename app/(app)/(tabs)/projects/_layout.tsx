import { Stack } from "expo-router";

/**
 * Drill-down is a Stack **inside** the Projects tab, so the tab bar stays put at
 * every depth — and browser back, the PWA back gesture, reload and a shared link
 * all work, because every board is a real route.
 *
 * `dangerouslySingular` is what makes going *up* work. Every nested board is the
 * same route **name**, `[nodeId]`, and `POP_TO` — which is what `router.dismissTo`
 * issues — matches on the name: without an identity it resolves to the screen you
 * are already on and merely swaps its params. Tapping a breadcrumb would then
 * leave the whole stack in place with its top re-pointed, so browser back would
 * go *deeper* rather than up, and every stranded screen would keep its three
 * listeners alive — the listener breadth `CLAUDE.md` names as this app's cost
 * risk. The node id is the identity, so one board is one screen.
 *
 * The details screen is in the same Stack for the same reasons, and needs the
 * same identity: every node's details is the route name `[nodeId]/details`, so
 * without one they would collapse into each other exactly as the boards did.
 *
 * No header: each screen renders its own `Appbar`, which carries the
 * breadcrumbs and the account menu.
 *
 * `initialRouteName="index"` names the root board as the Stack's initial
 * route, so a tab press lands on `/projects` instead of a board with no node
 * id. Declaration order would put `index` first too, but that hoisting is an
 * implementation detail no documented API guarantees, so the prop, not the
 * ordering, is the mechanism. The `<Stack.Screen name="index" />` declaration
 * stays to document the screen.
 */
export default function ProjectsLayout() {
	const identity = (_name: string, params: Record<string, unknown>) =>
		String(params.nodeId);

	return (
		<Stack screenOptions={{ headerShown: false }} initialRouteName="index">
			<Stack.Screen name="index" />
			<Stack.Screen name="[nodeId]/index" dangerouslySingular={identity} />
			<Stack.Screen name="[nodeId]/details" dangerouslySingular={identity} />
		</Stack>
	);
}
