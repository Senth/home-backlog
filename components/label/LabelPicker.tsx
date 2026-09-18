import { router } from "expo-router";
import { type RefObject, useState } from "react";
import { useTranslation } from "react-i18next";
import type { View } from "react-native";
import { Button, HelperText } from "react-native-paper";
import { LabelGlyph } from "@/components/label/LabelGlyph";
import {
	type CheckItem,
	CheckListPicker,
} from "@/components/ui/CheckListPicker";
import { applyLabel, removeLabel } from "@/data/nodes";
import { type LabelWithId, maxLabelsPerNode } from "@/models/label";
import type { Node } from "@/models/node";
import { touchTarget } from "@/theme/tokens";

interface LabelPickerProps {
	homeId: string;
	/** The home's label definitions, read off the screen's own `activeHome`. */
	labels: readonly LabelWithId[];
	/** The card whose own labels are edited — inherited ones are not in here. */
	node: Node;
	onDismiss: () => void;
	testID: string;
	returnFocusTo?: RefObject<View | null>;
}

/**
 * Putting labels on a card, and taking them off — the same picker from the
 * card menu and the details screen, in the sheet the plan's decision chose.
 *
 * The search-and-check body is the shared `CheckListPicker`; what lives here
 * is the label rule set. The rows are the home's definitions, handed in by
 * the screen: the picker renders inside a portal (#237's sheets, and
 * `AppDialog` before it), above which the home context does not reach. A tap
 * writes through `applyLabel` / `removeLabel`, whose `arrayUnion` /
 * `arrayRemove` transforms are server-side and commute — so the row's mark
 * follows the card's listener rather than local state, and two people picking
 * at once cannot disagree about what is on the card: neither write carries a
 * snapshot the other could clobber. The controlled selection hands the picker
 * the card's own ids and turns its toggles back into those writes; *Clear*
 * empties the card the same way, one `removeLabel` per label.
 *
 * The cap is the gutter's (#100), and it stays here because it is a label
 * rule, not a picker rule: at six, the rows still offered are disabled and
 * the sentence under the list says why. Removing is always possible — a full
 * card must be able to make room.
 */
export function LabelPicker({
	homeId,
	labels,
	node,
	onDismiss,
	testID,
	returnFocusTo,
}: LabelPickerProps) {
	const { t } = useTranslation();
	const [failed, setFailed] = useState(false);

	const atCap = node.labelIds.length >= maxLabelsPerNode;

	const items: CheckItem[] = labels.map((label) => ({
		id: label.id,
		title: label.title,
		left: <LabelGlyph color={label.color} icon={label.icon} />,
	}));

	/**
	 * The picker's toggles land here as the selection they produce, and this
	 * turns the difference into the transforms — one press is one label, so
	 * the delta is one write, and *Clear* is one write per applied label.
	 */
	const writeSelection = (next: readonly string[]) => {
		const added = next.filter((id) => !node.labelIds.includes(id));
		const removed = node.labelIds.filter((id) => !next.includes(id));
		const writes = [
			...added.map((id) => applyLabel(homeId, node.id, id)),
			...removed.map((id) => removeLabel(homeId, node.id, id)),
		];
		for (const write of writes) {
			write.catch((reason) => {
				console.error("Could not change the card's labels:", reason);
				setFailed(true);
			});
		}
	};

	return (
		<CheckListPicker
			onDismiss={onDismiss}
			testID={testID}
			returnFocusTo={returnFocusTo}
			title={t("labels.title")}
			headerAction={
				<Button
					mode="text"
					icon="plus"
					onPress={() => {
						onDismiss();
						router.push(`/homes/${homeId}/labels`);
					}}
					contentStyle={{ minHeight: touchTarget }}
				>
					{t("labels.newLabel")}
				</Button>
			}
			searchLabel={t("labels.searchPlaceholder")}
			items={items}
			value={node.labelIds}
			onChange={writeSelection}
			disabled={(item) => !node.labelIds.includes(item.id) && atCap}
			emptySentence={t("labels.empty")}
			searchEmptySentence={t("labels.searchEmpty")}
			note={
				<>
					{/* Reserved slots — each sentence appears in a space the layout has
				    already paid for. Paper hides a hidden helper at opacity 0 but
				    leaves it in the accessibility tree, so while a slot holds nothing
				    it is hidden from assistive tech too. */}
					<HelperText
						type="info"
						visible={atCap}
						testID="label-picker-cap"
						accessibilityElementsHidden={!atCap}
						importantForAccessibility={atCap ? "auto" : "no-hide-descendants"}
					>
						{t("labels.capReached", { count: maxLabelsPerNode })}
					</HelperText>
					<HelperText
						type="error"
						visible={failed}
						accessibilityElementsHidden={!failed}
						importantForAccessibility={failed ? "auto" : "no-hide-descendants"}
					>
						{t("error.saveFailed")}
					</HelperText>
				</>
			}
		/>
	);
}
