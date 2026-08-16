import { View } from "react-native";
import { Icon, Text, TouchableRipple } from "react-native-paper";
import type { Member } from "@/models/home";
import { useAppTheme } from "@/theme";
import { icon, space, touchTarget } from "@/theme/tokens";

interface PeopleFieldProps {
	label: string;
	members: readonly Member[];
	/** The uids that are ticked. */
	value: readonly string[];
	onChange: (uids: string[]) => void;
	/** What to call somebody with no profile yet — `members.unknown`. */
	unknownLabel: string;
}

/**
 * Which of the home's people a field names — participants on a project,
 * assignees on a card. The same control twice, the way priority and effort are.
 *
 * **Checkboxes, not chips.** These are people rather than one-of-a-scale values:
 * several are ticked at once, ticking one is not "instead of" the others, and a
 * row of green chips reads as a state machine. Every household that exists today
 * fits in a list of four; a search-and-add picker is #88's problem, and inventing
 * it now would be a screen nobody has needed yet.
 *
 * The whole row is the target, so the name is part of it rather than a label
 * beside it — at 200 % text that is the difference between a control and a
 * puzzle.
 *
 * **Deliberately not Paper's `Checkbox.Item`**, for the third time in this
 * codebase and for the reason `MetaChip` and `Row` both write down.
 * `Checkbox.Item` is a `TouchableRipple` wrapping a *second* `Checkbox`, and
 * that inner one is handed no `onPress` — so `TouchableRipple` computes
 * `disabled = disabledProp || !hasPassedTouchHandler` and React Native Web
 * writes `role="checkbox" aria-disabled="true"` on it. Paper hides it with
 * `importantForAccessibility`, which RNW does not translate to `aria-hidden`,
 * so every person in the list is announced twice, the second time as dimmed.
 * The mark here is a plain `Icon` and the semantics live on the row.
 */
export function PeopleField({
	label,
	members,
	value,
	onChange,
	unknownLabel,
}: PeopleFieldProps) {
	const theme = useAppTheme();

	const toggle = (uid: string) => {
		onChange(
			value.includes(uid)
				? value.filter((current) => current !== uid)
				: [...value, uid],
		);
	};

	return (
		<View style={{ gap: space.sm }}>
			<Text
				variant="labelLarge"
				style={{ color: theme.colors.onSurfaceVariant }}
			>
				{label}
			</Text>
			<View>
				{members.map((member) => {
					const checked = value.includes(member.uid);
					const name = member.displayName || unknownLabel;

					return (
						<TouchableRipple
							key={member.uid}
							onPress={() => toggle(member.uid)}
							accessibilityRole="checkbox"
							// `aria-checked`, not `accessibilityState`. React Native Web
							// 0.21 dropped the object form — it is not in its forwarded
							// props at all, so it reaches the DOM as nothing and the row
							// announces as an unchecked checkbox for ever. React Native
							// itself accepts the ARIA prop too, so this is not web-only.
							aria-checked={checked}
							accessibilityLabel={name}
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
								<Icon
									source={
										checked ? "checkbox-marked" : "checkbox-blank-outline"
									}
									size={icon.md}
									color={
										checked
											? theme.colors.primary
											: theme.colors.onSurfaceVariant
									}
								/>
								<Text variant="bodyLarge" style={{ flexShrink: 1 }}>
									{name}
								</Text>
							</View>
						</TouchableRipple>
					);
				})}
			</View>
		</View>
	);
}
