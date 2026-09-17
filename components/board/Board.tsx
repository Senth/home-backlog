import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Animated, ScrollView, View } from "react-native";
import {
	ActivityIndicator,
	Button,
	FAB,
	Snackbar,
	Surface,
	Text,
} from "react-native-paper";
import { BlockerWatcher } from "@/components/board/BlockerWatcher";
import { BoardCard } from "@/components/board/BoardCard";
import { BoardColumn } from "@/components/board/BoardColumn";
import { boardHref, detailsHref } from "@/components/board/board-href";
import { CardMenu, type Notice } from "@/components/board/CardMenu";
import { ColumnStrip } from "@/components/board/ColumnStrip";
import { columnWidth } from "@/components/board/column-width";
import { TitleDialog } from "@/components/board/TitleDialog";
import {
	boardKey,
	type ColumnDrag,
	useBoardDrag,
} from "@/components/board/use-board-drag";
import { useAuth } from "@/contexts/AuthContext";
import { useHome } from "@/contexts/HomeContext";
import { createNode } from "@/data/nodes";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import {
	crossBoardBlockerIds,
	hasSteps,
	type Node,
	rankAtEnd,
	type Status,
	visibleColumns,
} from "@/models/node";
import { useAppTheme } from "@/theme";
import {
	cardGutterBreakpoint,
	compactBreakpoint,
	contentWidth,
	denseBreakpoint,
	drag as dragTokens,
	elevation,
	fab as fabTokens,
	radius,
	space,
	touchTarget,
} from "@/theme/tokens";

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
	/**
	 * The label ids every card on this board inherits from the trail above it
	 * (#100) — the board node and its ancestors, resolved once by the screen
	 * that already holds them. See `BoardCard`.
	 */
	ancestorLabelIds?: readonly string[];
	/**
	 * The nearest place the board's own chain passes down (#290) — the board
	 * node itself first, then its ancestors, resolved once by the screen.
	 * See `BoardCard`.
	 */
	ancestorLocationId?: string | null;
	/** Location id → title, the leaf. See `BoardCard`. */
	locations?: ReadonlyMap<string, string>;
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
	ancestorLabelIds,
	ancestorLocationId,
	locations,
}: BoardProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();
	const { user } = useAuth();
	// The household, for a new project's participants. Already on screen: no
	// listener and no read, the same source both people-controls are built from.
	const { activeHome } = useHome();
	// docs/DESIGN.md § Motion: with the query on, the drag does everything but
	// move on its own — no lift, no edge fill, and the spring in the hook.
	const reduced = useReducedMotion();

	const [boardWidth, setBoardWidth] = useState(0);
	const [fabHeight, setFabHeight] = useState(0);
	const [current, setCurrent] = useState(0);
	const [adding, setAdding] = useState<Status | null>(null);
	const [notice, setNotice] = useState<Notice | null>(null);

	/**
	 * What the watcher has answered for the blockers this board's own query
	 * pair cannot see: the loaded documents, and `null` for one the server
	 * confirmed gone. Absent means *not heard from yet*, which keeps the card
	 * waiting — the not-yet direction.
	 */
	const [watched, setWatched] = useState<Map<string, Node | null>>(new Map());
	// One identity, so a watcher's report never tears its listener down.
	const watch = useCallback((id: string, blocker: Node | null) => {
		setWatched((prev) => {
			if (prev.get(id) === blocker) return prev;
			const next = new Map(prev);
			next.set(id, blocker);
			return next;
		});
	}, []);

	// A board always opens on its first column. Cleared during render, because
	// one screen can become another board — a breadcrumb re-points the screen it
	// is on — and carrying the last pane anyone swiped to into a different board
	// makes it read as the wrong board. The watcher's answers go with it: they
	// belong to the board they were read for.
	const board = `${homeId} ${parent?.id ?? ""}`;
	const [rendered, setRendered] = useState(board);
	if (rendered !== board) {
		setRendered(board);
		setCurrent(0);
		setWatched(new Map());
	}

	// The blocker ids the board's own nodes cannot resolve. When the list
	// shrinks — the last reference to an off-board card went away — its watcher
	// goes with it, and the stale answer is dropped here in render the way the
	// pane reset above is.
	const crossIds = useMemo(() => crossBoardBlockerIds(nodes), [nodes]);
	const stale = [...watched.keys()].filter((id) => !crossIds.includes(id));
	if (stale.length > 0) {
		setWatched((prev) => {
			const next = new Map(prev);
			for (const id of stale) next.delete(id);
			return next;
		});
	}

	/**
	 * What the cards resolve their waiting against: every node on the board,
	 * plus the watcher's cross-board documents.
	 */
	const blockers = useMemo(() => {
		const map = new Map<string, Node | null>();
		for (const node of nodes) map.set(node.id, node);
		for (const [id, blocker] of watched) map.set(id, blocker);
		return map;
	}, [nodes, watched]);

	// The frozen set, plus a column for any status that is on this board but not
	// in it. A card that exists is visible somewhere — including one the filter
	// is holding back, which would otherwise have no column to be counted in.
	const shown = useMemo(
		() => visibleColumns(columns, [...nodes, ...hidden]),
		[columns, nodes, hidden],
	);
	const compact = boardWidth > 0 && boardWidth < compactBreakpoint;
	/**
	 * Below `cardGutterBreakpoint` the card's gutters give back their room: the
	 * left one narrows, the right one disappears and the menu floats. The board
	 * width is the viewport's stand-in, the same proxy `compact` rides on — and
	 * the breakpoint is far under `compactBreakpoint`, so this only ever bites
	 * a phone at 200% text.
	 */
	const narrow = boardWidth > 0 && boardWidth < cardGutterBreakpoint;
	/**
	 * How far the last card in a pane has to stop short of the FAB: the band the
	 * FAB occupies — the height it actually measured, plus the `space.md` it
	 * floats above the bottom edge — and then one `space.md` of daylight.
	 *
	 * The band alone leaves the last card's bottom edge *exactly* on the FAB's
	 * top edge. Nothing overlaps, and it still reads as a button resting on a
	 * card: there is no gap for a shadow, a focus ring or a half pixel of scroll
	 * to live in. The third term is what makes the card clear of the FAB rather
	 * than merely not under it.
	 *
	 * Measured rather than assumed. The FAB names its destination in words, so it
	 * is taller in Swedish than in English and taller again at 200% text, and the
	 * `space.xxl` that used to stand here was a guess that stopped clearing the
	 * last card the moment either of those was true. `space.xxl` survives only as
	 * the value for the single frame before the FAB has laid itself out.
	 *
	 * The FAB's own offset is the first term rather than a constant, because the
	 * button rises while a snackbar is up. Reserving the resting clearance while
	 * it is parked 56dp higher puts it back over the last card for exactly as
	 * long as the undo is on screen — which is the defect this inset replaced.
	 */
	const fabBottom = notice === null ? space.md : space.xxl + space.lg;
	const fabInset = fabHeight > 0 ? fabHeight + fabBottom + space.md : space.xxl;
	// An extra column disappearing would otherwise leave the pane showing a
	// column that is no longer there.
	const column = Math.min(current, shown.length - 1);
	const onScreen: Status | undefined = shown[column];

	const drag = useBoardDrag({
		homeId,
		nodes,
		shown,
		onNotice: setNotice,
		// Only below the breakpoint: above it every column is already on screen,
		// so there is nowhere for an edge hold to walk to. The pane it sets is the
		// same state a chip tap sets — deliberate input, never read back from a
		// scroll position — so the board simply stays where the drag left it.
		pane: compact
			? { index: column, count: shown.length, onChange: setCurrent }
			: undefined,
	});

	// The frozen order while a card is up, the live one otherwise. A board is two
	// listeners, and a card arriving mid-drag would move the gap out from under
	// the finger.
	const cardsIn = (status: Status) =>
		drag.cards.filter((node) => node.status === status);

	const columnDrag = (status: Status): ColumnDrag => ({
		node: drag.node,
		gapAt: drag.over?.status === status ? drag.over.index : null,
		gapHeight: drag.overlay?.height ?? space.none,
		register: drag.register,
		handlers: drag.handlers,
	});

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
			// A shared project is born with the whole household on it, so the
			// participant checkboxes say something true the first time somebody
			// opens them — and so that a member who joins later is a decision the
			// inviter makes rather than a silent addition to everything. A card
			// created on any other board is a step, and a step is never a root:
			// it keeps `[]`, which is still what `[]` means below the root.
			participantIds:
				parent === null ? Object.keys(activeHome?.members ?? {}) : undefined,
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
			blockers={blockers}
			onNotice={setNotice}
			// The only way in for a card that *is* a board, where a tap drills in.
			onDetails={() => router.push(detailsHref(node.id))}
		/>
	);

	return (
		<View
			ref={drag.register(boardKey)}
			collapsable={false}
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

			{/* Not while `loading`: an empty column strip under the spinner is the
			    "empty board before the data arrives" of #266, and the first launch
			    is exactly the launch the cache has nothing for. */}
			{loading || boardWidth === 0 ? null : compact ? (
				<>
					<ColumnStrip
						columns={shown}
						// The frozen board, like the panes below it: a count that moves
						// while the pane under it does not is the strip contradicting the
						// column it names.
						nodes={drag.cards}
						current={column}
						onSelect={setCurrent}
						register={drag.register}
						dropOn={drag.over?.via === "chip" ? drag.over.status : null}
					/>
					{shown.map((status) => {
						const visible = status === onScreen;
						// The pane a lifted card came from keeps its cards while the
						// card is in the air, even once the board has walked past it.
						//
						// An edge hold moves the board to the next pane, and on a touch
						// screen the gesture *is* the card's own element: the browser
						// sends every later touch to the node the finger landed on, and
						// a node that has been unmounted receives them where nothing can
						// hear. The card would stick to the screen halfway across the
						// board. Every other pane stays what it always was — a column
						// shell with nothing in it.
						const carrying = drag.node?.status === status;

						return (
							<View
								key={status}
								// A pane that is only mounted is not a pane anybody is on,
								// and hiding it from eyes alone is not hiding it: a
								// scrollable box stays in the browser's tab order however
								// transparent it is, and `aria-hidden` does not take it out
								// — so Tab walked into three invisible columns and the focus
								// ring went with it. `display: none` is the one that takes a
								// subtree out of layout, out of the tab order and out of the
								// accessibility tree at once.
								//
								// The exception is the pane holding a card that is in the
								// air, which stays laid out at no size because the browser
								// sends every touch of that drag to an element inside it.
								style={
									visible ? { flex: 1 } : carrying ? offScreenPane : hiddenPane
								}
								collapsable={false}
								aria-hidden={!visible}
								accessibilityElementsHidden={!visible}
								importantForAccessibility={
									visible ? "auto" : "no-hide-descendants"
								}
							>
								<BoardColumn
									status={status}
									nodes={visible || carrying ? cardsIn(status) : noCards}
									width="100%"
									wide={false}
									narrow={narrow}
									bottomInset={fabInset}
									hiddenCount={visible ? hiddenIn(status) : undefined}
									onAdd={() => setAdding(status)}
									onOpen={open}
									renderMenu={menu}
									drag={columnDrag(status)}
									blockers={blockers}
									ancestorLabelIds={ancestorLabelIds}
									ancestorLocationId={ancestorLocationId}
									locations={locations}
								/>
							</View>
						);
					})}
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
							// The columns divide the board rather than taking a fixed
							// slice of it, so four fit a laptop and a wide monitor is
							// not half empty. More columns than fit keep the minimum
							// and the board scrolls, as it always did.
							width={columnWidth(boardWidth, shown.length)}
							wide
							narrow={narrow}
							hiddenCount={hiddenIn(status)}
							onAdd={() => setAdding(status)}
							onOpen={open}
							renderMenu={menu}
							drag={columnDrag(status)}
							blockers={blockers}
							ancestorLabelIds={ancestorLabelIds}
							ancestorLocationId={ancestorLocationId}
							locations={locations}
						/>
					))}
				</ScrollView>
			)}

			{/* The edge a held card is resting in, filling as the pane it would
			    switch to gets closer. The switch is never a surprise, and the fill
			    restarting visibly is what says a *second* one is coming — those are
			    the dangerous ones, and they get the longer window.

			    Under reduced motion the walk keeps its timing — the pane still
			    arrives — but the filling bar is the animated half, so it is the
			    part that goes. */}
			{drag.edge === null || reduced ? null : (
				<Animated.View
					style={{
						position: "absolute",
						top: space.none,
						bottom: space.none,
						left: drag.edge === "left" ? space.none : undefined,
						right: drag.edge === "right" ? space.none : undefined,
						// Filling in from the edge rather than fading: what it is
						// counting down is a switch, and a bar says how long is left.
						width: drag.dwell.interpolate({
							inputRange: [0, 1],
							outputRange: [space.none, dragTokens.edgeZone],
						}),
						backgroundColor: theme.colors.primaryContainer,
						pointerEvents: "none",
					}}
				/>
			)}

			{/* The card itself, off the board and under the hand. Nothing else is
			    drawn under the finger — the gap the other cards leave is the whole
			    indicator, which is what survives a three-line card at 200% text and
			    a thumb covering most of the pane. */}
			{drag.node !== null && drag.overlay !== null ? (
				<Animated.View
					style={{
						position: "absolute",
						// The card is a picture under the hand: everything it passes
						// over stays reachable by the hit test underneath it.
						pointerEvents: "none",
						left: drag.overlay.left,
						top: drag.overlay.top,
						width: drag.overlay.width,
						transform: [
							{ translateX: drag.offset.x },
							{ translateY: drag.offset.y },
							// The lift scales the card off the board; reduced motion
							// keeps it at the size it was, following the finger only.
							...(reduced ? [] : [{ scale: dragTokens.lift }]),
						],
					}}
				>
					{/* `boardCard` on the surface as well as on the card: Paper fills a
					    `Surface` with an elevation tint, and it is the corners of the
					    card that would show it — a lifted card must not be a different
					    shade from the gap it left. `wide` matches the row underneath,
					    or the title would resize as the card leaves the board. The
					    menu rides along for the same reason: its rail is `touchTarget`
					    wide, and without it the title re-wraps and the card lands a
					    different height (#135). The overlay is `pointerEvents: "none"`,
					    so the rail's button is as inert as the rest of the picture. */}
					<Surface
						elevation={elevation.high}
						style={{
							backgroundColor: theme.colors.boardCard,
							borderRadius: radius.md,
						}}
					>
						<BoardCard
							node={drag.node}
							onOpen={noop}
							menu={menu(drag.node)}
							wide={!compact}
							narrow={narrow}
							blockers={blockers}
							ancestorLabelIds={ancestorLabelIds}
							ancestorLocationId={ancestorLocationId}
							locations={locations}
						/>
					</Surface>
				</Animated.View>
			) : null}

			{/* One FAB below the breakpoint, naming its destination in words. The
			    column it adds to is the one on screen, so "Add to To do" is a
			    promise the board can keep.

			    Two caps on its footprint, both so the button never becomes the
			    biggest thing on the screen:

			    - `maxWidth` is a share of the board the FAB floats over. Wide
			      enough to be a no-op at a phone's full width; at 200% text, where
			      the window is 195px and the Swedish label once claimed 91.8% of
			      it, the label wraps instead and the words stay.
			    - Below `denseBreakpoint` the plus glyph gives way to those words:
			      with the icon kept, a wrapped Swedish label would need three
			      lines and overflow the button's own box. The glyph is the part
			      the claim can afford to lose — the words are the affordance.

			    The height does not change, so the measured inset below keeps its
			    arithmetic — a taller box here would be a second, silent change to
			    the pane's bottom padding. */}
			{compact && !loading && onScreen !== undefined ? (
				<FAB
					icon={boardWidth < denseBreakpoint ? undefined : "plus"}
					label={t("board.addTo", { column: t(`status.${onScreen}`) })}
					onPress={() => setAdding(onScreen)}
					// What the pane above pads its bottom by. The label is a
					// translated sentence at the reader's own text size, so nothing
					// short of measuring it is right in both locales.
					onLayout={(event) => setFabHeight(event.nativeEvent.layout.height)}
					style={{
						position: "absolute",
						right: space.md,
						// Above the snackbar while there is one. Undo is not decoration
						// here — it is the way back from a gesture that can move a card
						// somebody did not mean to move — and a FAB parked on top of it
						// is the one control that must never be covered.
						bottom: fabBottom,
						maxWidth: boardWidth * fabTokens.widthShare,
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

			{/* One invisible listener per cross-board blocker id — a card's mark
			    needs the blocker's status, and a blocker living on another board
			    is not in anything this screen already holds. Deduped, and torn
			    down with the screen. */}
			<BlockerWatcher homeId={homeId} ids={crossIds} onStatus={watch} />

			{/* The destination of a move is off-screen by definition — saying
			    nothing makes it read as a delete. */}
			<Snackbar
				visible={notice !== null}
				onDismiss={() => setNotice(null)}
				// Material caps a snackbar well short of the window. Left to stretch,
				// a wide monitor gets "Moved down" and "Undo" pinned to opposite ends
				// of two metres of empty bar.
				style={{
					maxWidth: contentWidth.snackbar,
					alignSelf: "center",
					marginBottom: space.md,
				}}
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

/** A pane that is mounted and has nothing in the air: gone, in every sense. */
const hiddenPane = { display: "none" } as const;

/**
 * The pane a lifted card came from, once the board has walked past it. Not
 * `display: none`: it has to keep receiving the browser's touches, and it only
 * does that while it is really laid out.
 */
const offScreenPane = {
	position: "absolute",
	width: space.none,
	height: space.none,
	overflow: "hidden",
	opacity: 0,
} as const;

const noCards: Node[] = [];

/** The lifted card is a picture of a card; the tap belongs to the one it left. */
const noop = () => {};

const noneHidden: Node[] = [];
