import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import {
	ActivityIndicator,
	Button,
	FAB,
	Snackbar,
	Text,
} from "react-native-paper";
import { BoardColumn } from "@/components/board/BoardColumn";
import { boardHref, detailsHref } from "@/components/board/board-href";
import { CardMenu, type Notice } from "@/components/board/CardMenu";
import { ColumnStrip } from "@/components/board/ColumnStrip";
import { TitleDialog } from "@/components/board/TitleDialog";
import { useAuth } from "@/contexts/AuthContext";
import { createNode } from "@/data/nodes";
import {
	hasSteps,
	type Node,
	rankAtEnd,
	type Status,
	visibleColumns,
} from "@/models/node";
import { useAppTheme } from "@/theme";
import { compactBreakpoint, size, space, touchTarget } from "@/theme/tokens";

interface BoardProps {
	homeId: string;
	/** The card this board belongs to, or null for the root board. */
	parent: Node | null;
	/** The frozen column set: the parent's `columns`, or `defaultColumns`. */
	columns: readonly Status[];
	nodes: Node[];
	loading: boolean;
	/**
	 * True once the board's listeners gave up, which makes `nodes` the last thing
	 * that arrived rather than what is on the board.
	 *
	 * The empty state has to give way to it. "Nothing here yet. Add the first
	 * card." is the same sentence whether the board is empty or unreadable, and
	 * on the second one it invites a duplicate of a card that is already there.
	 */
	failed?: boolean;
	/** Opens the board's listeners again after they gave up. */
	onRetry?: () => void;
	/**
	 * The cards the default-hide filter is holding back, so the board can say so
	 * rather than draw as though they were not there.
	 *
	 * A board whose every card is somebody else's personal project is not a board
	 * with nothing on it, and "add the first card" is a lie with a toggle sitting
	 * two taps away that disproves it. The same is true one column at a time,
	 * which is what a compact pane shows.
	 */
	hidden?: Node[];
}

/**
 * One board component, used at every depth. `PROJECT.md`: resist per-level
 * special cases, they multiply.
 *
 * **Below `compactBreakpoint`** it is one column at a time, chosen by the strip
 * of chips above it. **At the breakpoint and above** the columns sit side by
 * side and the board scrolls horizontally; the headers say what the strip says,
 * so the strip is not rendered.
 *
 * The pane on screen is **state, set only by a tap on a chip** — it is never
 * read back from a scroll position. It was a swipeable pager, and the pager is
 * what broke it: the browser moves a scroll-snapping container on its own, to
 * re-snap after content changes and to bring a focused element into view, so
 * the board drifted to whichever column a card happened to land in. Twelve
 * cards added in a row from a FAB that said "Add to To do" went to In progress
 * and Next up, alternately — the Marcus-forty-cards Saturday morning this
 * feature exists for. Swiping between columns is worth having back, but not at
 * the price of cards landing in a column nobody chose.
 *
 * A board **always opens on its first column** rather than restoring the last
 * pane anyone was on. Where you were on a board is not something anyone
 * remembers, and a board that opens somewhere unexpected reads as the wrong
 * board.
 */
