import { useIsFocused } from "@react-navigation/native";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWindowDimensions, View } from "react-native";
import { ActivityIndicator, Appbar, Snackbar } from "react-native-paper";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { Board } from "@/components/board/Board";
import {
	BoardFilterAction,
	BoardFilterSheet,
} from "@/components/board/BoardFilterSheet";
import { BoardMenu } from "@/components/board/BoardMenu";
import { Breadcrumbs } from "@/components/board/Breadcrumbs";
import { boardHref, goneHref } from "@/components/board/board-href";
import { BackAction } from "@/components/ui/BackAction";
import { useHome } from "@/contexts/HomeContext";
import { useAncestors } from "@/hooks/use-ancestors";
import { useBoardFilter } from "@/hooks/use-board-filter";
import { useBoardNodes } from "@/hooks/use-board-nodes";
import { useGoneNotice } from "@/hooks/use-gone-notice";
import { useLocations } from "@/hooks/use-locations";
import { useNode } from "@/hooks/use-node";
import { useParticipantFilter } from "@/hooks/use-participant-filter";
import { filterActionVisible } from "@/models/board-filter";
import { membersOf } from "@/models/home";
import { effectiveLocation } from "@/models/node";
import { useAppTheme } from "@/theme";
import { appBarStackBreakpoint, space } from "@/theme/tokens";

const noAncestors: string[] = [];
const noLabelIds: string[] = [];

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

	// `null` is not "not ready" to either hook — `useBoardNodes` reads it as
	// the *root* board — so a missing param must subscribe to nothing at all rather
	// than to the wrong board. Scoping the home to null is what says "wait". It
	// is a required segment of this route, so this only ever holds for a frame.
	const board = nodeId ?? null;
	const homeId = board === null ? null : (activeHome?.id ?? null);
	const { node, gone } = useNode(homeId, board);
	const { crumbs } = useAncestors(homeId, node?.ancestorIds ?? noAncestors);
	const { filter, loading: filterLoading, setFilter } = useBoardFilter(homeId);
	// The reach the stored filter names (D2): this board's children, or
	// everything below them — the pool pair and the done pair (Q1), filtered
	// on the trail.
	const { nodes, pool, loading, failed, retry } = useBoardNodes(
		homeId,
		board,
		filter?.reach ?? "board",
	);
	const filtered = useParticipantFilter(nodes);
	const { locations } = useLocations(homeId);
	const [filterOpen, setFilterOpen] = useState(false);
	const filterAnchor = useRef<View>(null);

	// The labels every card on this board inherits (#100): the board node's own
	// chain, already held — the board node itself by `useNode`, everything above
	// it by the crumbs `useAncestors` fetched for the breadcrumbs. One chain,
	// shared by the whole board, so it is resolved once here rather than per
	// card. An unreadable ancestor contributes nothing, the same neutral answer
	// its crumb renders.
	const ancestorLabelIds =
		node === null
			? noLabelIds
			: [
					node,
					...crumbs.flatMap((crumb) => (crumb.node ? [crumb.node] : [])),
				].flatMap((ancestor) => ancestor.labelIds);

	// The nearest place the board's own chain passes down (#290) — the board
	// node itself first, then everything above it. Every card without a place
	// of its own answers to it, resolved once here rather than per card. An
	// unreadable ancestor contributes nothing, the same neutral answer its
	// crumb renders. The whole answer, not only its id: the filter's "in or
	// under" reads the path too.
	const ancestorLocation =
		node === null
			? null
			: effectiveLocation(
					node,
					crumbs.map((crumb) => crumb.node ?? null),
				);

	// The card face's location facts (#100), read from the leaf: id → place,
	// from the one listener this screen holds.
	const locationsById = new Map(locations.map((l) => [l.id, l]));

	// The filter action exists where a condition could change something (D10);
	// the board menu, which now only renames, only where there is a card to
	// rename — the root board has none.
	const members = activeHome === null ? [] : membersOf(activeHome);
	const showFilterAction = filterActionVisible(
		members.length,
		activeHome?.labels.length ?? 0,
		locations.length,
	);
	// The predicate is uniform at every depth and *bites* only where participants
	// exist, which is roots — a shared descendant carries none, and a private one
	// carries the root's, which include me or I could not have read it.
	const { width } = useWindowDimensions();

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
			<Appbar.Header
				// Three 48dp targets and the bar's padding leave a narrow screen no
				// room for a title — see `appBarStackBreakpoint`.
				mode={width < appBarStackBreakpoint ? "medium" : "small"}
			>
				{/* Back to wherever the push came from — the overview's tap on a card
				    with steps, or the board you drilled down from — and to the parent
				    board when there is no history to go back through: this screen is
				    reachable with no in-app history — a reload, a bookmark, a shared
				    link — and there `back()` is a no-op that logs "GO_BACK was not
				    handled by any navigator" and leaves the arrow dead.
				    `canGoBack()` is exactly that test, the details screen's own. */}
				{/* The label names where the arrow *goes*, which is the parent card
				    at every depth but one — not "Projects". */}
				<BackAction
					accessibilityLabel={t("board.up")}
					onPress={() =>
						router.canGoBack()
							? router.back()
							: router.dismissTo(boardHref(node?.parentId ?? null))
					}
				/>
				{/* No `subtitle`: Paper renders it only outside Material 3, so the
				    home's name lives on the root board's app bar and one crumb away
				    — the first crumb goes there. */}
				<Appbar.Content title={node?.title ?? ""} />
				{showFilterAction ? (
					<BoardFilterAction
						set={
							filter !== null &&
							(filter.conditions.length > 0 || filter.reach === "subtree")
						}
						onPress={() => setFilterOpen(true)}
						anchorRef={filterAnchor}
					/>
				) : null}
				{node !== null ? <BoardMenu homeId={homeId} node={node} /> : null}
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
					loading={loading || filterLoading}
					failed={failed}
					onRetry={retry}
					hidden={filtered.hidden}
					ancestorLabelIds={ancestorLabelIds}
					ancestorLocation={ancestorLocation}
					locations={locationsById}
					filter={filter}
					onChangeFilter={setFilter}
					onOpenFilter={() => setFilterOpen(true)}
					reach={filter?.reach ?? "board"}
					pool={pool}
				/>
			) : (
				<ActivityIndicator
					accessibilityLabel={t("common.loading")}
					style={{ marginTop: space.xl }}
				/>
			)}

			{showFilterAction && homeId !== null && node !== null ? (
				<BoardFilterSheet
					visible={filterOpen}
					onDismiss={() => setFilterOpen(false)}
					filter={filter}
					onChange={setFilter}
					members={members}
					labels={activeHome?.labels ?? []}
					locations={locations}
					showEveryone={filtered.showEveryone}
					onShowEveryone={filtered.setShowEveryone}
					returnFocusTo={filterAnchor}
				/>
			) : null}

			<Snackbar visible={notice.showing} onDismiss={notice.dismiss}>
				{t("board.gone")}
			</Snackbar>
		</View>
	);
}
