import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Tabs } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "@/theme";

export default function TabsLayout() {
	const { t } = useTranslation();
	const theme = useAppTheme();

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
