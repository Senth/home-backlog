import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Appbar, Snackbar } from "react-native-paper";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { Board } from "@/components/board/Board";
import { BoardMenu } from "@/components/board/BoardMenu";
import { InstallCard } from "@/components/ui/InstallCard";
import { useHome } from "@/contexts/HomeContext";
import { useGoneNotice } from "@/hooks/use-gone-notice";
import { useNodes } from "@/hooks/use-nodes";
import { useParticipantFilter } from "@/hooks/use-participant-filter";
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
	const board = useParticipantFilter(nodes);

	// The menu carries one item, so it appears where that item could have
	// something to do: a household of one has nobody else's projects to hide, so
	// no board in it grows a control that can never change anything. A card with
	// participants arriving from the REST API (#7) into a solo home is the case
	// `hiddenCount` covers, where hiding with no way back would be a trap.
	const members = Object.keys(activeHome?.members ?? {}).length;
	const canFilter = board.hiddenCount > 0 || members > 1;

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header>
				<Appbar.BackAction
					accessibilityLabel={t("homes.title")}
					onPress={() => router.push("/homes")}
				/>
				<Appbar.Content title={activeHome?.name ?? ""} />
				{canFilter ? (
					<BoardMenu
						showEveryone={board.showEveryone}
						onShowEveryone={board.setShowEveryone}
					/>
				) : null}
				<AccountMenu />
			</Appbar.Header>

			<InstallCard />

			{homeId ? (
				<Board
					homeId={homeId}
					parent={null}
					columns={rootColumns}
					nodes={board.nodes}
					loading={loading}
					hidden={board.hidden}
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
