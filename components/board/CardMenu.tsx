import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { IconButton, Menu, Text } from "react-native-paper";
import { TitleDialog } from "@/components/board/TitleDialog";
import { LabelPicker } from "@/components/label/LabelPicker";
import { BlockerSearchDialog } from "@/components/node/BlockerSearchDialog";
import { ConfirmDialog } from "@/components/ui/AppDialog";
import { useAuth } from "@/contexts/AuthContext";
import {
	boardOnce,
	deleteNode,
	getNode,
	moveErrorKey,
	moveNode,
	reparentNode,
	updateNode,
} from "@/data/nodes";
import { useAnchorFocusGuard, useTabTrap } from "@/hooks/use-modal-focus";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { type Node, rankAtEnd, rankBetween, type Status } from "@/models/node";
import { useAppTheme } from "@/theme";
import { icon, size, space, touchTarget } from "@/theme/tokens";

/** A message the board says after an action, with the way back if there is one. */
export interface Notice {
	text: string;
	undo?: () => void;
}

interface CardMenuProps {
	homeId: string;
	node: Node;
	/** The card this board belongs to, or null on the root board. */
	parent: Node | null;
	/**
	 * The board's **frozen** column set, which is what the move list offers. A
	 * column that only exists because a card is sitting in it is a one-way exit,
	 * never a destination.
	 */
	columns: readonly Status[];
	/** Every card on this board, in `(rank, id)` order. */
	nodes: Node[];
	/**
	 * What a chosen blocker's title is read from — the board's own nodes plus
	 * the watcher's cross-board documents. Same-board picks need nothing from
	 * the server; that is what makes them work offline.
	 */
	blockers: ReadonlyMap<string, Node | null>;
	onNotice: (notice: Notice) => void;
	/**
	 * Opening the card's details. Here as well as on the tap, because a card that
	 * *is* a board takes the tap to drill into — so this is the only way in.
	 */
	onDetails: () => void;
}

type Page = "root" | "move" | "position" | "under" | "waiting";

/** `null` is the top level; `"up"` is the board above this one. */
type Destination = Node | null | "up";

/**
 * Everything a card can do except open, which is what tapping it already means.
 *
 * The menu changes *page* rather than opening a submenu: a column with thirty
 * cards is a list you scroll rather than a second overlay to dismiss. Paper
 * measures the menu once and never again, so a page is scrolled by this
 * component and not by `Menu` — see `rootPageHeight`.
 *
 * **Offline.** Move, position and rename queue optimistically, which is what a
 * board in a shed needs. `Move under…` and `Delete` require a connection and say
 * so: both read from the server on purpose, because "no children in the cache"
 * is not "no children" — a cold cache would let a subtree delete miss
 * descendants and orphan them.
 */
