import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Appbar, Snackbar } from "react-native-paper";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { Board } from "@/components/board/Board";
import { InstallCard } from "@/components/ui/InstallCard";
import { useHome } from "@/contexts/HomeContext";
import { useGoneNotice } from "@/hooks/use-gone-notice";
import { useNodes } from "@/hooks/use-nodes";
import { rootColumns } from "@/models/node";
import { useAppTheme } from "@/theme";

/**
 * The board you land on: every root-level card, in the full stage set.
 *
 * The **root board is not a document**. It cannot be moved, deleted or
 * reparented, so there is nothing for a frozen column set to protect and its
 * columns are the `rootColumns` constant; a stored set earns its keep when #63
 * gives it a screen.
 *
 * The app bar names the *home*, not the screen — the tab bar already names the
 * screen, and which home you are in has to be visible without a tap. Without it,
 * work on the cabin gets recorded on the house board and nothing on screen ever
 * said otherwise.
 */
export default function Projects() {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();
	const { activeHome } = useHome();
	const notice = useGoneNotice();

	const homeId = activeHome?.id ?? null;
	const { nodes, loading } = useNodes(homeId, null);

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header>
				<Appbar.BackAction
					accessibilityLabel={t("homes.title")}
					onPress={() => router.push("/homes")}
				/>
				<Appbar.Content title={activeHome?.name ?? ""} />
				<AccountMenu />
			</Appbar.Header>

			<InstallCard />

			{homeId ? (
				<Board
					homeId={homeId}
					parent={null}
					columns={rootColumns}
					nodes={nodes}
					loading={loading}
				/>
			) : null}

			{/* Said here rather than on the board that vanished: a card can be
			    deleted, with its whole subtree, while somebody is standing on it. */}
			<Snackbar visible={notice.showing} onDismiss={notice.dismiss}>
				{t("board.gone")}
			</Snackbar>
		</View>
	);
}
