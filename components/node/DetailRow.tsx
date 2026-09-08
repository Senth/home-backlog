import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { PaperIcon } from "@/components/ui/PaperIcon";
import { Row } from "@/components/ui/Row";
import { useAppTheme } from "@/theme";
import { icon, space, touchTarget } from "@/theme/tokens";

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
	testID,
}: DetailRowProps) {
	const theme = useAppTheme();

	return (
		<Pressable
			accessibilityRole="button"
			onPress={onPress}
			testID={testID}
			style={{ minHeight: touchTarget }}
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
						<PaperIcon
							name="chevron-right"
							size={icon.md}
							color={theme.colors.onSurfaceVariant}
							testID={testID === undefined ? undefined : `${testID}-chevron`}
						/>
					</View>
				}
			/>
		</Pressable>
	);
}
