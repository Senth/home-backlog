import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Appbar, Snackbar } from "react-native-paper";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { Board } from "@/components/board/Board";
import { Breadcrumbs } from "@/components/board/Breadcrumbs";
import { boardHref, goneHref } from "@/components/board/board-href";
import { useHome } from "@/contexts/HomeContext";
import { useAncestors } from "@/hooks/use-ancestors";
import { useGoneNotice } from "@/hooks/use-gone-notice";
import { useNode } from "@/hooks/use-node";
import { useNodes } from "@/hooks/use-nodes";
import { columnsForDepth } from "@/models/node";
import { useAppTheme } from "@/theme";

const noAncestors: string[] = [];

/**
 * A card opened as its own board — the same `Board` component the root uses, at
 * any depth. `PROJECT.md`: resist per-level special cases.
 *
 * The columns are the ones frozen on *this* node when it was created, never
 * recomputed from where it sits now: a subtree moved one level deeper would
 * otherwise swap the full stage set for the simple one and strand every card
 * that was in Find out or Check.
 *
 * The app bar names the card and keeps the home as its subtitle — which home you
 * are in has to be visible without a tap at every depth, and the breadcrumbs
 * below it say where in the tree you are.
 */
export default function NodeBoard() {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const { nodeId } = useLocalSearchParams<{ nodeId: string }>();
	const { activeHome } = useHome();
	const notice = useGoneNotice();

	const homeId = activeHome?.id ?? null;
	const { node, loading: nodeLoading, gone } = useNode(homeId, nodeId ?? null);
	const { nodes, loading } = useNodes(homeId, nodeId ?? null);
	const { crumbs } = useAncestors(homeId, node?.ancestorIds ?? noAncestors);

	// Where "up" is once the card itself has stopped existing. Remembered while
	// it still does, because a deleted card cannot say who its parent was.
	const parentId = useRef<string | null>(null);
	useEffect(() => {
		if (node !== null) parentId.current = node.parentId;
	}, [node]);

	/**
	 * A card can be deleted, with its whole subtree, while somebody else is
	 * standing on it — and a board whose node is gone is a screen that can only
	 * ever be empty. Not found and permission-denied arrive here as the same
	 * answer, and one level up is the right answer to both.
	 */
	useEffect(() => {
		if (gone) router.dismissTo(goneHref(parentId.current));
	}, [gone]);

	// A node that has not arrived yet has no frozen set to read. Its children are
	// at least depth 2, which is the simple set at every depth this screen sees.
	const columns = node?.columns ?? columnsForDepth(1);

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header>
				{/* Up to the parent board, never `router.back()`. This screen is
				    reachable with no in-app history — a reload, a bookmark, a shared
				    link — and there `back()` is a no-op that logs "GO_BACK was not
				    handled by any navigator" and leaves the arrow dead. */}
				<Appbar.BackAction
					accessibilityLabel={t("board.root")}
					onPress={() => router.dismissTo(boardHref(node?.parentId ?? null))}
				/>
				<Appbar.Content
					title={node?.title ?? ""}
					subtitle={activeHome?.name ?? ""}
				/>
				<AccountMenu />
			</Appbar.Header>

			<Breadcrumbs
				crumbs={crumbs}
				current={node?.title ?? ""}
				onNavigate={(id) => router.dismissTo(boardHref(id))}
			/>

			{homeId ? (
				<Board
					homeId={homeId}
					parent={node}
					columns={columns}
					nodes={nodes}
					loading={loading || nodeLoading}
				/>
			) : null}

			<Snackbar visible={notice.showing} onDismiss={notice.dismiss}>
				{t("board.gone")}
			</Snackbar>
		</View>
	);
}
