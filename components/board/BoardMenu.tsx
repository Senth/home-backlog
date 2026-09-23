import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Appbar, Menu } from "react-native-paper";
import { detailsHref } from "@/components/board/board-href";
import { TitleDialog } from "@/components/board/TitleDialog";
import { AppMenu } from "@/components/ui/AppMenu";
import { updateNode } from "@/data/nodes";
import { useTabTrap } from "@/hooks/use-modal-focus";
import { hasDetails, type Node } from "@/models/node";
import { useAppTheme } from "@/theme";
import { radius, size, space, touchTargetStyle } from "@/theme/tokens";

interface BoardMenuProps {
	homeId: string | null;
	/** The card this board belongs to, or null on the root board. */
	node: Node | null;
}

/**
 * What a whole board can do, rather than what one card can.
 *
 * It lives in an overflow rather than on the board surface because it is
 * rarely touched and a board is already carrying a column strip. The screen
 * renders this only where it has something to do — a board with no card of
 * its own does not grow a menu; the *show everyone* preference that used to
 * ride here moved into the filter sheet (D8), which is where the rest of the
 * board's show/hide decisions live.
 */
export function BoardMenu({ homeId, node }: BoardMenuProps) {
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

	// Same trap, same reasoning: while open, the menu is what is being answered.
	useTabTrap(open, `board-menu-${node?.id ?? "root"}`);

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
			<AppMenu
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
				<View testID={`board-menu-${node?.id ?? "root"}`}>
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
				</View>
			</AppMenu>

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
