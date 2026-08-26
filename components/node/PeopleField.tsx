import { View } from "react-native";
import { Text } from "react-native-paper";
import { CheckRow } from "@/components/ui/CheckRow";
import type { Member } from "@/models/home";
import { useAppTheme } from "@/theme";
import { space } from "@/theme/tokens";

interface PeopleFieldProps {
	label: string;
	members: readonly Member[];
	/** The uids that are ticked. */
	value: readonly string[];
	onChange: (uids: string[]) => void;
	/** What to call somebody with no profile yet — `members.unknown`. */
	unknownLabel: string;
	/**
	 * One person who cannot be unticked here, with the reason written under the
	 * list. That is you, on a private project: `allow update` requires
	 * `visibleToMe(request.resource.data)`, so the rules refuse the write — and a
	 * checkbox that silently refuses is the failure this component's own doc
	 * comment is about.
	 */
	lockedUid?: string;
	lockedHint?: string;
	/** The whole field, when the write it makes needs a connection. */
	disabled?: boolean;
	/** Why it is disabled. Never a greyed control with nothing to say. */
	disabledHint?: string;
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
	lockedUid,
	lockedHint,
	disabled = false,
	disabledHint,
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
					const locked = member.uid === lockedUid;

					return (
						<CheckRow
							key={member.uid}
							label={member.displayName || unknownLabel}
							checked={value.includes(member.uid)}
							onPress={() => toggle(member.uid)}
							disabled={disabled || locked}
						/>
					);
				})}
			</View>

			{/* A greyed row always says why, the way the members list does with its
			    last-admin note. A control that refuses without a reason teaches
			    nothing. */}
			{disabled && disabledHint !== undefined ? (
				<Hint>{disabledHint}</Hint>
			) : null}
			{!disabled &&
			lockedUid !== undefined &&
			lockedHint !== undefined &&
			members.some((member) => member.uid === lockedUid) ? (
				<Hint>{lockedHint}</Hint>
			) : null}
		</View>
	);
}

function Hint({ children }: { children: string }) {
	const theme = useAppTheme();

	return (
		<Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
			{children}
		</Text>
	);
}
