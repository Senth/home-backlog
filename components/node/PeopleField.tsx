import { View } from "react-native";
import { Checkbox, Text } from "react-native-paper";
import type { Member } from "@/models/home";
import { useAppTheme } from "@/theme";
import { space, touchTarget } from "@/theme/tokens";

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
 * Paper's `Checkbox.Item` is the whole row, so the name is part of the target
 * rather than a label beside it — which at 200 % text is the difference between
 * a control and a puzzle. Its own height is under the 48dp minimum, so it is
 * given one.
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

					return (
						// `Checkbox.Item` writes `role="checkbox"` and the checked state
						// onto the row itself, from `status` — so there is nothing to add
						// here, and adding it would be a second source for one fact.
						<Checkbox.Item
							key={member.uid}
							label={member.displayName || unknownLabel}
							position="leading"
							status={checked ? "checked" : "unchecked"}
							onPress={() => toggle(member.uid)}
							style={{ minHeight: touchTarget, paddingLeft: space.none }}
						/>
					);
				})}
			</View>
		</View>
	);
}
