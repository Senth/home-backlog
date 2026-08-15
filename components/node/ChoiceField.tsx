import { View } from "react-native";
import { SegmentedButtons, Text } from "react-native-paper";
import { useAppTheme } from "@/theme";
import { segmentedLabelLineHeight, space } from "@/theme/tokens";

interface ChoiceFieldProps<T extends string> {
	label: string;
	/** `null` is "not set", which is what every card starts as. */
	value: T | null;
	values: readonly T[];
	labelFor: (value: T) => string;
	onChange: (value: T | null) => void;
}

/**
 * One of a short list of values, or none — priority and effort, which are the
 * same control twice.
 *
 * **Tapping the selected value clears it.** Neither field has a "none" segment,
 * because a row that reads *None · Low · Normal · High · Urgent* spends its first
 * and widest slot on the value every card already has, and on a phone that is
 * what pushes the real answers off the edge. There is no other way back to
 * unset, and a value you cannot remove is a value you learn not to set.
 *
 * Outlined segments with words, never colour: on a curated board a priority is
 * one member's judgement of another member's Saturday, and four red chips on the
 * outdoor cards is `PERSONAS.md`'s stated quit line rendered as UI.
 */
export function ChoiceField<T extends string>({
	label,
	value,
	values,
	labelFor,
	onChange,
}: ChoiceFieldProps<T>) {
	const theme = useAppTheme();

	return (
		<View style={{ gap: space.sm }}>
			<Text
				variant="labelLarge"
				style={{ color: theme.colors.onSurfaceVariant }}
			>
				{label}
			</Text>
			<SegmentedButtons
				// Paper's `value` is a bare string, so "nothing selected" is a value
				// that cannot match any segment rather than a mode of its own.
				value={value ?? ""}
				onValueChange={(next) => onChange(next === value ? null : (next as T))}
				buttons={values.map((candidate) => ({
					value: candidate,
					label: labelFor(candidate),
					// The only way to make a segment meet the 48dp target: Paper
					// hard-codes `paddingVertical: 9` on the content and exposes no prop
					// that reaches the pressable, so growing the label is what grows the
					// ripple. 9 + 30 + 9 = 48.
					labelStyle: { lineHeight: segmentedLabelLineHeight },
				}))}
			/>
		</View>
	);
}
