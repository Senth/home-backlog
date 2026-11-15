import type { ReactNode } from "react";
import { View } from "react-native";
import { Icon, Text } from "react-native-paper";
import { useAppTheme } from "@/theme";
import { icon, space } from "@/theme/tokens";

interface FactProps {
	source: string;
	/** Overrides the muted tier — the warning color, on an overdue card. */
	color?: string;
	/** What a screen reader hears instead of the visual shorthand. */
	accessibilityLabel?: string;
	oneLine?: boolean;
	children: ReactNode;
}

/**
 * One bare fact: a leading glyph and the words, no box around them. The
 * card's footer is text on the card, and a chip border there was one more
 * edge competing with the card's own.
 */
export function Fact({
	source,
	color,
	accessibilityLabel,
	oneLine = false,
	children,
}: FactProps) {
	const theme = useAppTheme();
	const tone = color ?? theme.colors.onCardMuted;

	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: space.xs,
				flex: oneLine ? 1 : undefined,
			}}
		>
			<Icon source={source} size={icon.sm} color={tone} />
			<Text
				variant="labelMedium"
				numberOfLines={oneLine ? 1 : undefined}
				accessibilityLabel={accessibilityLabel}
				style={{ color: tone, flexShrink: 1 }}
			>
				{children}
			</Text>
		</View>
	);
}