export function CardMenu({
	homeId,
	node,
	parent,
	columns,
	nodes,
	blockers,
	onNotice,
	onDetails,
}: CardMenuProps) {
	const { t } = useTranslation();
	const { user } = useAuth();
	const online = useOnlineStatus();

	const [open, setOpen] = useState(false);
	const [page, setPage] = useState<Page>("root");
	const [renaming, setRenaming] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [searching, setSearching] = useState(false);
	const [labelling, setLabelling] = useState(false);
	const anchor = useRef<View | null>(null);
	/**
	 * How tall the root page is, which is the only height Paper ever measured.
	 *
	 * `Menu` measures its content once, as it opens, and positions itself from
	 * that — it never measures again. A later page with a card per row is taller
	 * than the root page it was measured at, so it hangs off the bottom of the
	 * window: the document grows past the viewport, the whole app scrolls behind
	 * the open menu, and the app bar goes with it. Holding every other page to
	 * this height keeps the one measurement true.
	 */
	const [rootPageHeight, setRootPageHeight] = useState<number | undefined>(
		undefined,
	);

	/**
	 * Stable on purpose, and not a micro-optimisation.
	 *
	 * Paper attaches its Escape handler to `document` once, inside `show()`, and
	 * tears it down from an effect whose dependency chain ends at `onDismiss`
	 * (`Menu.tsx`: `handleKeypress` → `removeListeners` → the effect). Nothing
	 * re-attaches it except opening the menu again. So with a fresh `close` each
	 * render, *any* re-render while the menu is open killed Escape — which this
	 * menu does to itself every time it changes page, and which a card arriving
	 * on the board did to it from outside. One identity, and the handler lives as
	 * long as the menu does.
	 */
	const close = useCallback(() => {
		setOpen(false);
		setPage("root");
	}, []);

	// Paper focuses the first card's menu button when the board mounts, closed
	// menus and all — the same unasked focus `useAnchorFocusGuard` exists for.
	useAnchorFocusGuard(anchor);
	// The menu is what the user is answering while it is open: Tab stays inside
	// it instead of walking onto the board behind it. The surface is this
	// wrapper, not Paper's own — the plan does not rely on `Menu` forwarding a
	// `testID` to its Surface.
	useTabTrap(open, `card-menu-${node.id}`);

	const column = nodes.filter((card) => card.status === node.status);
	const index = column.findIndex((card) => card.id === node.id);
	const others = column.filter((card) => card.id !== node.id);
	// A shared card under a private parent breaks the uniform-visibility
	// invariant, and the rules refuse it. Offering it would be offering a
	// permission error.
	const hosts = nodes.filter(
		(card) => card.id !== node.id && card.visibility === node.visibility,
	);

	/**
	 * The same-board candidates for *Waiting on…*, from cards already in hand —
	 * free, and working offline. Chosen blockers are listed above instead, and
	 * a done card blocks nothing, so it is no candidate.
	 */
	const waitingCandidates = nodes.filter(
		(card) =>
			card.id !== node.id &&
			card.status !== "done" &&
			!node.blockedBy.includes(card.id),
	);

	const failed = (reason: unknown) =>
		console.error("Could not move the card:", reason);

	/**
	 * A one-tap move that appends to the end of the destination column.
	 *
	 * The board **stays on the pane you are on** and says where the card went.
	 * Following it would drag somebody moving six cards in a row seven panes
	 * sideways; saying nothing makes a move read as a delete, because the
	 * destination is off-screen. Undo restores the status *and* the rank, both of
	 * which are still in hand here.
	 */
	const moveTo = (status: Status) => {
		close();
		if (status === node.status) return;

		const last = nodes.filter((card) => card.status === status).at(-1);
		moveNode(homeId, node, status, rankAtEnd(last?.rank ?? null)).catch(failed);

		onNotice({
			text: t("board.moved", { column: t(`status.${status}`) }),
			undo: () => {
				moveNode(homeId, { ...node, status }, node.status, node.rank).catch(
					failed,
				);
			},
		});
	};

	/**
	 * Placing the card directly, rather than nudging it. Up / down / top / bottom
	 * cannot put a card at position three of thirty without twenty-seven taps.
	 */
	const moveWithin = (rank: string) => {
		close();
		moveNode(homeId, node, node.status, rank).catch(failed);
	};

	/**
	 * Re-parenting, which is what makes a board that was filled flat on a Saturday
	 * morning into projects without retyping any of it.
	 *
	 * The destination board is not on screen, and a rank is ordered within its
	 * `(parentId, status)` column — so it is read once for the neighbours the new
	 * rank is computed against. `reparentNode` already requires a connection and
	 * already reads the subtree from the server, so this changes nothing about
	 * when it works.
	 */
	const moveUnder = async (destination: Destination) => {
		close();
		if (user === null) return;

		try {
			const target =
				destination === "up"
					? parent?.parentId
						? await requireNode(homeId, parent.parentId)
						: null
					: destination;

			const board = await boardOnce(homeId, target?.id ?? null, user.uid);
			const last = board.filter((card) => card.status === node.status).at(-1);

			await reparentNode(
				homeId,
				node,
				target,
				rankAtEnd(last?.rank ?? null),
				user.uid,
			);
			onNotice({
				text: t("board.movedUnder", {
					title: target?.title ?? t("board.root"),
				}),
			});
		} catch (reason) {
			failed(reason);
			onNotice({ text: t(moveErrorKey(reason)) });
		}
	};

	const rename = (title: string) => {
		updateNode(homeId, node.id, { title }).catch((reason) => {
			console.error("Could not rename the card:", reason);
			onNotice({ text: t("error.saveFailed") });
		});
	};

	/**
	 * Pick or unpick a blocker. An ordinary `updateNode` write, which queues
	 * offline like every other field write — same-board picks work in a shed,
	 * and the mark updates from the local cache.
	 *
	 * The menu stays open: picking a second blocker means tapping it in the
	 * same page, and the chosen list above updates from the live node.
	 */
	const toggleBlocker = (id: string, add: boolean) => {
		const next = add
			? [...node.blockedBy, id]
			: node.blockedBy.filter((current) => current !== id);

		updateNode(homeId, node.id, { blockedBy: next }).catch((reason) => {
			console.error("Could not change what the card waits on:", reason);
			onNotice({ text: t("error.saveFailed") });
		});
	};

	/**
	 * A chosen blocker's label. Cross-board ones are known to the watcher, so
	 * by the time the page is open the title has usually arrived; while it has
	 * not, *Loading* says the row is real rather than a gone card.
	 */
	const blockerTitle = (id: string) => {
		const blocker = blockers.get(id);
		if (blocker === undefined) return t("common.loading");
		if (blocker === null) return t("board.gone");
		return blocker.title;
	};

	/**
	 * The card **and everything under it**, in one batch. A node whose parent is
	 * gone is unreachable from every board and every breadcrumb, so the subtree
	 * cannot be left behind.
	 */
	const remove = async () => {
		setDeleting(false);
		if (user === null) return;

		try {
			await deleteNode(homeId, node, user.uid);
		} catch (reason) {
			console.error("Could not delete the card:", reason);
			onNotice({ text: t("error.saveFailed") });
		}
	};

	return (
		<>
			<Menu
				visible={open}
				onDismiss={close}
				overlayAccessibilityLabel={t("common.closeMenu")}
				anchor={
					<View ref={anchor}>
						<IconButton
							icon="dots-vertical"
							// The glyph is small; the box around it is not. Shrinking the
							// pressable with it would put a gloved tap on the card
							// underneath and navigate off the board.
							size={icon.sm}
							accessibilityLabel={t("board.actions")}
							// Without this the card underneath takes the tap as well and
							// the menu opens on a board one level down.
							onPress={(event) => {
								event.stopPropagation();
								setOpen(true);
							}}
							style={{
								width: touchTarget,
								height: touchTarget,
								margin: space.none,
							}}
						/>
					</View>
				}
			>
				<View testID={`card-menu-${node.id}`}>
					{page === "root" ? (
						<View
							onLayout={(event) =>
								setRootPageHeight(event.nativeEvent.layout.height)
							}
						>
							<Menu.Item
								leadingIcon="information-outline"
								title={t("board.details")}
								onPress={() => {
									close();
									onDetails();
								}}
							/>
							<Menu.Item
								leadingIcon="arrow-right-bold-outline"
								title={t("board.moveTo")}
								onPress={() => setPage("move")}
							/>
							<Menu.Item
								leadingIcon="sort"
								title={t("board.changePosition")}
								onPress={() => setPage("position")}
								// One card is already in the only position it can be in.
								disabled={column.length < 2}
							/>
							<Menu.Item
								leadingIcon="file-tree-outline"
								title={t("board.moveUnder")}
								onPress={() => setPage("under")}
								disabled={!online || (hosts.length === 0 && parent === null)}
							/>
							<Menu.Item
								leadingIcon="pause-circle-outline"
								title={t("board.waitingOn")}
								onPress={() => setPage("waiting")}
							/>
							<Menu.Item
								leadingIcon="label-multiple-outline"
								title={t("board.labels")}
								onPress={() => {
									close();
									setLabelling(true);
								}}
							/>
							<Menu.Item
								leadingIcon="pencil-outline"
								title={t("board.rename")}
								onPress={() => {
									close();
									setRenaming(true);
								}}
							/>
							<Menu.Item
								leadingIcon="delete-outline"
								title={t("board.delete")}
								onPress={() => {
									close();
									setDeleting(true);
								}}
								disabled={!online}
							/>
							{/* Both of the disabled ones read from the server on purpose, so
						    the hint says what they need rather than letting the tap fail
						    after the fact. */}
							{online ? null : (
								<Menu.Item disabled title={t("board.offlineHint")} />
							)}
						</View>
					) : (
						/* One card per row, so these are the pages that outgrow the height
				   Paper measured — see `rootPageHeight`. They scroll inside it
				   instead of hanging off the bottom of the window. The token is
				   the fallback for the frames before the root page has measured:
				   layout beats the tap in practice, but the cap must not depend
				   on winning that race. */
						<ScrollView style={{ maxHeight: rootPageHeight ?? size.menuPage }}>
							{page === "move"
								? columns.map((status) => (
										<Menu.Item
											key={status}
											title={t(`status.${status}`)}
											onPress={() => moveTo(status)}
											disabled={status === node.status}
										/>
									))
								: null}

							{page === "position" ? (
								<>
									<Menu.Item
										title={t("board.positionTop")}
										onPress={() =>
											moveWithin(rankBetween(null, others[0]?.rank ?? null))
										}
										disabled={index === 0}
									/>
									{others.map((other, position) => (
										<Menu.Item
											key={other.id}
											title={t("board.positionAfter", { title: other.title })}
											onPress={() =>
												moveWithin(
													rankBetween(
														other.rank,
														others[position + 1]?.rank ?? null,
													),
												)
											}
											// The slot it is already in.
											disabled={column[index - 1]?.id === other.id}
										/>
									))}
								</>
							) : null}

							{page === "under" ? (
								<>
									{/* Up and Top are the same destination one level down from
								    the root, so only one of them is ever offered. */}
									{parent?.parentId ? (
										<Menu.Item
											title={t("board.moveUnderUp")}
											onPress={() => moveUnder("up")}
										/>
									) : null}
									{parent !== null ? (
										<Menu.Item
											title={t("board.moveUnderTop")}
											onPress={() => moveUnder(null)}
										/>
									) : null}
									{hosts.map((host) => (
										<Menu.Item
											key={host.id}
											title={host.title}
											onPress={() => moveUnder(host)}
										/>
									))}
								</>
							) : null}

							{page === "waiting" ? (
								<>
									{/* The chosen ones first, check-marked; tapping one
								    unpicks it. Titles come from the board's own nodes and
								    the watcher, so a cross-board one says its name too. */}
									{node.blockedBy.map((id) => (
										<Menu.Item
											key={id}
											leadingIcon="check"
											title={blockerTitle(id)}
											onPress={() => toggleBlocker(id, false)}
										/>
									))}

									{/* Same-board first, and visibly so — the group header is
								    the priority the picker wants seen without any help
								    text. Hidden when there is nothing to put under it. */}
									{waitingCandidates.length === 0 ? null : (
										<MenuLabel>{t("board.waitingGroupBoard")}</MenuLabel>
									)}
									{waitingCandidates.map((card) => (
										<Menu.Item
											key={card.id}
											title={card.title}
											onPress={() => toggleBlocker(card.id, true)}
										/>
									))}

									<MenuLabel>{t("board.waitingGroupEverywhere")}</MenuLabel>
									<Menu.Item
										leadingIcon="magnify"
										title={t("board.waitingSearch")}
										onPress={() => {
											close();
											setSearching(true);
										}}
										disabled={!online}
									/>
									{/* The search reads the server on purpose, so the hint
								    says what it needs rather than letting the tap fail
								    after the fact — exactly *Move under…*'s split. */}
									{online ? null : (
										<Menu.Item disabled title={t("board.offlineHint")} />
									)}
								</>
							) : null}
						</ScrollView>
					)}
				</View>
			</Menu>

			{/* Mounted only while open. Each dialog carries a `Portal`, which
			    registers with the portal host even when the modal inside it renders
			    nothing — and a Done column grows without bound until #64, so an
			    always-mounted pair would cost two portal entries and two focus-trap
			    subscriptions per card, re-rendered on every portal update. Paper's
			    own `Menu` does the same thing. */}
			{renaming ? (
				<TitleDialog
					visible
					onDismiss={() => setRenaming(false)}
					heading={t("board.renameTitle")}
					confirmLabel={t("board.rename")}
					initialTitle={node.title}
					onSubmit={rename}
					testID={`rename-card-${node.id}`}
					returnFocusTo={anchor}
				/>
			) : null}

			{deleting ? (
				<ConfirmDialog
					visible
					onDismiss={() => setDeleting(false)}
					onConfirm={remove}
					title={t("board.deleteTitle")}
					body={t("board.deleteBody")}
					confirmLabel={t("board.delete")}
					destructive
					testID={`delete-card-${node.id}`}
					returnFocusTo={anchor}
				/>
			) : null}

			{searching ? (
				<BlockerSearchDialog
					homeId={homeId}
					uid={user?.uid ?? null}
					node={node}
					onDismiss={() => setSearching(false)}
					onPick={(id) => toggleBlocker(id, true)}
					onUnpick={(id) => toggleBlocker(id, false)}
					testID={`blocker-search-${node.id}`}
					returnFocusTo={anchor}
				/>
			) : null}

			{labelling ? (
				<LabelPicker
					homeId={homeId}
					node={node}
					onDismiss={() => setLabelling(false)}
					testID={`label-picker-${node.id}`}
					returnFocusTo={anchor}
				/>
			) : null}
		</>
	);
}

