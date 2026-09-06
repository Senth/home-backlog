import { View } from "react-native";
import { Chip, Text } from "react-native-paper";
import { useAppTheme } from "@/theme";
import { outlinedTouchTarget, space } from "@/theme/tokens";

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
 * **A wrapping row of chips, deliberately not `SegmentedButtons`.** Segments
 * divide the width evenly and ellipsize whatever does not fit, and these labels
 * are words rather than icons: at 390px the five effort segments came out as
 * *Und… · Und… · An … · A w… · Sev…*, where the first two are "Under 30 min" and
 * "Under 2 hrs" rendered as the same string. `sv-SE` clipped "Brådskande" to
 * "Bråds…" on the four-value priority row as well. A control that hides the
 * words defeats the reason these values are words: `PROJECT.md` chose "an
 * evening" over "< 2 h" because a math symbol is not what a 71-year-old at 200%
 * text can read, and an ellipsis is worse than either.
 *
 * Chips wrap instead of shrinking, so every label stays whole at every width and
 * text size, and the row simply gets taller. Each chip also grows to share its
 * line out, so every line runs flush to the field's edge — a chip left
 * content-sized on a part-full line can land its right edge a pixel or two
 * from the line below's, which reads as a ragged column edge (claim 26).
 *
 * **Tapping the selected value clears it.** Neither field has a "none" chip,
 * because a chip that means "not set" is indistinguishable from the absence of a
 * selection — and there has to be a way back to unset, or a value people set
 * once is a value they learn not to set at all.
 *
 * Filled against outlined rather than Paper's `selected` tint alone: the tint is
 * a slightly different shade of the same green, which is the trap the column
 * strip already documents. Words and weight, never color on its own — on a
 * curated board a priority is one member's judgement of another member's
 * Saturday.
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
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
				{values.map((candidate) => {
					const selected = candidate === value;

					return (
						<Chip
							key={candidate}
							mode={selected ? "flat" : "outlined"}
							selected={selected}
							showSelectedCheck={false}
							onPress={() => onChange(selected ? null : candidate)}
							// `aria-pressed`, not `accessibilityState`: React Native Web
							// 0.21 does not forward the object form, so the selected chip
							// reached the DOM as a plain button and a screen reader could
							// not tell which priority was set. Paper renders a `<button>`,
							// where a toggle's state is `aria-pressed` rather than
							// `aria-selected`.
							aria-pressed={selected}
							// Paper's chip is 32dp tall, which nothing tappable may be. The
							// style lands on the outer surface and the pressable inside
							// stretches to fill it — minus the chip's own border, which is
							// why this is `outlinedTouchTarget` and not `touchTarget`.
							style={{
								minHeight: outlinedTouchTarget,
								flexGrow: 1,
							}}
						>
							{labelFor(candidate)}
						</Chip>
					);
				})}
			</View>
		</View>
	);
}
