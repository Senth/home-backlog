import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Appbar, Divider, Menu } from "react-native-paper";
import { detailsHref } from "@/components/board/board-href";
import { TitleDialog } from "@/components/board/TitleDialog";
import { updateNode } from "@/data/nodes";
import { useAnchorFocusGuard } from "@/hooks/use-modal-focus";
import { hasDetails, type Node } from "@/models/node";
import { useAppTheme } from "@/theme";
import { radius, size, space, touchTargetStyle } from "@/theme/tokens";

interface BoardMenuProps {
	homeId: string | null;
	/** The card this board belongs to, or null on the root board. */
	node: Node | null;
	showEveryone: boolean;
	onShowEveryone: (value: boolean) => void;
}

/**
 * What a whole board can do, rather than what one card can.
 *
 * It lives in an overflow rather than on the board surface because it is
 * rarely touched and a board is already carrying a column strip. The screen
 * renders this only where it has something to do — a board with nothing
 * hidden on it and no card of its own to rename, in a household of one, does
 * not grow a menu.
 */
export function BoardMenu({
	homeId,
	node,
	showEveryone,
	onShowEveryone,
}: BoardMenuProps) {
	const { t } = useTranslation();
	const router = useRouter();
	const theme = useAppTheme();
	const [open, setOpen] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const anchor = useRef<View | null>(null);

	// Stable so Paper keeps its Escape handler: it attaches that to `document`
	// once, inside `show()`, and tears it down from an effect whose dependency
	// chain ends at `onDismiss`. A fresh closure each render means any re-render
	// while the menu is open leaves it with no way out but the mouse. Same
	// reasoning, and the same fix, as `components/board/CardMenu.tsx`.
	const close = useCallback(() => setOpen(false), []);

	// Same unasked mount focus from Paper's closed `Menu` as every card's menu.
	useAnchorFocusGuard(anchor);

	// Queues offline exactly as `CardMenu`'s rename does. No online gate, no
	// hint — gating this write would make it the only one on this screen that
	// refuses without a connection.
	const rename = (title: string) => {
		if (homeId === null || node === null) return;
		updateNode(homeId, node.id, { title }).catch((reason) => {
			console.error("Could not rename the card:", reason);
		});
	};

	return (
		<>
			<Menu
				visible={open}
				onDismiss={close}
				// Paper's scrim is announced, and its default name is English.
				overlayAccessibilityLabel={t("common.closeMenu")}
				anchor={
					<View ref={anchor}>
						<Appbar.Action
							style={touchTargetStyle}
							icon="dots-vertical"
							accessibilityLabel={t("board.boardActions")}
							onPress={() => setOpen(true)}
						/>
						{/* The mark that used to sit on the info action, which now lives
						    in this menu: it says there is something behind the dots,
						    which makes opening them a decision rather than a lottery. */}
						{node !== null && hasDetails(node) ? (
							<View
								testID="board-details-mark"
								style={{
									// The style prop, not `pointerEvents`: React Native Web
									// deprecated the prop and warns on every render.
									pointerEvents: "none",
									position: "absolute",
									top: space.sm,
									right: space.sm,
									width: size.dot,
									height: size.dot,
									borderRadius: radius.full,
									backgroundColor: theme.colors.primary,
								}}
							/>
						) : null}
					</View>
				}
			>
				{node === null ? null : (
					<Menu.Item
						leadingIcon="information-outline"
						title={t("detail.title")}
						onPress={() => {
							close();
							router.push(detailsHref(node.id));
						}}
					/>
				)}
				{node === null ? null : (
					<Menu.Item
						leadingIcon="pencil-outline"
						title={t("board.rename")}
						onPress={() => {
							close();
							setRenaming(true);
						}}
					/>
				)}
				{/* The two above act on this card; this one changes what the board
				    shows. Without the rule they read as one list, and on a project's
				    own board a bare "show everyone" is heard as "show everyone who is
				    in on this" — the question the details screen just taught. */}
				{node === null ? null : <Divider />}
				<Menu.Item
					leadingIcon="account-group-outline"
					// A check rather than a switch: Paper's menu row is one tappable
					// surface, and a switch inside it gives the same row two targets that
					// do the same thing.
					trailingIcon={showEveryone ? "check" : undefined}
					// The ARIA prop, not `accessibilityState` — React Native Web 0.21
					// does not forward the object form, so the check would be visible
					// and nothing else.
					aria-checked={showEveryone}
					title={t("board.showEveryone")}
					onPress={() => {
						onShowEveryone(!showEveryone);
						setOpen(false);
					}}
				/>
			</Menu>

			{/* Mounted only while open — see `CardMenu`'s identical dialog. */}
			{renaming && node !== null ? (
				<TitleDialog
					visible
					onDismiss={() => setRenaming(false)}
					heading={t("board.renameTitle")}
					confirmLabel={t("board.rename")}
					initialTitle={node.title}
					onSubmit={rename}
					testID={`rename-board-${node.id}`}
					returnFocusTo={anchor}
				/>
			) : null}
		</>
	);
}
