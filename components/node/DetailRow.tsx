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
 * The value slot shrinks, so at 200 % text a long value wraps instead of
 * overlapping its name; the chevron is the last thing to give way, not the
 * first.
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
						}}
					>
						{value === undefined ? null : (
							<View style={{ flexShrink: 1 }}>{value}</View>
						)}
						<PaperIcon
							name="chevron-right"
							size={icon.md}
							color={theme.colors.onSurfaceVariant}
						/>
					</View>
				}
			/>
		</Pressable>
	);
}
