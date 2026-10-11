import type { ReactNode } from "react";
import { useWindowDimensions, View } from "react-native";
import { Text, TouchableRipple } from "react-native-paper";
import { rowLeadStyle } from "@/components/ui/row-lead-style";
import { useAppTheme } from "@/theme";
import { denseBreakpoint, space, touchTarget } from "@/theme/tokens";

interface RowProps {
	title: string;
	description?: string;
	left?: ReactNode;
	/** Controls that belong to this row — a menu, a withdraw button, a chip. */
	right?: ReactNode;
	onPress?: () => void;
	testID?: string;
}

/**
 * A list row that carries its own controls, and deliberately **not** Paper's
 * `List.Item`.
 *
 * `List.Item` renders its row as a `TouchableRipple`, and
 * `TouchableRipple.tsx` computes `disabled = disabledProp || !hasPassedTouchHandler`
 * — so a row with no `onPress` is a *disabled* pressable, and React Native Web
 * writes `aria-disabled="true"` on it. Everything nested inside then inherits
 * that: a screen reader announces the overflow menu and the withdraw button as
 * disabled, and automation refuses to click them, on rows whose whole purpose is
 * the controls they contain.
 *
 * Tappable rows use a ripple on the lead only, never around the controls.
 *
 * Names wrap between words before controls move to another line. On web the
 * lead's min-content width keeps its longest word whole.
 */
export function Row({
	title,
	description,
	left,
	right,
	onPress,
	testID,
}: RowProps) {
	const theme = useAppTheme();
	const dense = useWindowDimensions().width < denseBreakpoint;
	const Lead = onPress ? TouchableRipple : View;

	return (
		<View
			testID={testID}
			style={{
				flexDirection: "row",
				flexWrap: "wrap",
				alignItems: "center",
				gap: space.md,
				rowGap: dense ? space.sm : space.md,
				minHeight: touchTarget,
				paddingVertical: dense ? space.xs : space.sm,
				paddingHorizontal: dense ? space.sm : space.md,
			}}
		>
			<Lead
				onPress={onPress}
				accessibilityRole={onPress ? "button" : undefined}
				style={[
					{
						flexDirection: "row",
						alignItems: "center",
						gap: space.md,
						flexGrow: 1,
						flexShrink: 1,
						minHeight: onPress ? touchTarget : undefined,
					},
					rowLeadStyle,
				]}
			>
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						gap: space.md,
						flexGrow: 1,
						flexShrink: 1,
					}}
				>
					{left}
					<View style={{ flexShrink: 1, minWidth: touchTarget }}>
						<Text variant="bodyLarge">{title}</Text>
						{description ? (
							<Text
								variant="bodyMedium"
								style={{ color: theme.colors.onSurfaceVariant }}
							>
								{description}
							</Text>
						) : null}
					</View>
				</View>
			</Lead>
			{right}
		</View>
	);
}
