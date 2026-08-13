import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Redirect, Tabs } from "expo-router";
import { useTranslation } from "react-i18next";
import { useHome } from "@/contexts/HomeContext";
import { useAppTheme } from "@/theme";

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
					title: t("tab.maintenance"),
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
