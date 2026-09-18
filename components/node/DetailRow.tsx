import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { IconButton } from "react-native-paper";
import { PaperIcon } from "@/components/ui/PaperIcon";
import { Row } from "@/components/ui/Row";
import { useAppTheme } from "@/theme";
import { icon, space, touchTarget, touchTargetStyle } from "@/theme/tokens";

interface DetailRowProps {
	/** The leading glyph, always `onSurfaceVariant` and always neutral. */
	glyph: string;
	/** The field's name — what the row says first. */
	name: string;
	/**
	 * The value as the card holds it, on the right. It is why the row exists,
	 * so it sits where the eye lands and carries the colour a value owns.
	 */
	value?: ReactNode;
	onPress: () => void;
	/**
	 * Clears the value where it sits, without opening anything — the filter
	 * sheet's ✕ (Q8). The spoken label is the caller's, because only it knows
	 * what the value is called.
	 */
	onClear?: () => void;
	clearLabel?: string;
	testID?: string;
}

/**
 * One field of the card as a row (#237): leading icon, name, value, chevron —
 * the whole row opens the field's editor.
 *
 * Not Paper's `List.Item`, for the reason `Row` writes down. The row is a
 * `Pressable` — the pattern `NotesField`'s read mode uses, which always has a
 * handler and so never trips `TouchableRipple`'s handler-less
 * `aria-disabled` — wrapped around `Row`, which owns the layout: the same
 * paddings, the same `touchTarget` floor, one row implementation in the app.
 *
 * The ✕ sits **beside** the pressable, never inside it: the row is a real
 * `<button>` on the web (`accessibilityRole="button"`), and a button inside a
 * button is a console error the repo treats as a gate. The chevron rides
 * with it so a row's value, ✕ and chevron keep one order.
 *
 * At 200 % text the row has more content than one line holds, so `Row` wraps
 * and the value takes the line under the name at full width — a floor on the
 * value instead would only move the collapse into the chevron, the way the
 * name floor once moved it into the value (#237).
 */
export function DetailRow({
	glyph,
	name,
	value,
	onPress,
	onClear,
	clearLabel,
	testID,
}: DetailRowProps) {
	const theme = useAppTheme();

	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
			<Pressable
				accessibilityRole="button"
				onPress={onPress}
				testID={testID}
				style={{ minHeight: touchTarget, flex: 1 }}
			>
				<Row
					left={
						<PaperIcon
							name={glyph}
							size={icon.md}
							color={theme.colors.onSurfaceVariant}
						/>
					}
					title={name}
					right={
						<View
							style={{
								flexDirection: "row",
								alignItems: "center",
								justifyContent: "flex-end",
								gap: space.sm,
								flexShrink: 1,
								// When `Row` wraps the value onto a line of its own, the
								// auto margin keeps it right-aligned against the chevron
								// — the value stays where the eye lands in both layouts.
								marginLeft: "auto",
							}}
						>
							{value === undefined ? null : (
								<View style={{ flexShrink: 1 }}>{value}</View>
							)}
						</View>
					}
				/>
			</Pressable>
			{onClear === undefined ? null : (
				<IconButton
					icon="close"
					onPress={onClear}
					accessibilityLabel={clearLabel}
					// Paper's IconButton carries its own margin; the row
					// already owns the rhythm, the same reset `Stepper` makes.
					style={[touchTargetStyle, { margin: space.none }]}
				/>
			)}
			<PaperIcon
				name="chevron-right"
				size={icon.md}
				color={theme.colors.onSurfaceVariant}
				testID={testID === undefined ? undefined : `${testID}-chevron`}
			/>
		</View>
	);
}
