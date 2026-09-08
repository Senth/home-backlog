import { router } from "expo-router";
import { type RefObject, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button, HelperText, Text, TextInput } from "react-native-paper";
import { LabelGlyph } from "@/components/label/LabelGlyph";
import { AppSheet } from "@/components/ui/AppSheet";
import { CheckRow } from "@/components/ui/CheckRow";
import { applyLabel, removeLabel } from "@/data/nodes";
import { type LabelWithId, maxLabelsPerNode } from "@/models/label";
import type { Node } from "@/models/node";
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
 * The title case-folds away diacritics as well as case, so `Trädgård` is
 * found from `trad` — the picker is searched by thumbs that do not compose
 * å on an English keyboard.
 */
function foldTitle(title: string): string {
	return title
		.toLowerCase()
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "");
}

/**
 * Putting labels on a card, and taking them off — the same picker from the
 * card menu and the details screen, in the sheet the plan's decision chose.
 *
 * The rows are the home's definitions, handed in by the screen: the picker
 * renders inside a portal (#237's sheets, and `AppDialog` before it), above
 * which the home context does not reach. A tap writes through `applyLabel` /
 * `removeLabel`, whose `arrayUnion` / `arrayRemove` transforms are server-side and commute — so
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
	const [failed, setFailed] = useState(false);
	const [text, setText] = useState("");

	const atCap = node.labelIds.length >= maxLabelsPerNode;
	const needle = foldTitle(text.trim());
	const visible = labels.filter((label) =>
		foldTitle(label.title).includes(needle),
	);

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
		<AppSheet
			visible
			onDismiss={onDismiss}
			testID={testID}
			returnFocusTo={returnFocusTo}
		>
			<View style={{ gap: space.md }}>
				<View style={{ flexDirection: "row", alignItems: "center" }}>
					<Text variant="titleMedium" style={{ flex: 1 }}>
						{t("labels.title")}
					</Text>
					{/* The labels screen is where the set is curated; the picker is
					    where it is spent. Navigation is dismissal's work, so the sheet
					    goes with the tap. */}
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
				</View>

				<TextInput
					mode="flat"
					label={t("labels.searchPlaceholder")}
					value={text}
					onChangeText={setText}
					left={<TextInput.Icon icon="magnify" />}
					testID={`${testID}-search`}
					autoFocus
				/>

				<View style={{ gap: space.xs }}>
					{labels.length === 0 ? (
						<Text variant="bodyMedium">{t("labels.empty")}</Text>
					) : null}

					{visible.map((label) => {
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
				</View>

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
		</AppSheet>
	);
}
