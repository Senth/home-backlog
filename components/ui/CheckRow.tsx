import type { ReactNode } from "react";
import { View } from "react-native";
import { Icon, Text, TouchableRipple } from "react-native-paper";
import { useAppTheme } from "@/theme";
import { icon, space, touchTarget } from "@/theme/tokens";

interface CheckRowProps {
	label: string;
	checked: boolean;
	onPress: () => void;
	disabled?: boolean;
	/**
	 * A mark of identity ahead of the checkbox — the label glyph in the label
	 * picker's rows. Absent for a plain tickable row.
	 */
	left?: ReactNode;
	/** State behind the label — the *Done* chip on a picked blocker's row. */
	right?: ReactNode;
}

/**
 * One tickable row: a mark, a label, and the checkbox semantics on the row
 * itself.
 *
 * Deliberately not Paper's `Checkbox.Item`. Its inner checkbox is handed no
 * `onPress`, so React Native Web announces the row twice, the second time as
 * dimmed. The mark is a plain `Icon` and the row carries the role.
 *
 * `aria-checked`, not `accessibilityState`. React Native Web 0.21 dropped the
 * object form — it is not in its forwarded props at all, so it reaches the DOM
 * as nothing and the row announces as an unchecked checkbox for ever. React
 * Native itself accepts the ARIA prop too, so this is not web-only.
 */
export function CheckRow({
	label,
	checked,
	onPress,
	disabled,
	left,
	right,
}: CheckRowProps) {
	const theme = useAppTheme();

	return (
		<TouchableRipple
			onPress={onPress}
			disabled={disabled}
			accessibilityRole="checkbox"
			aria-checked={checked}
			accessibilityLabel={label}
			style={{ minHeight: touchTarget, justifyContent: "center" }}
		>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: space.md,
					paddingVertical: space.sm,
				}}
			>
				{left}
				<Icon
					source={checked ? "checkbox-marked" : "checkbox-blank-outline"}
					size={icon.md}
					color={
						disabled
							? theme.colors.onSurfaceDisabled
							: checked
								? theme.colors.primary
								: theme.colors.onSurfaceVariant
					}
				/>
				<Text
					variant="bodyLarge"
					style={{
						flexShrink: 1,
						color: disabled
							? theme.colors.onSurfaceDisabled
							: theme.colors.onSurface,
					}}
				>
					{label}
				</Text>
				{right}
			</View>
		</TouchableRipple>
	);
}
