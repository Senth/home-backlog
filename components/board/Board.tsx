import { useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	type NativeScrollEvent,
	type NativeSyntheticEvent,
	ScrollView,
	View,
} from "react-native";
import { ActivityIndicator, FAB, Snackbar, Text } from "react-native-paper";
import { BoardColumn } from "@/components/board/BoardColumn";
import { CardMenu, type Notice } from "@/components/board/CardMenu";
import { ColumnStrip } from "@/components/board/ColumnStrip";
import { TitleDialog } from "@/components/board/TitleDialog";
import { useAuth } from "@/contexts/AuthContext";
import { createNode } from "@/data/nodes";
import {
	type Node,
	rankAtEnd,
	type Status,
	visibleColumns,
} from "@/models/node";
import { useAppTheme } from "@/theme";
import { compactBreakpoint, size, space } from "@/theme/tokens";

interface BoardProps {
	homeId: string;
	/** The card this board belongs to, or null for the root board. */
	parent: Node | null;
	/** The frozen column set: the parent's `columns`, or `rootColumns`. */
	columns: readonly Status[];
	nodes: Node[];
	loading: boolean;
}

/**
 * One board component, used at every depth. `PROJECT.md`: resist per-level
 * special cases, they multiply.
 *
 * **Below `compactBreakpoint`** it is a horizontal pager, one column per screen,
 * with the column strip above it. **At the breakpoint and above** the columns
 * sit side by side and the board scrolls horizontally; the headers say what the
 * strip says, so the strip is not rendered.
 *
 * A board **always opens on its first column** rather than restoring the last
 * pane anyone swiped to. Where you were on a board is not something anyone
 * remembers, and a board that opens somewhere unexpected reads as the wrong
 * board.
 */
export function Board({ homeId, parent, columns, nodes, loading }: BoardProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();
	const { user } = useAuth();

	const [boardWidth, setBoardWidth] = useState(0);
	const [current, setCurrent] = useState(0);
	const [adding, setAdding] = useState<Status | null>(null);
	const [notice, setNotice] = useState<Notice | null>(null);
	const pager = useRef<ScrollView | null>(null);

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
	// in it. A card that exists is visible somewhere.
	const shown = useMemo(() => visibleColumns(columns, nodes), [columns, nodes]);
	const compact = boardWidth > 0 && boardWidth < compactBreakpoint;
	// An extra column disappearing under the pager would otherwise leave it
	// showing a pane that is no longer there.
	const column = Math.min(current, shown.length - 1);
	const onScreen: Status | undefined = shown[column];

	const cardsIn = (status: Status) =>
		nodes.filter((node) => node.status === status);

	const goTo = (index: number) => {
		setCurrent(index);
		pager.current?.scrollTo({ x: index * boardWidth, animated: true });
	};

	const onPagerScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
		if (boardWidth === 0) return;
		const index = Math.round(event.nativeEvent.contentOffset.x / boardWidth);
		if (index !== current) setCurrent(index);
	};

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

	const open = (node: Node) => {
		router.push({
			pathname: "/projects/[nodeId]",
			params: { nodeId: node.id },
		});
	};

	const menu = (node: Node) => (
		<CardMenu
			homeId={homeId}
			node={node}
			parent={parent}
			columns={columns}
			nodes={nodes}
			onNotice={setNotice}
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

			{!loading && nodes.length === 0 ? (
				<Text
					variant="bodyLarge"
					style={{
						color: theme.colors.onSurfaceVariant,
						textAlign: "center",
						paddingHorizontal: space.md,
						paddingBottom: space.md,
					}}
				>
					{t("board.empty")}
				</Text>
			) : null}

			{boardWidth === 0 ? null : compact ? (
				<>
					<ColumnStrip
						columns={shown}
						nodes={nodes}
						current={column}
						onSelect={goTo}
					/>
					<ScrollView
						ref={pager}
						horizontal
						pagingEnabled
						showsHorizontalScrollIndicator={false}
						onScroll={onPagerScroll}
						scrollEventThrottle={pagerScrollThrottleMs}
						style={{ flex: 1 }}
						// `flexGrow` is what gives the content container the scroll
						// view's own height, which is what a full-height column then
						// stretches to. Without it every column collapses to the height
						// of its cards and the empty ones vanish.
						contentContainerStyle={{ flexGrow: 1 }}
					>
						{shown.map((status) => (
							<BoardColumn
								key={status}
								status={status}
								nodes={cardsIn(status)}
								width={boardWidth}
								wide={false}
								onAdd={() => setAdding(status)}
								onOpen={open}
								renderMenu={menu}
							/>
						))}
					</ScrollView>
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

/** 16 ms — one frame. The pager's current pane is read from the scroll offset. */
const pagerScrollThrottleMs = 16;
