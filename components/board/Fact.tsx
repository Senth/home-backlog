import type { ReactNode } from "react";
import { View } from "react-native";
import { Icon, Text } from "react-native-paper";
import { FadeText } from "@/components/board/FadeText";
import { useAppTheme } from "@/theme";
import { icon, space } from "@/theme/tokens";

interface FactProps {
	source: string;
	/** Overrides the muted tier — the warning color, on an overdue card. */
	color?: string;
	/** What a screen reader hears instead of the visual shorthand. */
	accessibilityLabel?: string;
	/**
	 * One line that fades at the card's right edge instead of wrapping (#339)
	 * — the waiting fact, whose words name a card that may be called anything.
	 */
	fade?: boolean;
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
	fade = false,
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
				// The faded fact claims the whole line it sits on, so its fade
				// waits at the card's edge for words that actually get there —
				// a fact that fits is never faded.
				flex: fade ? 1 : undefined,
			}}
		>
			<Icon source={source} size={icon.sm} color={tone} />
			{fade ? (
				<FadeText color={tone} accessibilityLabel={accessibilityLabel}>
					{children}
				</FadeText>
			) : (
				<Text
					variant="labelMedium"
					accessibilityLabel={accessibilityLabel}
					style={{ color: tone, flexShrink: 1 }}
				>
					{children}
				</Text>
			)}
		</View>
	);
}
