import { type RefObject, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button, HelperText, Text } from "react-native-paper";
import { LabelGlyph } from "@/components/label/LabelGlyph";
import { AppDialog } from "@/components/ui/AppDialog";
import { CheckRow } from "@/components/ui/CheckRow";
import { applyLabel, removeLabel } from "@/data/nodes";
import { type LabelWithId, maxLabelsPerNode } from "@/models/label";
import type { Node } from "@/models/node";
import { useAppTheme } from "@/theme";
import { space, touchTarget } from "@/theme/tokens";

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
 * card menu and the details screen.
 *
 * The rows are the home's definitions, handed in by the screen: the picker
 * renders inside a portal (#237's sheets, and `AppDialog` before it), above
 * which the home context does not reach. A tap writes through `applyLabel` / `removeLabel`, whose
 * `arrayUnion` / `arrayRemove` transforms are server-side and commute — so
 * the row's mark follows the card's listener rather than local state, and two
 * people picking at once cannot disagree about what is on the card: neither
 * write carries a snapshot the other could clobber.
 *
 * The cap is the gutter's (#100): at six, the rows still offered are disabled
 * and the sentence under the list says why. Removing is always possible — a
 * full card must be able to make room.
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
	const theme = useAppTheme();
	const [failed, setFailed] = useState(false);

	const atCap = node.labelIds.length >= maxLabelsPerNode;

	const toggle = (label: LabelWithId, applied: boolean) => {
		const write = applied
			? removeLabel(homeId, node.id, label.id)
			: applyLabel(homeId, node.id, label.id);
		write.catch((reason) => {
			console.error("Could not change the card's labels:", reason);
			setFailed(true);
		});
	};

	return (
		<AppDialog
			visible
			onDismiss={onDismiss}
			title={t("labels.pickerTitle")}
			testID={testID}
			returnFocusTo={returnFocusTo}
			actions={[
				<Button
					key="dismiss"
					onPress={onDismiss}
					textColor={theme.colors.onSurfaceVariant}
					contentStyle={{ minHeight: touchTarget }}
				>
					{t("common.dismiss")}
				</Button>,
			]}
		>
			<View style={{ gap: space.xs }}>
				{labels.length === 0 ? (
					<Text variant="bodyMedium">{t("labels.empty")}</Text>
				) : null}

				{labels.map((label) => {
					const applied = node.labelIds.includes(label.id);
					return (
						<CheckRow
							key={label.id}
							left={<LabelGlyph color={label.color} icon={label.icon} />}
							label={label.title}
							checked={applied}
							disabled={!applied && atCap}
							onPress={() => toggle(label, applied)}
						/>
					);
				})}

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
			</View>
		</AppDialog>
	);
}
