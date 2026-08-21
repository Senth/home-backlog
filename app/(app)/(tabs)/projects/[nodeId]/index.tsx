import { useIsFocused } from "@react-navigation/native";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { ActivityIndicator, Appbar, Snackbar } from "react-native-paper";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { Board } from "@/components/board/Board";
import { BoardMenu } from "@/components/board/BoardMenu";
import { Breadcrumbs } from "@/components/board/Breadcrumbs";
import {
	boardHref,
	detailsHref,
	goneHref,
} from "@/components/board/board-href";
import { useHome } from "@/contexts/HomeContext";
import { useAncestors } from "@/hooks/use-ancestors";
import { useGoneNotice } from "@/hooks/use-gone-notice";
import { useNode } from "@/hooks/use-node";
import { useNodes } from "@/hooks/use-nodes";
import { useParticipantFilter } from "@/hooks/use-participant-filter";
import { hasDetails } from "@/models/node";
import { useAppTheme } from "@/theme";
import { radius, size, space, touchTargetStyle } from "@/theme/tokens";

const noAncestors: string[] = [];

/**
 * A card opened as its own board — the same `Board` component the root uses, at
 * any depth. `PROJECT.md`: resist per-level special cases.
 *
 * The columns are the ones frozen on *this* node when it was created, never
 * recomputed from the current default: every later change to that default —
 * #99 was one — would otherwise swap the set under every board that already
 * exists and strand each card sitting in a column the new set drops.
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
	const focused = useIsFocused();

	// `null` is not "not ready" to either hook — `useNodes` reads it as the
	// *root* board — so a missing param must subscribe to nothing at all rather
	// than to the wrong board. Scoping the home to null is what says "wait". It
	// is a required segment of this route, so this only ever holds for a frame.
	const board = nodeId ?? null;
	const homeId = board === null ? null : (activeHome?.id ?? null);
	const { node, gone } = useNode(homeId, board);
	const { nodes, loading, failed, retry } = useNodes(homeId, board);
	const { crumbs } = useAncestors(homeId, node?.ancestorIds ?? noAncestors);
	const filtered = useParticipantFilter(nodes);

	// The predicate is uniform at every depth and *bites* only where participants
	// exist, which is roots — a shared descendant carries none, and a private one
	// carries the root's, which include me or I could not have read it. So on a
	// drill-down board the menu is offered rather than needed, and in a household
	// of one it is neither.
	const members = Object.keys(activeHome?.members ?? {}).length;
	const canFilter = filtered.hiddenCount > 0 || members > 1;

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
	 *
	 * Only the screen you are looking at may navigate. Deleting a project takes
	 * its whole subtree, so every stacked board below it sees `gone` in the same
	 * tick — and without this they would all call `dismissTo` at once, racing for
	 * where you end up.
	 */
	useEffect(() => {
		if (gone && focused) router.dismissTo(goneHref(parentId.current));
	}, [gone, focused]);

	if (board === null) return null;

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header>
				{/* Up to the parent board, never `router.back()`. This screen is
				    reachable with no in-app history — a reload, a bookmark, a shared
				    link — and there `back()` is a no-op that logs "GO_BACK was not
				    handled by any navigator" and leaves the arrow dead. */}
				{/* The label names where the arrow *goes*, which is the parent card
				    at every depth but one — not "Projects". */}
				<Appbar.BackAction
					style={touchTargetStyle}
					accessibilityLabel={t("board.up")}
					onPress={() => router.dismissTo(boardHref(node?.parentId ?? null))}
				/>
				{/* No `subtitle`: Paper renders it only outside Material 3, so the
				    home's name lives on the root board's app bar and one crumb away
				    — the first crumb goes there. */}
				<Appbar.Content title={node?.title ?? ""} />
				{/* This board's *own* details — the four fields belong to the card you
				    are standing on, and there is no card on screen to tap. The root
				    board has no node, so it has no action. The mark says there is
				    something in there, which makes opening it a decision rather than a
				    lottery. */}
				{node === null ? null : (
					<View>
						<Appbar.Action
							style={touchTargetStyle}
							icon="information-outline"
							accessibilityLabel={t("detail.title")}
							onPress={() => router.push(detailsHref(node.id))}
						/>
						{hasDetails(node) ? (
							<View
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
				)}
				{canFilter ? (
					<BoardMenu
						showEveryone={filtered.showEveryone}
						onShowEveryone={filtered.setShowEveryone}
					/>
				) : null}
				<AccountMenu />
			</Appbar.Header>

			<Breadcrumbs
				crumbs={crumbs}
				current={node?.title ?? ""}
				onNavigate={(id) => router.dismissTo(boardHref(id))}
			/>

			{/* No board until its own node has arrived. `Board` hands `parent`
			    straight to `createNode`, and a null parent is not "this board" but
			    the **root** — so a card added while the node was still resolving
			    would silently become a top-level project. Online that is a short
			    race on a cold start; offline, on a board never opened while online,
			    the node never arrives at all and the window would never close. */}
			{homeId && node ? (
				<Board
					homeId={homeId}
					parent={node}
					columns={node.columns}
					nodes={filtered.nodes}
					loading={loading}
					failed={failed}
					onRetry={retry}
					hidden={filtered.hidden}
				/>
			) : (
				<ActivityIndicator
					accessibilityLabel={t("common.loading")}
					style={{ marginTop: space.xl }}
				/>
			)}

			<Snackbar visible={notice.showing} onDismiss={notice.dismiss}>
				{t("board.gone")}
			</Snackbar>
		</View>
	);
}
