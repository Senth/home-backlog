import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, useWindowDimensions, View } from "react-native";
import { Button, HelperText, Text, TextInput } from "react-native-paper";
import { fieldSpecs } from "@/components/overview/CardEditForm";
import { AppDialog } from "@/components/ui/AppDialog";
import type { CardCondition, CardMode } from "@/models/filter";
import type { Member } from "@/models/home";
import type { LabelWithId } from "@/models/label";
import type { Location } from "@/models/locations";
import { doneWithinDays } from "@/models/overview";
import { type Card, type CardScope, importCard } from "@/models/overview-cards";
import { useAppTheme } from "@/theme";
import { space, touchTarget } from "@/theme/tokens";

/**
 * Import a card someone shared as text: paste the string, see what it says,
 * add it. The card lands in All homes; moving it between scopes is the
 * editor's job, one open away from the snackbar. The decode is the model's
 * own `importCard`, so an invalid string is one plain sentence — never a
 * stack trace — and the preview is the card the Add will actually create,
 * as the importer's own.
 *
 * A member reference the home does not have simply matches nothing until the
 * card is edited; the preview names such a member by uid, which is exactly
 * what the editor's people chips will do to it.
 */

interface ImportCardDialogProps {
	visible: boolean;
	/** The home's members, for naming the two people fields in the preview. */
	members: readonly Member[];
	/** The home's locations, for naming the picked ones in the preview. */
	locations: readonly Location[];
	/** The home's labels, for naming the label condition in the preview. */
	labels: readonly LabelWithId[];
	onDismiss: () => void;
	onAdd: (draft: Omit<Card, "id" | "rank">, scope: CardScope) => void;
}

export function ImportCardDialog({
	visible,
	members,
	locations,
	labels,
	onDismiss,
	onAdd,
}: ImportCardDialogProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const { height } = useWindowDimensions();

	const [pasted, setPasted] = useState("");

	// Reset when the dialog *opens*, during render, the way CardEditForm does.
	const [opened, setOpened] = useState(visible);
	if (opened !== visible) {
		setOpened(visible);
		if (visible) setPasted("");
	}

	const decoded = importCard(pasted);
	const invalid = pasted.trim() !== "" && decoded === null;

	const add = () => {
		if (decoded === null) return;
		onAdd(decoded, "global");
		onDismiss();
	};

	return (
		<AppDialog
			visible={visible}
			onDismiss={onDismiss}
			title={t("overview.cards.editor.import")}
			testID="overview-card-import"
			actions={[
				<Button
					key="cancel"
					onPress={onDismiss}
					textColor={theme.colors.onSurfaceVariant}
					contentStyle={{ minHeight: touchTarget }}
				>
					{t("common.cancel")}
				</Button>,
				<Button
					key="add"
					onPress={add}
					mode="contained"
					disabled={decoded === null}
					contentStyle={{ minHeight: touchTarget }}
				>
					{t("overview.cards.editor.add")}
				</Button>,
			]}
		>
			<ScrollView style={{ maxHeight: height - space.xxl * 4 }}>
				<View style={{ gap: space.md }}>
					<View>
						<TextInput
							mode="outlined"
							label={t("overview.cards.editor.importPaste")}
							value={pasted}
							onChangeText={setPasted}
							multiline
							testID="overview-card-import-paste"
						/>
						<HelperText type="error" visible={invalid}>
							{t("overview.cards.editor.importInvalid")}
						</HelperText>
					</View>

					{decoded === null ? null : (
						<View
							style={{ gap: space.xs }}
							testID="overview-card-import-preview"
						>
							<Text variant="titleMedium">{decoded.title}</Text>
							{decoded.conditions.map((condition) => (
								<Text
									key={condition.field}
									variant="bodyMedium"
									style={{ color: theme.colors.onSurfaceVariant }}
								>
									{conditionLine(
										condition,
										decoded.kind,
										members,
										locations,
										labels,
										t,
									)}
								</Text>
							))}
						</View>
					)}
				</View>
			</ScrollView>
		</AppDialog>
	);
}

/**
 * One condition in plain words, read from the edit sheet's own vocabulary —
 * `fieldSpecs` is the one list of field and value labels, so the preview
 * says exactly what the chips would have said. A value this app cannot
 * name — a member the string names by uid, a status from a newer version —
 * prints as what it is, so the words still tell the reader there is
 * something to edit.
 */
function conditionLine(
	condition: CardCondition,
	mode: CardMode,
	members: readonly Member[],
	locations: readonly Location[],
	labels: readonly LabelWithId[],
	t: ReturnType<typeof useTranslation>["t"],
): string {
	const spec = fieldSpecs(members, locations, labels, t, mode).find(
		(each) => each.field === condition.field,
	);
	const label = spec?.label ?? condition.field;

	// The completed window names the whole line: "Klart inom 30 dagar" — the
	// count is the condition's own `n`, the seed window when it carries none.
	if (condition.field === "completedAt" && condition.is === "within") {
		return t("overview.cards.completedAtLine", {
			count: condition.n ?? doneWithinDays,
		});
	}

	// The picker form: one "in <location>" per picked id, named by title —
	// an id the home does not have prints as what it is, the rule member
	// references travel by.
	if (condition.field === "locationId" && "anyOf" in condition) {
		const picked = condition.anyOf.map((id) => {
			const title =
				spec?.extraValues?.find((each) => each.value === id)?.label ?? id;
			return t("overview.cards.field.inLocation", { location: title });
		});
		return `${label}: ${picked.join(" · ")}`;
	}

	if ("anyOf" in condition) {
		const values = condition.anyOf.map(
			(value) =>
				spec?.values.find((each) => each.value === value)?.label ?? value,
		);
		return `${label}: ${values.join(" · ")}`;
	}

	const value =
		spec?.values.find((each) => each.value === condition.is)?.label ??
		String(condition.is);
	const within =
		condition.field === "dueDate" &&
		condition.is === "comingUp" &&
		condition.n !== undefined
			? ` ${t("overview.cards.due.comingUpWithin", { count: condition.n })}`
			: "";
	return `${label}: ${value}${within}`;
}
