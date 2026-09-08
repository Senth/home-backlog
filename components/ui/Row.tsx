import type { ReactNode } from "react";
import { View } from "react-native";
import { Text } from "react-native-paper";
import { useAppTheme } from "@/theme";
import { space, touchTarget } from "@/theme/tokens";

interface RowProps {
	title: string;
	description?: string;
	left?: ReactNode;
	/** Controls that belong to this row — a menu, a withdraw button, a chip. */
	right?: ReactNode;
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
 * Rows that *are* tappable — the homes list — keep `List.Item`, where the ripple
 * has a handler and none of this applies.
 *
 * The row wraps before it shrinks (`docs/DESIGN.md`'s overflow rule for rows of
 * controls): at 200 % text a row has genuinely more content than fits on one
 * line, so the value takes a line of its own rather than shrinking to nothing —
 * the same escape that fixed `ColumnBar` (#237).
 */
export function Row({ title, description, left, right }: RowProps) {
	const theme = useAppTheme();

	return (
		<View
			style={{
				flexDirection: "row",
				flexWrap: "wrap",
				alignItems: "center",
				gap: space.md,
				minHeight: touchTarget,
				paddingVertical: space.sm,
				paddingHorizontal: space.md,
			}}
		>
			{/* `left` and the title are one flex item, so a wrapped line takes
			    the icon with the name instead of stranding the glyph alone on
			    the line above it (#237). flexGrow with an auto basis, not
			    `flex: 1`: a zero basis is weight zero in the shrink phase, so at
			    200 % text the title yielded the whole row to the value and
			    collapsed to nothing. */}
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: space.md,
					flexGrow: 1,
					flexShrink: 1,
					flexBasis: "auto",
				}}
			>
				{left}
				{/* `touchTarget` keeps a floor under the shortest names, which
				    shrink by size and so lose the most. */}
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
			{right}
		</View>
	);
}
