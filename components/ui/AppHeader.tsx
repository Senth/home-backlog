import type { ComponentProps, ReactNode } from "react";
import { useWindowDimensions, View } from "react-native";
import { Appbar, Text } from "react-native-paper";
import { useAppTheme } from "@/theme";
import { appBarStackBreakpoint, size, space } from "@/theme/tokens";

interface AppHeaderProps {
	title: string;
	leading?: ReactNode;
	children?: ReactNode;
	subtitle?: ReactNode;
	titleVariant?: ComponentProps<typeof Text>["variant"];
	style?: ComponentProps<typeof Appbar.Header>["style"];
}

export function AppHeader({
	title,
	leading,
	children,
	subtitle,
	titleVariant,
	style,
}: AppHeaderProps) {
	const { width } = useWindowDimensions();
	const theme = useAppTheme();
	const stacked = width < appBarStackBreakpoint;
	const variant = titleVariant ?? (stacked ? "headlineSmall" : "titleLarge");
	const titleContent = (
		<Text
			variant={variant}
			style={{ color: theme.colors.onSurface, flexShrink: 1 }}
			accessible
			accessibilityRole="header"
			testID="app-header-title"
		>
			{title}
		</Text>
	);

	return (
		<Appbar.Header
			mode={stacked ? "medium" : "small"}
			testID="app-header"
			style={[
				{
					height: "auto",
					minHeight: stacked ? size.appBarMedium : size.appBarSmall,
					flexShrink: 0,
					paddingVertical: stacked ? space.none : space.sm,
				},
				style,
			]}
		>
			{leading}
			<Appbar.Content
				style={{ minWidth: space.none }}
				title={
					subtitle === undefined ? (
						titleContent
					) : (
						<View style={{ flexShrink: 1, minWidth: space.none }}>
							{titleContent}
							{subtitle}
						</View>
					)
				}
			/>
			{children}
		</Appbar.Header>
	);
}
