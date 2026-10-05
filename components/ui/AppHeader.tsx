import type { ComponentProps, ReactNode } from "react";
import { useWindowDimensions } from "react-native";
import { Appbar, Text } from "react-native-paper";
import { useAppTheme } from "@/theme";
import { appBarStackBreakpoint, size, space } from "@/theme/tokens";

interface AppHeaderProps {
	title: string;
	leading?: ReactNode;
	children?: ReactNode;
	style?: ComponentProps<typeof Appbar.Header>["style"];
}

export function AppHeader({ title, leading, children, style }: AppHeaderProps) {
	const { width } = useWindowDimensions();
	const theme = useAppTheme();
	const stacked = width < appBarStackBreakpoint;

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
					<Text
						variant={stacked ? "headlineSmall" : "titleLarge"}
						style={{ color: theme.colors.onSurface }}
						accessible
						accessibilityRole="header"
						testID="app-header-title"
					>
						{title}
					</Text>
				}
			/>
			{children}
		</Appbar.Header>
	);
}
