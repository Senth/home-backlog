import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, useWindowDimensions, View } from "react-native";
import {
	Button,
	HelperText,
	SegmentedButtons,
	Text,
	TextInput,
} from "react-native-paper";
import { AppDialog } from "@/components/ui/AppDialog";
import type { Member } from "@/models/home";
import {
	type Card,
	type CardCondition,
	type CardScope,
	importCard,
} from "@/models/overview-cards";
import { useAppTheme } from "@/theme";
import { segmentedLabelLineHeight, space, touchTarget } from "@/theme/tokens";

/**
 * Import a card someone shared as text: paste the string, see what it says,
 * choose where it lives, add it. The decode is the model's own `importCard`,
 * so an invalid string is one plain sentence — never a stack trace — and the
 * preview is the card the Add will actually create, as the importer's own.
 *
 * A member reference the home does not have simply matches nothing until the
 * card is edited; the preview names such a member by uid, which is exactly
 * what the editor's people chips will do to it.
 */

interface ImportCardDialogProps {
	visible: boolean;
	/** The home's members, for naming the two people fields in the preview. */
	members: readonly Member[];
	onDismiss: () => void;
	onAdd: (draft: Omit<Card, "id" | "rank">, scope: CardScope) => void;
}

export function ImportCardDialog({
	visible,
	members,
	onDismiss,
	onAdd,
}: ImportCardDialogProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const { height } = useWindowDimensions();

	const [pasted, setPasted] = useState("");
	const [scope, setScope] = useState<CardScope>("global");

	// Reset when the dialog *opens*, during render, the way CardEditSheet does.
	const [opened, setOpened] = useState(visible);
	if (opened !== visible) {
		setOpened(visible);
		if (visible) {
			setPasted("");
			setScope("global");
		}
	}

	const decoded = importCard(pasted);
	const invalid = pasted.trim() !== "" && decoded === null;

	const add = () => {
		if (decoded === null) return;
		onAdd(decoded, scope);
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

					<SegmentedButtons
						value={scope}
						onValueChange={(value) => setScope(value as CardScope)}
						buttons={[
							{
								value: "global",
								label: t("overview.cards.editor.scope.global"),
								labelStyle: { lineHeight: segmentedLabelLineHeight },
							},
							{
								value: "home",
								label: t("overview.cards.editor.scope.home"),
								labelStyle: { lineHeight: segmentedLabelLineHeight },
							},
							{
								value: "shared",
								label: t("overview.cards.editor.scope.shared"),
								labelStyle: { lineHeight: segmentedLabelLineHeight },
							},
						]}
					/>

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
									{conditionLine(condition, members, t)}
								</Text>
							))}
						</View>
					)}
				</View>
			</ScrollView>
		</AppDialog>
	);
}

/** `t` as this module's helper sees it — the hook's own return. */
type Translate = ReturnType<typeof useTranslation>["t"];

const join = (values: readonly string[]) => values.join(" · ");
const is = (value: string | boolean, yes: string, no: string) =>
	value ? yes : no;

/**
 * One condition in plain words, reusing the edit sheet's own vocabulary: the
 * field named once, then its values. A value this app cannot name — a member
 * the string names by uid, a status from a newer version — prints as what it
 * is, so the words still tell the reader there is something to edit.
 */
function conditionLine(
	condition: CardCondition,
	members: readonly Member[],
	t: Translate,
): string {
	const nameOf = (uid: string) =>
		uid === "me"
			? t("overview.cards.field.me")
			: uid === "none"
				? t("overview.cards.field.unassigned")
				: (members.find((member) => member.uid === uid)?.displayName ?? uid);

	switch (condition.field) {
		case "status":
			return `${t("overview.cards.field.status")}: ${join(
				condition.anyOf.map((value) => t(`status.${value}`)),
			)}`;
		case "priority":
			return `${t("detail.priority")}: ${join(
				condition.anyOf.map((value) =>
					value === "none"
						? t("overview.cards.field.notSet")
						: t(`priority.${value}`),
				),
			)}`;
		case "effort":
			return `${t("detail.effort")}: ${join(
				condition.anyOf.map((value) =>
					value === "none"
						? t("overview.cards.field.notSet")
						: t(`effort.${value}`),
				),
			)}`;
		case "dueDate":
			return `${t("detail.dueDate")}: ${t(`overview.cards.due.${condition.is}`)}`;
		case "isRoot":
			return `${t("overview.cards.field.root")}: ${is(
				condition.is,
				t("overview.cards.field.isProject"),
				t("overview.cards.field.isStep"),
			)}`;
		case "hasChildren":
			return `${t("detail.steps")}: ${is(
				condition.is,
				t("overview.cards.field.withSteps"),
				t("overview.cards.field.noSteps"),
			)}`;
		case "assigneeIds":
			return `${t("detail.assignees")}: ${join(condition.anyOf.map(nameOf))}`;
		case "participantIds":
			return `${t("detail.participants")}: ${join(condition.anyOf.map(nameOf))}`;
		case "blockedBy":
			return `${t("board.blocked")}: ${t(
				condition.is === "any"
					? "overview.cards.field.waiting"
					: "overview.cards.field.notWaiting",
			)}`;
		case "locationId":
			return `${t("overview.cards.field.location")}: ${t(
				condition.is === "any"
					? "overview.cards.field.hasLocation"
					: "overview.cards.field.noLocation",
			)}`;
		case "visibility":
			return `${t("overview.cards.field.visibility")}: ${t(
				`overview.cards.field.${condition.is}`,
			)}`;
		case "createdVia":
			return `${t("overview.cards.field.createdVia")}: ${t(
				condition.is === "app"
					? "overview.cards.field.inApp"
					: "detail.createdViaApi",
			)}`;
		case "notes":
			return `${t("detail.notes")}: ${is(
				condition.is,
				t("overview.cards.field.withNotes"),
				t("overview.cards.field.noNotes"),
			)}`;
		case "photos":
			return `${t("overview.cards.field.photos")}: ${is(
				condition.is,
				t("overview.cards.field.withPhotos"),
				t("overview.cards.field.noPhotos"),
			)}`;
		case "checklist":
			return `${t("overview.cards.field.checklist")}: ${is(
				condition.is,
				t("overview.cards.field.withChecklist"),
				t("overview.cards.field.noChecklist"),
			)}`;
	}
}
