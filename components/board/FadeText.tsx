import type { ReactNode } from "react";
import type { StyleProp, TextStyle } from "react-native";
import { Text } from "react-native-paper";

interface FadeTextProps {
	color: string;
	accessibilityLabel?: string;
	style?: StyleProp<TextStyle>;
	children: ReactNode;
}

/**
 * The waiting fact's text on a card (#339): one line that gives up at the
 * card's right edge. Native has no CSS mask to fade with, so the cut is an
 * ellipsis; the web variant fades with a mask instead.
 */
export function FadeText({
	color,
	accessibilityLabel,
	style,
	children,
}: FadeTextProps) {
	return (
		<Text
			variant="labelMedium"
			numberOfLines={1}
			accessibilityLabel={accessibilityLabel}
			style={[{ color, flexShrink: 1 }, style]}
		>
			{children}
		</Text>
	);
}