export function Board({
	homeId,
	parent,
	columns,
	nodes,
	loading,
	failed = false,
	onRetry,
	hidden = noneHidden,
}: BoardProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();
	const { user } = useAuth();

	const [boardWidth, setBoardWidth] = useState(0);
	const [current, setCurrent] = useState(0);
	const [adding, setAdding] = useState<Status | null>(null);
	const [notice, setNotice] = useState<Notice | null>(null);

	// A board always opens on its first column. Cleared during render, because
	// one screen can become another board — a breadcrumb re-points the screen it
	// is on — and carrying the last pane anyone swiped to into a different board
	// makes it read as the wrong board.
	const board = `${homeId} ${parent?.id ?? ""}`;
	const [rendered, setRendered] = useState(board);
	if (rendered !== board) {
		setRendered(board);
		setCurrent(0);
	}

	// The frozen set, plus a column for any status that is on this board but not
	// in it. A card that exists is visible somewhere — including one the filter
	// is holding back, which would otherwise have no column to be counted in.
	const shown = useMemo(
		() => visibleColumns(columns, [...nodes, ...hidden]),
		[columns, nodes, hidden],
	);
	const compact = boardWidth > 0 && boardWidth < compactBreakpoint;
	// An extra column disappearing would otherwise leave the pane showing a
	// column that is no longer there.
	const column = Math.min(current, shown.length - 1);
	const onScreen: Status | undefined = shown[column];

	const cardsIn = (status: Status) =>
		nodes.filter((node) => node.status === status);

	const hiddenIn = (status: Status) =>
		hidden.filter((node) => node.status === status).length;

	/**
	 * Queued, never awaited: the card is on the board the instant Firestore
	 * applies it locally, and the write lands when the connection does.
	 * `createNode` logs its own failure.
	 */
	const add = (title: string) => {
		if (user === null || adding === null) return;

		const last = cardsIn(adding).at(-1)?.rank ?? null;
		createNode(homeId, user.uid, {
			title,
			rank: rankAtEnd(last),
			parent,
			status: adding,
		});
	};

	/**
	 * A tap opens the card **as a board** once it has a step in it, and as its
	 * details until then. A node is a board because it has children, so a card
	 * with none has nothing to open — an empty board reads as a bug rather than
	 * as an empty board, and the chevron on the card already says which of the
	 * two a tap will do.
	 */
	const open = (node: Node) => {
		router.push(hasSteps(node) ? boardHref(node.id) : detailsHref(node.id));
	};

	const menu = (node: Node) => (
		<CardMenu
			homeId={homeId}
			node={node}
			parent={parent}
			columns={columns}
			nodes={nodes}
			onNotice={setNotice}
			// The only way in for a card that *is* a board, where a tap drills in.
			onDetails={() => router.push(detailsHref(node.id))}
		/>
	);

	return (
		<View
			style={{ flex: 1 }}
			onLayout={(event) => setBoardWidth(event.nativeEvent.layout.width)}
		>
			{loading ? (
				<ActivityIndicator
					accessibilityLabel={t("common.loading")}
					style={{ marginTop: space.xl }}
				/>
			) : null}

			{/* Said whether or not any cards arrived. The board is two listeners and
			    only one of them has to fail, so a board that looks ordinary can be
			    missing every shared card on it — and a half board that says nothing
			    is the one a card gets added to twice. */}
			{failed ? (
				<View style={{ gap: space.md, paddingBottom: space.md }}>
					<Text
						variant="bodyLarge"
						style={{
							color: theme.colors.onSurfaceVariant,
							textAlign: "center",
							paddingHorizontal: space.md,
						}}
					>
						{t("board.loadFailed")}
					</Text>
					{onRetry ? (
						<Button
							mode="contained-tonal"
							icon="refresh"
							onPress={onRetry}
							contentStyle={{ minHeight: touchTarget }}
							style={{ alignSelf: "center" }}
						>
							{t("common.retry")}
						</Button>
					) : null}
				</View>
			) : null}

			{/* Not while `failed`: "add the first card" and "could not load" are
			    contradictory instructions, and only one of them is true. */}
			{!loading && !failed && nodes.length === 0 ? (
				<Text
					variant="bodyLarge"
					style={{
						color: theme.colors.onSurfaceVariant,
						textAlign: "center",
						paddingHorizontal: space.md,
						paddingBottom: space.md,
					}}
				>
					{t(hidden.length > 0 ? "board.allHidden" : "board.empty")}
				</Text>
			) : null}

			{boardWidth === 0 ? null : compact ? (
				<>
					<ColumnStrip
						columns={shown}
						nodes={nodes}
						current={column}
						onSelect={setCurrent}
					/>
					{onScreen === undefined ? null : (
						<BoardColumn
							status={onScreen}
							nodes={cardsIn(onScreen)}
							width="100%"
							wide={false}
							hiddenCount={hiddenIn(onScreen)}
							onAdd={() => setAdding(onScreen)}
							onOpen={open}
							renderMenu={menu}
						/>
					)}
				</>
			) : (
				<ScrollView
					horizontal
					style={{ flex: 1 }}
					contentContainerStyle={{
						flexGrow: 1,
						gap: space.md,
						paddingHorizontal: space.md,
					}}
				>
					{shown.map((status) => (
						<BoardColumn
							key={status}
							status={status}
							nodes={cardsIn(status)}
							width={size.boardColumn}
							wide
							hiddenCount={hiddenIn(status)}
							onAdd={() => setAdding(status)}
							onOpen={open}
							renderMenu={menu}
						/>
					))}
				</ScrollView>
			)}

			{/* One FAB below the breakpoint, naming its destination in words. The
			    column it adds to is the one on screen, so "Add to To do" is a
			    promise the board can keep. */}
			{compact && onScreen !== undefined ? (
				<FAB
					icon="plus"
					label={t("board.addTo", { column: t(`status.${onScreen}`) })}
					onPress={() => setAdding(onScreen)}
					style={{
						position: "absolute",
						right: space.md,
						bottom: space.md,
					}}
				/>
			) : null}

			<TitleDialog
				visible={adding !== null}
				onDismiss={() => setAdding(null)}
				heading={t("board.newCard")}
				confirmLabel={t("board.add")}
				onSubmit={add}
				testID={newCardDialogTestID}
			/>

			{/* The destination of a move is off-screen by definition — saying
			    nothing makes it read as a delete. */}
			<Snackbar
				visible={notice !== null}
				onDismiss={() => setNotice(null)}
				action={
					notice?.undo
						? {
								label: t("common.undo"),
								onPress: () => {
									notice.undo?.();
									setNotice(null);
								},
							}
						: undefined
				}
			>
				{notice?.text ?? ""}
			</Snackbar>
		</View>
	);
}

const newCardDialogTestID = "new-card-dialog";

const noneHidden: Node[] = [];
