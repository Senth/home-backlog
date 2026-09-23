import type { ReactNode } from "react";
import type { StyleProp, TextStyle } from "react-native";
import { Text } from "react-native-paper";
import { space } from "@/theme/tokens";

// The ramp is an alpha mask, not a color: `black` is where the words are
// still whole, `transparent` is the card's right edge (#339). The stop sits
// one `space.md` in from the edge, so a line that fits is never faded.
const RAMP = `linear-gradient(to right, black calc(100% - ${space.md}px), transparent)`;

interface FadeTextProps {
	color: string;
	accessibilityLabel?: string;
	style?: StyleProp<TextStyle>;
	children: ReactNode;
}

/**
 * The waiting fact's text on a card (#339): one line that never wraps, and
 * fades toward the card's right edge instead of being cut.
 */
export function FadeText({
	color,
	accessibilityLabel,
	style,
	children,
}: FadeTextProps) {
	const oneLine = {
		overflow: "hidden",
		whiteSpace: "nowrap",
		maskImage: RAMP,
		WebkitMaskImage: RAMP,
	} as const;

	return (
		<Text
			variant="labelMedium"
			accessibilityLabel={accessibilityLabel}
			style={[{ color, flexShrink: 1 }, style, oneLine]}
		>
			{children}
		</Text>
	);
}
