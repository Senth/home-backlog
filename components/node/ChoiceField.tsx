import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Text } from "react-native-paper";
import { useAppTheme } from "@/theme";
import { radius, space, touchTarget } from "@/theme/tokens";

interface ChoiceFieldProps<T extends string> {
	label: string;
	/** `null` is "not set", which is what every card starts as. */
	value: T | null;
	values: readonly T[];
	labelFor: (value: T) => string;
	onChange: (value: T | null) => void;
	/**
	 * A leading mark per row — the ramp dot priority draws and effort omits.
	 * The mark rides with the word, and a row without one stays flush left: no
	 * hanging indent for a mark that does not exist.
	 */
	adornment?: (value: T) => ReactNode;
}

/**
 * One of a short list of values, or none — priority and effort, which are the
 * same control twice.
 *
 * **A vertical list of full-width rows, deliberately not `SegmentedButtons`.**
 * Segments divide the width evenly and ellipsize whatever does not fit, and
 * these labels are words rather than icons: at 390px the five effort segments
 * came out as *Und… · Und… · An … · A w… · Sev…*, where the first two are
 * "Under 30 min" and "Under 2 hrs" rendered as the same string. `sv-SE` clipped
 * "Brådskande" to "Bråds…" too. A control that hides the words defeats the
 * reason these values are words: `PROJECT.md` chose "an evening" over "< 2 h"
 * because a math symbol is not what a 71-year-old at 200% text can read, and an
 * ellipsis is worse than either. The vertical list is where that reasoning
 * lands: a full-width row never truncates "Under 30 min" or "Brådskande", and
 * stacking the values is what lets the ordinal ones read top-to-bottom.
 *
 * **The selection is a full-width `secondaryContainer` fill with its words in
 * `onSecondaryContainer` at weight 500, not Paper's `selected` tint.** The tint
 * is a slightly different shade of the same green, which is the trap the column
 * strip already documents. Fill, words and weight — never color on its own: on
 * a curated board a priority is one member's judgement of another member's
 * Saturday.
 *
 * **Tapping the selected value clears it.** Neither field has a "none" row,
 * because a row that means "not set" is indistinguishable from the absence of a
 * selection — and there has to be a way back to unset, or a value people set
 * once is a value they learn not to set at all.
 */
export function ChoiceField<T extends string>({
	label,
	value,
	values,
	labelFor,
	onChange,
	adornment,
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
			<View style={{ gap: space.xs }}>
				{values.map((candidate) => {
					const selected = candidate === value;

					return (
						<Pressable
							key={candidate}
							accessibilityRole="button"
							onPress={() => onChange(selected ? null : candidate)}
							// `aria-pressed`, not `accessibilityState`: React Native Web
							// 0.21 does not forward the object form, so the selected row
							// would reach the DOM as a plain button and a screen reader
							// could not tell which priority was set.
							aria-pressed={selected}
							style={{
								minHeight: touchTarget,
								flexDirection: "row",
								alignItems: "center",
								gap: space.sm,
								paddingHorizontal: space.md,
								borderRadius: radius.sm,
								backgroundColor: selected
									? theme.colors.secondaryContainer
									: undefined,
							}}
						>
							{adornment === undefined ? null : adornment(candidate)}
							<Text
								variant="labelLarge"
								style={
									selected
										? {
												color: theme.colors.onSecondaryContainer,
												fontWeight: "500",
											}
										: undefined
								}
							>
								{labelFor(candidate)}
							</Text>
						</Pressable>
					);
				})}
			</View>
		</View>
	);
}
