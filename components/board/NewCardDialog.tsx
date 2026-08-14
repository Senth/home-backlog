import { type RefObject, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { View } from "react-native";
import { Button, HelperText, TextInput } from "react-native-paper";
import { AppDialog } from "@/components/ui/AppDialog";
import { type TitleError, titleError } from "@/models/node";
import { useAppTheme } from "@/theme";
import { touchTarget } from "@/theme/tokens";

const dialogTestID = "new-card-dialog";

interface NewCardDialogProps {
	visible: boolean;
	onDismiss: () => void;
	/** Called with the typed title. Never awaited — see below. */
	onSubmit: (title: string) => void;
	returnFocusTo?: RefObject<View | null>;
}

/**
 * Title only. Due date, priority, effort and notes are on the document and
 * belong to node detail (#49); a form that asks five questions is a form nobody
 * fills in from a shed.
 *
 * The sheet closes on submit without waiting for anything. `createNode` queues
 * offline — the card is on the board immediately and the write lands when the
 * connection does — so awaiting the acknowledgement here would build a form that
 * hangs in a shed.
 */
export function NewCardDialog({
	visible,
	onDismiss,
	onSubmit,
	returnFocusTo,
}: NewCardDialogProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();

	const [title, setTitle] = useState("");
	const [error, setError] = useState<TitleError | null>(null);

	// Cleared on open rather than on close: the dialog animates out, and wiping
	// the field first shows an empty box on the way.
	useEffect(() => {
		if (visible) {
			setTitle("");
			setError(null);
		}
	}, [visible]);

	const submit = () => {
		const problem = titleError(title);
		if (problem !== null) {
			setError(problem);
			return;
		}

		onSubmit(title.trim());
		onDismiss();
	};

	return (
		<AppDialog
			visible={visible}
			onDismiss={onDismiss}
			title={t("board.newCard")}
			testID={dialogTestID}
			returnFocusTo={returnFocusTo}
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
					onPress={submit}
					contentStyle={{ minHeight: touchTarget }}
				>
					{t("board.add")}
				</Button>,
			]}
		>
			<TextInput
				mode="outlined"
				label={t("board.titleLabel")}
				value={title}
				onChangeText={(value) => {
					setTitle(value);
					setError(null);
				}}
				onSubmitEditing={submit}
				autoFocus
				error={error !== null}
			/>
			<HelperText type="error" visible={error !== null}>
				{error ? t(error) : ""}
			</HelperText>
		</AppDialog>
	);
}
