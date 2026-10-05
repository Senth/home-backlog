import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Redirect, Tabs } from "expo-router";
import { useTranslation } from "react-i18next";
import { useWindowDimensions } from "react-native";
import { Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHome } from "@/contexts/HomeContext";
import { useAppTheme } from "@/theme";
import { denseBreakpoint, icon, size, space } from "@/theme/tokens";

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
	const insets = useSafeAreaInsets();

	if (!activeHome) return <Redirect href="/homes" />;

	return (
		// Every tab visit, repeats included, is a history entry, so browser back
		// retraces the taps; "history" would replace a revisit and drop it.
		<Tabs
			backBehavior="fullHistory"
			screenOptions={({ route }) => ({
				headerShown: false,
				tabBarActiveTintColor: theme.colors.primary,
				tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
				tabBarStyle: {
					backgroundColor: theme.colors.surface,
					height:
						width < denseBreakpoint
							? size.appBarSmall + insets.bottom
							: undefined,
				},
				tabBarIconStyle: { height: icon.md, marginTop: -space.xs },
				tabBarAccessibilityLabel: t(`tab.${route.name}`),
				// Soft hyphens keep the same words readable when each tab is narrow.
				tabBarLabel: ({ color, children }) => (
					<Text
						variant="labelMedium"
						numberOfLines={width < denseBreakpoint ? undefined : 1}
						aria-label={children}
						style={{
							color,
							textAlign: "center",
							alignSelf: "stretch",
							marginHorizontal: -space.xs,
							maxWidth: width,
						}}
					>
						{width < denseBreakpoint ? t(`tab.${route.name}Narrow`) : children}
					</Text>
				),
			})}
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
