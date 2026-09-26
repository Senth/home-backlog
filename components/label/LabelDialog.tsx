import type { RefObject } from "react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import {
	Button,
	HelperText,
	Portal,
	Text,
	TextInput,
} from "react-native-paper";
import { ColorSwatches } from "@/components/label/ColorSwatches";
import { IconPicker } from "@/components/label/IconPicker";
import { IconQuickPicks } from "@/components/label/IconQuickPicks";
import { AppDialog, ConfirmDialog } from "@/components/ui/AppDialog";
import { useHome } from "@/contexts/HomeContext";
import {
	createLabel,
	deleteLabel,
	recolorLabel,
	reiconLabel,
	renameLabel,
} from "@/data/homes";
import {
	defaultLabelIcon,
	type LabelTitleError,
	type LabelWithId,
	labelError,
	labelIconPicks,
} from "@/models/label";
import { rankAtEnd } from "@/models/node";
import { defaultLabelHue, useAppTheme } from "@/theme";
import { space, touchTarget } from "@/theme/tokens";

interface LabelDialogProps {
	homeId: string;
	/** The label being edited, or `null` on the create path. */
	label: LabelWithId | null;
	onDismiss: () => void;
	/** A queued write was refused — the dialog has already closed. */
	onError: () => void;
	testID: string;
	returnFocusTo?: RefObject<View | null>;
}

export function LabelDialog({
	homeId,
	label,
	onDismiss,
	onError,
	testID,
	returnFocusTo,
}: LabelDialogProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const { homes } = useHome();

	const [title, setTitle] = useState(label?.title ?? "");
	const [icon, setIcon] = useState(label?.icon ?? defaultLabelIcon);
	const [color, setColor] = useState(label?.color ?? defaultLabelHue);
	const [titleProblem, setTitleProblem] = useState<LabelTitleError | null>(
		null,
	);
	const [pickingIcon, setPickingIcon] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const deleteAnchor = useRef<View | null>(null);

	const labels = homes.find((home) => home.id === homeId)?.labels ?? [];

	const save = () => {
		const problem = labelError(title, labels, label?.id ?? null);
		if (problem !== null) {
			setTitleProblem(problem);
			return;
		}

		onDismiss();
		if (label === null) {
			createLabel(homeId, {
				title,
				icon,
				color,
				rank: rankAtEnd(labels.at(-1)?.rank ?? null),
			}).catch((reason) => {
				console.error("Could not create the label:", reason);
				onError();
			});
			return;
		}

		// Only what changed — two members editing different labels merge at
		// the field path, so three untouched writes would queue for nothing.
		const writes: Promise<void>[] = [];
		if (title.trim() !== label.title)
			writes.push(renameLabel(homeId, label.id, title));
		if (icon !== label.icon) writes.push(reiconLabel(homeId, label.id, icon));
		if (color !== label.color)
			writes.push(recolorLabel(homeId, label.id, color));
		if (writes.length > 0)
			Promise.all(writes).catch((reason) => {
				console.error("Could not save the label:", reason);
				onError();
			});
	};

	const remove = () => {
		if (label === null) return;
		setDeleting(false);
		onDismiss();
		deleteLabel(homeId, label.id).catch((reason) => {
			console.error("Could not delete the label:", reason);
			onError();
		});
	};

	return (
		<View>
			{pickingIcon ? (
				<Portal>
					<IconPicker
						value={icon}
						onSelect={(name) => {
							setIcon(name);
							setPickingIcon(false);
						}}
						onClose={() => setPickingIcon(false)}
					/>
				</Portal>
			) : (
				<AppDialog
					visible
					onDismiss={onDismiss}
					title={t(label === null ? "labels.newLabel" : "labels.editTitle")}
					testID={testID}
					returnFocusTo={returnFocusTo}
					actions={[
						...(label === null
							? []
							: [
									<Button
										key="delete"
										ref={deleteAnchor}
										mode="text"
										textColor={theme.colors.error}
										onPress={() => setDeleting(true)}
										contentStyle={{ minHeight: touchTarget }}
									>
										{t("labels.delete")}
									</Button>,
								]),
						<Button
							key="cancel"
							onPress={onDismiss}
							textColor={theme.colors.onSurfaceVariant}
							contentStyle={{ minHeight: touchTarget }}
						>
							{t("common.cancel")}
						</Button>,
						<Button
							key="save"
							mode="contained-tonal"
							onPress={save}
							contentStyle={{ minHeight: touchTarget }}
						>
							{t(label === null ? "labels.add" : "labels.save")}
						</Button>,
					]}
				>
					<View style={{ gap: space.lg }}>
						<View>
							<TextInput
								mode="outlined"
								label={t("labels.nameLabel")}
								value={title}
								onChangeText={(next) => {
									setTitle(next);
									setTitleProblem(null);
								}}
								error={titleProblem !== null}
							/>
							{/* The slot is reserved either way, so the sentence
							    appearing does not move the actions row. */}
							<HelperText type="error" visible={titleProblem !== null}>
								{titleProblem === null ? "" : t(titleProblem)}
							</HelperText>
						</View>

						<IconQuickPicks
							variant="label"
							picks={labelIconPicks}
							value={icon}
							color={color}
							onChange={setIcon}
							onOpenPicker={() => setPickingIcon(true)}
						/>

						<View style={{ gap: space.sm }}>
							<Text
								variant="labelLarge"
								style={{ color: theme.colors.onSurfaceVariant }}
							>
								{t("labels.colorLabel")}
							</Text>
							<ColorSwatches value={color} onChange={setColor} />
						</View>
					</View>
				</AppDialog>
			)}

			{deleting && label !== null ? (
				<ConfirmDialog
					visible
					onDismiss={() => setDeleting(false)}
					onConfirm={remove}
					title={t("labels.deleteTitle", { name: label.title })}
					body={t("labels.deleteBody")}
					confirmLabel={t("labels.delete")}
					destructive
					testID={`${testID}-delete`}
					returnFocusTo={deleteAnchor}
				/>
			) : null}
		</View>
	);
}
