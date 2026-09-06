import type { ReactNode } from "react";
import { View } from "react-native";
import { Icon, Text } from "react-native-paper";
import { useAppTheme } from "@/theme";
import { border, icon, radius, space } from "@/theme/tokens";

interface MetaChipProps {
	children: ReactNode;
	/** A Material Community icon name, for the chips that need one. */
	source?: string;
	/** Overrides the label color — the warning color, on an overdue card. */
	color?: string;
	/**
	 * What a screen reader hears instead of the label. For a chip whose text is
	 * a glyph-shaped shorthand — `3/8` is read out as two numbers and a slash —
	 * the way the card face's own steps mark already does it.
	 */
	accessibilityLabel?: string;
}

/**
 * An outlined pill that says something, and is **not** a control.
 *
 * Deliberately not Paper's `Chip`, for the same reason `Row` is not
 * `List.Item`: `Chip` renders through `TouchableRipple`, which computes
 * `disabled = disabledProp || !hasPassedTouchHandler` — so a chip with no
 * `onPress` is a *disabled pressable*, and React Native Web writes
 * `aria-disabled="true"` on it. A screen reader then announces the priority on
 * every card as "High, dimmed", and automation refuses to click through it.
 *
 * Chips that really are tappable — the column strip — keep Paper's `Chip`,
 * where the ripple has a handler and none of this applies.
 */
export function MetaChip({
	children,
	source,
	color,
	accessibilityLabel,
}: MetaChipProps) {
	const theme = useAppTheme();

	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: space.xs,
				borderWidth: border.hairline,
				borderColor: theme.colors.outline,
				borderRadius: radius.sm,
				paddingHorizontal: space.sm,
				// The label's line height sets the height. A chip is a word about the
				// card, not a control with a target to hit, and vertical padding on it
				// only pushed the title's own row further apart.
				paddingVertical: space.none,
			}}
		>
			{source === undefined ? null : (
				<Icon
					source={source}
					size={icon.sm}
					color={color ?? theme.colors.onSurfaceVariant}
				/>
			)}
			<Text
				variant="labelMedium"
				accessibilityLabel={accessibilityLabel}
				style={{ color: color ?? theme.colors.onSurfaceVariant }}
			>
				{children}
			</Text>
		</View>
	);
}
