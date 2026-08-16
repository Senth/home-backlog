import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Appbar, Menu } from "react-native-paper";

interface BoardMenuProps {
	showEveryone: boolean;
	onShowEveryone: (value: boolean) => void;
}

/**
 * What a whole board can do, rather than what one card can.
 *
 * One item so far, and it lives in an overflow rather than on the board surface
 * because it is rarely touched and a board is already carrying a column strip.
 * The screen renders this only where it has something to do — a board with
 * nothing hidden on it, in a household of one, does not grow a menu.
 */
export function BoardMenu({ showEveryone, onShowEveryone }: BoardMenuProps) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);

	return (
		<Menu
			visible={open}
			onDismiss={() => setOpen(false)}
			anchor={
				<Appbar.Action
					icon="dots-vertical"
					accessibilityLabel={t("board.boardActions")}
					onPress={() => setOpen(true)}
				/>
			}
		>
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
	);
}
