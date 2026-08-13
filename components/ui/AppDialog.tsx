import type { ReactNode, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { useWindowDimensions, type View } from "react-native";
import { Button, Dialog, Portal, Text } from "react-native-paper";
import { useModalFocus } from "@/hooks/use-modal-focus";
import { useAppTheme } from "@/theme";
import { contentWidth, space, touchTarget } from "@/theme/tokens";

interface AppDialogProps {
	visible: boolean;
	onDismiss: () => void;
	title: string;
	/** Unique per dialog: the focus trap finds the surface by `${testID}-surface`. */
	testID: string;
	children?: ReactNode;
	/**
	 * The buttons, as an **array** and never a fragment. `Dialog.Actions` clones
	 * each of its children to inject `compact` and the inter-button margin, and a
	 * fragment absorbs both — React then logs "Invalid prop `compact` supplied to
	 * `React.Fragment`" for every dialog the app opens, and Paper's own action
	 * spacing never lands. An array is flattened into real children instead.
	 */
	actions: ReactNode[];
	/** Whatever opened the dialog, so a keyboard user is not dropped on `<body>`. */
	returnFocusTo?: RefObject<View | null>;
}

/**
 * Every dialog in the app, with the three things Paper does not do on the web.
 *
 * **Width.** Paper leaves the surface to fill its container, so on a monitor a
 * dialog spans the window. Computing it keeps the inset on a phone *and* the
 * Material 3 clamp on a monitor — `width: "100%"` instead cancels Paper's own
 * margin.
 *
 * **Focus.** Paper renders into a Portal and leaves focus where it was, so
 * without the trap a dialog is reachable only by tabbing through the screen
 * behind the scrim, and Escape does nothing.
 *
 * **Wrapping actions.** Below ~230 px two labels no longer fit side by side and
 * Paper's row overflows its own card, putting the safe answer off-screen while
 * the destructive one sits square in the middle. That is a phone at 200 % zoom.
 */
export function AppDialog({
	visible,
	onDismiss,
	title,
	testID,
	children,
	actions,
	returnFocusTo,
}: AppDialogProps) {
	const { width } = useWindowDimensions();

	useModalFocus(visible, `${testID}-surface`, onDismiss, { returnFocusTo });

	return (
		<Portal>
			<Dialog
				visible={visible}
				onDismiss={onDismiss}
				testID={testID}
				style={{
					alignSelf: "center",
					width: Math.min(width - space.lg * 2, contentWidth.dialog),
				}}
			>
				<Dialog.Title>{title}</Dialog.Title>
				<Dialog.Content>{children}</Dialog.Content>
				<Dialog.Actions style={{ gap: space.md, flexWrap: "wrap" }}>
					{actions}
				</Dialog.Actions>
			</Dialog>
		</Portal>
	);
}

interface ConfirmDialogProps {
	visible: boolean;
	onDismiss: () => void;
	onConfirm: () => void;
	title: string;
	body: string;
	confirmLabel: string;
	/** Paints the confirming action in the error colour and never as the default. */
	destructive?: boolean;
	testID: string;
	returnFocusTo?: RefObject<View | null>;
}

/**
 * Ask, then act. Used for every step that another person can feel — leaving,
 * removing somebody, withdrawing an invitation, deleting a home.
 *
 * The two answers must not look alike. Paper's default gives both actions
 * `primary`, so the one that cannot be undone reads exactly like the one that
 * does nothing — and it sits on the right, under the thumb.
 */
export function ConfirmDialog({
	visible,
	onDismiss,
	onConfirm,
	title,
	body,
	confirmLabel,
	destructive = false,
	testID,
	returnFocusTo,
}: ConfirmDialogProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();

	return (
		<AppDialog
			visible={visible}
			onDismiss={onDismiss}
			title={title}
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
					onPress={onConfirm}
					textColor={destructive ? theme.colors.error : theme.colors.primary}
					contentStyle={{ minHeight: touchTarget }}
				>
					{confirmLabel}
				</Button>,
			]}
		>
			<Text variant="bodyMedium">{body}</Text>
		</AppDialog>
	);
}
