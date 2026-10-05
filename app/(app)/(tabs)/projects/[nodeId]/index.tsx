import { useIsFocused } from "@react-navigation/native";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWindowDimensions, View } from "react-native";
import { ActivityIndicator, Snackbar } from "react-native-paper";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { Board } from "@/components/board/Board";
import {
	BoardFilterAction,
	BoardFilterSheet,
} from "@/components/board/BoardFilterSheet";
import { BoardMenu } from "@/components/board/BoardMenu";
import { Breadcrumbs } from "@/components/board/Breadcrumbs";
import { boardHref, goneHref } from "@/components/board/board-href";
import { AppHeader } from "@/components/ui/AppHeader";
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
import { denseBreakpoint, space } from "@/theme/tokens";
import { goBack } from "@/utils/navigation";

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
	const { width } = useWindowDimensions();
	const dense = width < denseBreakpoint;
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
	const filterSet =
		filter !== null &&
		(filter.conditions.length > 0 || filter.reach === "subtree");

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
			{/* Back to wherever the push came from, or to the parent board
			    with no history. Dismissing on back could skip the source board. */}
			{/* The label names where the arrow *goes*, which is the parent card
			    at every depth but one — not "Projects". */}
			{/* No `subtitle`: Paper renders it only outside Material 3, so the
			    home's name lives on the root board's app bar and one crumb away
			    — the first crumb goes there. */}
			<AppHeader
				title={node?.title ?? ""}
				leading={
					<BackAction
						accessibilityLabel={t("board.up")}
						onPress={() =>
							goBack(boardHref(node?.parentId ?? null), "dismissTo")
						}
					/>
				}
			>
				{showFilterAction && !dense ? (
					<BoardFilterAction
						set={filterSet}
						onPress={() => setFilterOpen(true)}
						anchorRef={filterAnchor}
					/>
				) : null}
				{node !== null ? (
					<BoardMenu
						homeId={homeId}
						node={node}
						onFilter={
							showFilterAction && dense ? () => setFilterOpen(true) : undefined
						}
						filterSet={showFilterAction && dense && filterSet}
						anchorRef={dense ? filterAnchor : undefined}
					/>
				) : null}
				<AccountMenu />
			</AppHeader>

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
