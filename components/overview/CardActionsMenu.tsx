import * as Clipboard from "expo-clipboard";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { IconButton, Menu, Snackbar } from "react-native-paper";
import { type Card, exportCard, seedTitleKeys } from "@/models/overview-cards";
import { contentWidth, icon, space, touchTarget } from "@/theme/tokens";

interface CardActionsMenuProps {
	/** The card itself, for *Copy as text* — the menu owns the export. */
	card: Card;
	/** `shared` only: this menu offers Hide for me, which is per-member. */
	scope: "global" | "home" | "shared";
	/** Editor rows only: the accessible alternative to dragging. */
	showMove?: boolean;
	/** Editor rows only, `showMove` implied: whether the card can move. */
	canMoveUp?: boolean;
	canMoveDown?: boolean;
	/** Whether the member has already hidden this shared card. */
	hidden?: boolean;
	/** Disabled while the move would be refused. */
	moveDisabled?: boolean;
	/** Names the card it belongs to, for the tests and for a screen reader. */
	testID: string;
	onEdit: () => void;
	onMoveUp?: () => void;
	onMoveDown?: () => void;
	onHide?: () => void;
	onShow?: () => void;
	onRemove: () => void;
}

/**
 * The one per-card menu, for both surfaces that carry one: the read screen's
 * card headers and the editor's rows. The read screen offers Edit, Hide for
 * me and Remove; the editor adds Move up and Move down — the accessible
 * alternative to dragging, which is this repo's established drag-plus-controls
 * pattern. *Copy as text* is on both: the export is clipboard-local, so it
 * works offline, and the confirmation is this menu's own Snackbar.
 *
 * The chrome is one small button that says nothing until pressed: on the read
 * screen the menu content is the per-card chrome, and it appears on press.
 */
export function CardActionsMenu({
	card,
	scope,
	showMove = false,
	canMoveUp = false,
	canMoveDown = false,
	hidden = false,
	moveDisabled = false,
	testID,
	onEdit,
	onMoveUp,
	onMoveDown,
	onHide,
	onShow,
	onRemove,
}: CardActionsMenuProps) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState(false);
	const anchor = useRef<View | null>(null);

	const close = useCallback(() => setOpen(false), []);

	// A seed's heading is i18n the reader supplies; the string that travels has
	// to carry the words themselves, because the importer's app translates it.
	const copy = () => {
		close();
		const title =
			card.title ??
			(card.seedId !== null ? t(seedTitleKeys[card.seedId]) : card.id);
		Clipboard.setStringAsync(exportCard({ ...card, title }))
			.then(() => setCopied(true))
			.catch((reason: unknown) =>
				console.error("Could not copy the card:", reason),
			);
	};

	return (
		<>
			<Menu
				visible={open}
				onDismiss={close}
				overlayAccessibilityLabel={t("common.closeMenu")}
				anchor={
					<View ref={anchor}>
						<IconButton
							icon="dots-vertical"
							// The glyph is small; the box around it is not — the same box the
							// board's card menu gives its own dots.
							size={icon.sm}
							accessibilityLabel={t("board.actions")}
							testID={testID}
							onPress={(event) => {
								event.stopPropagation();
								setOpen(true);
							}}
							style={{
								width: touchTarget,
								height: touchTarget,
								margin: space.none,
							}}
						/>
					</View>
				}
			>
				<Menu.Item
					leadingIcon="pencil-outline"
					title={t("overview.cards.menu.edit")}
					onPress={() => {
						close();
						onEdit();
					}}
				/>
				<Menu.Item
					leadingIcon="content-copy"
					title={t("overview.cards.menu.copy")}
					onPress={copy}
				/>
				{showMove ? (
					<>
						<Menu.Item
							leadingIcon="arrow-up"
							title={t("overview.cards.menu.moveUp")}
							onPress={() => {
								close();
								onMoveUp?.();
							}}
							disabled={moveDisabled || !canMoveUp}
						/>
						<Menu.Item
							leadingIcon="arrow-down"
							title={t("overview.cards.menu.moveDown")}
							onPress={() => {
								close();
								onMoveDown?.();
							}}
							disabled={moveDisabled || !canMoveDown}
						/>
					</>
				) : null}
				{/* The read screen offers the hide; the editor offers whichever state
			    the card is in, so a hidden shared card can come back. */}
				{scope === "shared" &&
				(hidden ? onShow !== undefined : onHide !== undefined) ? (
					hidden ? (
						<Menu.Item
							leadingIcon="eye"
							title={t("overview.cards.menu.show")}
							onPress={() => {
								close();
								onShow?.();
							}}
						/>
					) : (
						<Menu.Item
							leadingIcon="eye-off"
							title={t("overview.cards.menu.hide")}
							onPress={() => {
								close();
								onHide?.();
							}}
						/>
					)
				) : null}
				<Menu.Item
					leadingIcon="delete-outline"
					title={t("overview.cards.menu.remove")}
					onPress={() => {
						close();
						onRemove();
					}}
				/>
			</Menu>

			{/* The copy is clipboard-local — it never touches the network — so the
			    confirmation is the only thing it needs to say. */}
			<Snackbar
				visible={copied}
				onDismiss={() => setCopied(false)}
				style={{ maxWidth: contentWidth.snackbar, alignSelf: "center" }}
			>
				{t("overview.cards.menu.copied")}
			</Snackbar>
		</>
	);
}
