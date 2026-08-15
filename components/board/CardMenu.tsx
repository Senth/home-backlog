import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { IconButton, Menu } from "react-native-paper";
import { TitleDialog } from "@/components/board/TitleDialog";
import { ConfirmDialog } from "@/components/ui/AppDialog";
import { useAuth } from "@/contexts/AuthContext";
import {
	boardOnce,
	deleteNode,
	getNode,
	moveNode,
	reparentNode,
	updateNode,
} from "@/data/nodes";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { type Node, rankAtEnd, rankBetween, type Status } from "@/models/node";
import { space, touchTarget } from "@/theme/tokens";

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
	onNotice: (notice: Notice) => void;
	/**
	 * Opening the card's details. Here as well as on the tap, because a card that
	 * *is* a board takes the tap to drill into — so this is the only way in.
	 */
	onDetails: () => void;
}

type Page = "root" | "move" | "position" | "under";

/** `null` is the top level; `"up"` is the board above this one. */
type Destination = Node | null | "up";

/**
 * Everything a card can do except open, which is what tapping it already means.
 *
 * The menu changes *page* rather than opening a submenu: Paper's `Menu` scrolls
 * its own content, so a column with thirty cards is a list you scroll rather
 * than a second overlay to dismiss.
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
	const anchor = useRef<View | null>(null);

	const close = () => {
		setOpen(false);
		setPage("root");
	};

	const column = nodes.filter((card) => card.status === node.status);
	const index = column.findIndex((card) => card.id === node.id);
	const others = column.filter((card) => card.id !== node.id);
	// A shared card under a private parent breaks the uniform-visibility
	// invariant, and the rules refuse it. Offering it would be offering a
	// permission error.
	const hosts = nodes.filter(
		(card) => card.id !== node.id && card.visibility === node.visibility,
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
			onNotice({ text: t("error.saveFailed") });
		}
	};

	const rename = (title: string) => {
		updateNode(homeId, node.id, { title }).catch((reason) => {
			console.error("Could not rename the card:", reason);
			onNotice({ text: t("error.saveFailed") });
		});
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
				anchor={
					<View ref={anchor}>
						<IconButton
							icon="dots-vertical"
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
				{page === "root" ? (
					<>
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
					</>
				) : null}

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
										rankBetween(other.rank, others[position + 1]?.rank ?? null),
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
						{/* Up and Top are the same destination one level down from the
						    root, so only one of them is ever offered. */}
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
		</>
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
	const node = await getNode(homeId, nodeId);
	if (node === null) {
		throw new Error("The board above this one is not readable.");
	}
	return node;
}
