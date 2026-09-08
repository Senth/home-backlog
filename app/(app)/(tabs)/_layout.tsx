import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Redirect, Tabs } from "expo-router";
import { useTranslation } from "react-i18next";
import { useWindowDimensions } from "react-native";
import { useHome } from "@/contexts/HomeContext";
import { useAppTheme } from "@/theme";
import { denseBreakpoint } from "@/theme/tokens";

/**
 * The boards, and the gate that keeps them scoped to a home.
 *
 * Same declarative, during-render redirect as the auth gate one level up: with
 * no active home there is nothing for these screens to load, and mounting them
 * first would paint three empty boards and a tab bar before bouncing. `/homes`
 * lives outside `(tabs)`, so this cannot loop.
 */
export default function TabsLayout() {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const { activeHome } = useHome();
	const { width } = useWindowDimensions();

	if (!activeHome) return <Redirect href="/homes" />;

	return (
		<Tabs
			screenOptions={{
				headerShown: false,
				tabBarActiveTintColor: theme.colors.primary,
				tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
				tabBarStyle: { backgroundColor: theme.colors.surface },
			}}
		>
			{/* First, and the route the app opens on: a summary you have to
			    navigate to is a summary nobody reads. */}
			<Tabs.Screen
				name="overview"
				options={{
					title: t("tab.overview"),
					tabBarIcon: ({ color, size }) => (
						<MaterialCommunityIcons
							name="view-dashboard-outline"
							color={color}
							size={size}
						/>
					),
				}}
			/>
			<Tabs.Screen
				name="projects"
				options={{
					title: t("tab.projects"),
					tabBarIcon: ({ color, size }) => (
						<MaterialCommunityIcons
							name="view-column-outline"
							color={color}
							size={size}
						/>
					),
				}}
			/>
			<Tabs.Screen
				name="locations"
				options={{
					title: t("tab.locations"),
					tabBarIcon: ({ color, size }) => (
						<MaterialCommunityIcons
							name="home-outline"
							color={color}
							size={size}
						/>
					),
				}}
			/>
			<Tabs.Screen
				name="maintenance"
				options={{
					// "Maintenance" is the one tab label longer than its Swedish
					// counterpart, and a single word cannot wrap — at a 195 px viewport
					// (a 390 px phone at 200 % zoom) it truncates to "Mainten…". One
					// word carries the tab down there.
					title:
						width < denseBreakpoint
							? t("tab.maintenanceNarrow")
							: t("tab.maintenance"),
					tabBarIcon: ({ color, size }) => (
						<MaterialCommunityIcons
							name="calendar-refresh-outline"
							color={color}
							size={size}
						/>
					),
				}}
			/>
		</Tabs>
	);
}
