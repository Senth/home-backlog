import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Appbar } from "react-native-paper";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { Board } from "@/components/board/Board";
import { useHome } from "@/contexts/HomeContext";
import { useNode } from "@/hooks/use-node";
import { useNodes } from "@/hooks/use-nodes";
import { columnsForDepth } from "@/models/node";
import { useAppTheme } from "@/theme";

/**
 * A card opened as its own board — the same `Board` component the root uses, at
 * any depth. `PROJECT.md`: resist per-level special cases.
 *
 * The columns are the ones frozen on *this* node when it was created, never
 * recomputed from where it sits now: a subtree dragged one level deeper would
 * otherwise swap the full stage set for the simple one and strand every card
 * that was in Find out or Check.
 */
export default function NodeBoard() {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();
	const { nodeId } = useLocalSearchParams<{ nodeId: string }>();
	const { activeHome } = useHome();

	const homeId = activeHome?.id ?? null;
	const { node, loading: nodeLoading } = useNode(homeId, nodeId ?? null);
	const { nodes, loading } = useNodes(homeId, nodeId ?? null);

	// A node that has not arrived yet has no frozen set to read, and its depth is
	// the only thing that could stand in for one. Its own children are one level
	// below it, which is the simple set at every depth this screen can be at.
	const columns = node?.columns ?? columnsForDepth(1);

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header>
				<Appbar.BackAction
					accessibilityLabel={t("board.root")}
					onPress={() => router.back()}
				/>
				<Appbar.Content
					title={node?.title ?? ""}
					subtitle={activeHome?.name ?? ""}
				/>
				<AccountMenu />
			</Appbar.Header>

			{homeId ? (
				<Board
					homeId={homeId}
					parent={node}
					columns={columns}
					nodes={nodes}
					loading={loading || nodeLoading}
				/>
			) : null}
		</View>
	);
}