/**
 * A group header inside a menu page. Plain text, deliberately not a disabled
 * `Menu.Item`: a header is a word about the list under it, and Paper names a
 * disabled item "dimmed" to a screen reader — the same trap `MetaChip` exists
 * for.
 */
function MenuLabel({ children }: { children: string }) {
	const theme = useAppTheme();

	return (
		<Text
			variant="labelMedium"
			style={{
				color: theme.colors.onSurfaceVariant,
				paddingHorizontal: space.md,
				paddingVertical: space.xs,
			}}
		>
			{children}
		</Text>
	);
}

/**
 * The board above this one, when a card is asked to go up a level.
 *
 * `reparentNode` needs the destination *node*, not just its id, because a
 * child's `ancestorIds` is the parent's path plus the parent. An ancestor that
 * cannot be read is the one case where up-one-level has no answer — participant
 * inheritance runs downward — and that is a failure, not a silent move to the
 * root.
 */
async function requireNode(homeId: string, nodeId: string): Promise<Node> {
	// `undefined` — offline, no answer at all — has the same answer here as a
	// refusal: up-one-level needs the real node, and neither is it.
	const node = (await getNode(homeId, nodeId)) ?? null;
	if (node === null) {
		throw new Error("The board above this one is not readable.");
	}
	return node;
}
