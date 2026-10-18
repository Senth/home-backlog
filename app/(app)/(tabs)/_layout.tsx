import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { PlatformPressable } from "@react-navigation/elements";
import { Redirect, Tabs } from "expo-router";
import { useTranslation } from "react-i18next";
import { useWindowDimensions, View } from "react-native";
import { Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHome } from "@/contexts/HomeContext";
import { desktopLayout } from "@/models/desktop-layout";
import { useAppTheme } from "@/theme";
import {
	border,
	denseBreakpoint,
	icon,
	radius,
	railWidth,
	size,
	space,
	touchTarget,
} from "@/theme/tokens";

const tabIcons = {
	overview: "view-dashboard-outline",
	projects: "view-column-outline",
	locations: "home-outline",
	maintenance: "calendar-refresh-outline",
} as const;

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
	const { width, height } = useWindowDimensions();
	const rail =
		desktopLayout({ windowWidth: width, columnCount: 0, screen: "flow" })
			.nav === "rail";
	const besideIcon = !rail && width > height;
	const insets = useSafeAreaInsets();

	if (!activeHome) return <Redirect href="/homes" />;

	return (
		// Every tab visit, repeats included, is a history entry, so browser back
		// retraces the taps; "history" would replace a revisit and drop it.
		<Tabs
			backBehavior="fullHistory"
			screenOptions={({ route }) => ({
				headerShown: false,
				tabBarPosition: rail ? "left" : "bottom",
				tabBarVariant: rail ? "material" : "uikit",
				tabBarActiveTintColor: theme.colors.primary,
				tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
				tabBarActiveBackgroundColor: rail ? theme.colors.surface : undefined,
				tabBarStyle: {
					backgroundColor: theme.colors.surface,
					...(rail && {
						width: railWidth,
						paddingHorizontal: space.xs,
						paddingTop: space.md + insets.top,
						paddingBottom: space.md + insets.bottom,
						borderRightWidth: border.hairline,
						borderRightColor: theme.colors.outlineVariant,
					}),
					height:
						!rail && width < denseBreakpoint
							? size.appBarSmall + insets.bottom
							: undefined,
				},
				tabBarItemStyle: rail
					? { overflow: "visible", marginVertical: space.xs }
					: undefined,
				tabBarButton: rail
					? ({ style, ...props }) => (
							<PlatformPressable
								{...props}
								style={[
									style,
									{
										padding: space.xs,
										minWidth: touchTarget,
										minHeight: touchTarget,
										borderRadius: radius.md,
									},
								]}
							/>
						)
					: undefined,
				tabBarLabelPosition: besideIcon ? "beside-icon" : "below-icon",
				tabBarIconStyle: rail
					? {
							width: touchTarget + space.sm,
							height: space.xl,
							marginBottom: space.xs,
						}
					: besideIcon
						? { width: icon.md, height: icon.md }
						: { height: icon.md, marginTop: -space.xs },
				tabBarIcon: ({ color, size, focused }) => {
					const glyph = (
						<MaterialCommunityIcons
							name={tabIcons[route.name as keyof typeof tabIcons]}
							color={color}
							size={rail ? icon.md : size}
						/>
					);
					return rail ? (
						<View
							testID="navigation-pill"
							style={{
								width: touchTarget + space.sm,
								height: space.xl,
								borderRadius: radius.full,
								alignItems: "center",
								justifyContent: "center",
								backgroundColor: focused
									? theme.colors.primaryContainer
									: theme.colors.surface,
							}}
						>
							{glyph}
						</View>
					) : (
						glyph
					);
				},
				tabBarAccessibilityLabel: t(`tab.${route.name}`),
				// Soft hyphens keep the same words readable when each tab is narrow.
				tabBarLabel: ({ color, children, position }) => (
					<Text
						variant="labelMedium"
						numberOfLines={rail || width < denseBreakpoint ? undefined : 1}
						aria-label={children}
						style={
							position === "beside-icon"
								? { color, marginStart: space.sm }
								: {
										color,
										textAlign: "center",
										alignSelf: "stretch",
										marginHorizontal: -space.xs,
										maxWidth: width,
									}
						}
					>
						{rail || width < denseBreakpoint
							? t(`tab.${route.name}Narrow`)
							: children}
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
				}}
			/>
			<Tabs.Screen
				name="projects"
				options={{
					title: t("tab.projects"),
				}}
			/>
			<Tabs.Screen
				name="locations"
				options={{
					title: t("tab.locations"),
				}}
			/>
			<Tabs.Screen
				name="maintenance"
				options={{
					title: t("tab.maintenance"),
				}}
			/>
		</Tabs>
	);
}
