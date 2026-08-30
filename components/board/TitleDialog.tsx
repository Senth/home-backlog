import { type RefObject, useState } from "react";
import { useTranslation } from "react-i18next";
import type { View } from "react-native";
import { Button, HelperText, TextInput } from "react-native-paper";
import { AppDialog } from "@/components/ui/AppDialog";
import { type TitleError, titleError } from "@/models/node";
import { useAppTheme } from "@/theme";
import { touchTarget } from "@/theme/tokens";

interface TitleDialogProps {
	visible: boolean;
	onDismiss: () => void;
	/** The dialog's own heading — "New card" or "Rename card". */
	heading: string;
	confirmLabel: string;
	/** What the field starts with. A rename starts from the current title. */
	initialTitle?: string;
	/** The field's own label. The board's "Title" is the default. */
	label?: string;
	/** Called with the trimmed title. Never awaited — see below. */
	onSubmit: (title: string) => void;
	/** Unique per dialog: the focus trap finds the surface by `${testID}-surface`. */
	testID: string;
	returnFocusTo?: RefObject<View | null>;
}

/**
 * A title, and nothing else — used to create a card and to rename one.
 *
 * Creation is title only because due date, priority, effort and notes are on the
 * document and belong to node detail (#49); a form that asks five questions is a
 * form nobody fills in from a shed. Rename is here at all because a card with no
 * way to fix a typo is a permanent mistake.
 *
 * The dialog closes on submit without waiting for anything. Both writes queue
 * offline — the change is on the board immediately and lands when the connection
 * does — so awaiting the acknowledgement would build a form that hangs in a shed.
 */
export function TitleDialog({
	visible,
	onDismiss,
	heading,
	confirmLabel,
	initialTitle = "",
	label,
	onSubmit,
	testID,
	returnFocusTo,
}: TitleDialogProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();

	const [title, setTitle] = useState(initialTitle);
	const [error, setError] = useState<TitleError | null>(null);

	// Reset when the dialog *opens*, during render, the way `useNodes` clears a
	// board. Not in an effect keyed on `initialTitle`: the board listens for
	// changes, so another member renaming this card while the dialog is open
	// would wipe whatever is being typed — the ordinary two-person case. Not on
	// close either, because the dialog animates out and would show an empty box
	// on the way.
	const [opened, setOpened] = useState(visible);
	if (opened !== visible) {
		setOpened(visible);
		if (visible) {
			setTitle(initialTitle);
			setError(null);
		}
	}

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
			title={heading}
			testID={testID}
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
					key="confirm"
					onPress={submit}
					contentStyle={{ minHeight: touchTarget }}
				>
					{confirmLabel}
				</Button>,
			]}
		>
			<TextInput
				mode="outlined"
				label={label ?? t("board.titleLabel")}
				value={title}
				onChangeText={(value) => {
					setTitle(value);
					setError(null);
				}}
				onSubmitEditing={submit}
				autoFocus
				selectTextOnFocus
				error={error !== null}
			/>
			<HelperText type="error" visible={error !== null}>
				{error ? t(error) : ""}
			</HelperText>
		</AppDialog>
	);
}
