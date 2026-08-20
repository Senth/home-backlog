import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { Button, Text } from "react-native-paper";
import { BoardCard } from "@/components/board/BoardCard";
import { DragArea } from "@/components/board/DragArea";
import {
	type ColumnDrag,
	cardKey,
	columnKey,
} from "@/components/board/use-board-drag";
import type { Node, Status } from "@/models/node";
import { useAppTheme } from "@/theme";
import {
	border,
	drag as dragTokens,
	radius,
	space,
	touchTarget,
} from "@/theme/tokens";

interface BoardColumnProps {
	status: Status;
	/** The cards in this column, already in `(rank, id)` order. */
	nodes: Node[];
	/** A fixed column above `compactBreakpoint`, a full-width pane below it. */
	width: number | "100%";
	/**
	 * Below the breakpoint the strip names the column and one FAB adds to it, so
	 * neither is repeated inside the pane.
	 */
	wide: boolean;
	/**
	 * How many cards in this column the default-hide filter is holding back.
	 *
	 * A column emptied by the filter otherwise reads exactly like a column with
	 * nothing in it — and everywhere else this feature makes a point of never
	 * being a dead end: the narrowed assignee list names its own escape hatch,
	 * and so does the stale assignee.
	 */
	hiddenCount?: number;
	onAdd: () => void;
	onOpen: (node: Node) => void;
	/** The card's overflow menu, which the board owns because the actions do. */
	renderMenu?: (node: Node) => ReactNode;
	/**
	 * Dragging, which the board owns for the same reason: a card can be carried
	 * out of this column and into another one.
	 */
	drag?: ColumnDrag;
}

/**
 * One column of a board.
 *
 * The add control belongs to the column rather than to the screen: status comes
 * from *where* the button was, so a card typed one-handed in a greenhouse lands
 * where the button said it would. It sits at the bottom because that is where
 * the new card appears — `rankAtEnd` against this column's last card.
 */
export function BoardColumn({
	status,
	nodes,
	width,
	wide,
	hiddenCount = 0,
	onAdd,
	onOpen,
	renderMenu,
	drag,
}: BoardColumnProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();

	const label = t(`status.${status}`);

	// The card in flight is drawn at board level, following the finger — but its
	// own row **stays mounted**, flattened to nothing. The gesture belongs to that
	// row, and a row unmounted mid-drag takes the pointer capture with it: the
	// card lifts and then never moves again. The negative margin takes back the
	// gap a flattened row would otherwise still contribute between its
	// neighbours.
	const lifted = drag?.node ?? null;
	const gapAt = drag?.gapAt ?? null;

	// The slot counting skips the flattened row, because that is what the drop
	// model counts too: a card is never one of its own neighbours.
	let slot = 0;
	const rows = nodes.map((node) => {
		const held = lifted !== null && node.id === lifted.id;
		const row = { node, held, gapBefore: !held && gapAt === slot };
		if (!held) slot++;
		return row;
	});

	const gap = <View style={{ height: drag?.gapHeight ?? space.none }} />;

	/**
	 * A column with nothing in it, while a card is up. Two of four columns are
	 * empty in a small household, and an empty column is otherwise one line of
	 * grey text — nothing to aim at, and below the breakpoint no clue that a drop
	 * is allowed here at all. It names itself, because below the breakpoint the
	 * column it belongs to is the only one on screen.
	 */
	const landing = (
		<View
			style={{
				minHeight: dragTokens.landing,
				alignItems: "center",
				justifyContent: "center",
				padding: space.sm,
				borderRadius: radius.md,
				borderWidth: border.hairline,
				borderStyle: "dashed",
				borderColor:
					gapAt === null ? theme.colors.outlineVariant : theme.colors.primary,
			}}
		>
			<Text
				variant="bodyMedium"
				style={{ color: theme.colors.onSurfaceVariant, textAlign: "center" }}
			>
				{t("board.dropHere", { column: label })}
			</Text>
		</View>
	);
	const flattened = {
		height: space.none,
		marginBottom: -space.sm,
		opacity: 0,
		overflow: "hidden",
	} as const;

	return (
		<View
			style={{
				width,
				// The one pane below the breakpoint fills what is left of the screen.
				// Side by side it must not: `flex` on a row child would stretch its
				// *width*, and the columns stretch to full height already.
				flex: wide ? undefined : 1,
				// Side by side, a column needs an edge or the board reads as one
				// undifferentiated field of cards. A full-width pane does not: the
				// strip above it already says which column you are on.
				backgroundColor: wide ? theme.colors.elevation.level1 : undefined,
				borderRadius: wide ? radius.md : radius.none,
				paddingTop: wide ? space.sm : space.none,
			}}
		>
			{wide ? (
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "space-between",
						gap: space.sm,
						paddingHorizontal: space.sm,
						paddingBottom: space.sm,
					}}
				>
					<Text variant="titleSmall">{label}</Text>
					<Text
						variant="labelLarge"
						style={{ color: theme.colors.onSurfaceVariant }}
					>
						{nodes.length}
					</Text>
				</View>
			) : null}

			{/* The column's own drop area, measured when a card lifts: what a drag is
			    hit-tested against is the *viewport*, so a card scrolled out of sight
			    is above or below it rather than in it. */}
			<View
				ref={drag?.register(columnKey(status))}
				style={{ flex: 1 }}
				collapsable={false}
			>
				<ScrollView
					style={{ flex: 1 }}
					contentContainerStyle={{
						gap: space.sm,
						// A pane spans the screen below the breakpoint, so its cards need
						// the margin the gap between side-by-side columns already gives.
						paddingHorizontal: wide ? space.sm : space.md,
						// Clear of the FAB, which floats over the bottom-right corner.
						paddingBottom: space.xxl,
					}}
				>
					{slot === 0 && lifted === null ? (
						<Text
							variant="bodyMedium"
							style={{
								color: theme.colors.onSurfaceVariant,
								paddingHorizontal: space.sm,
								paddingVertical: space.sm,
							}}
						>
							{t("board.columnEmpty")}
						</Text>
					) : null}

					{rows.map(({ node, held, gapBefore }) => (
						<Fragment key={node.id}>
							{gapBefore ? gap : null}
							{/* The frame a drop is measured against, and the gesture that
						    picks the card up. Neither reaches the card face: it gains
						    nothing at all, and the drag is invisible until it is used. */}
							<View
								ref={drag?.register(cardKey(node.id))}
								collapsable={false}
								style={held ? flattened : undefined}
							>
								{drag === undefined ? (
									<BoardCard
										node={node}
										onOpen={() => onOpen(node)}
										menu={renderMenu?.(node)}
									/>
								) : (
									<DragArea {...drag.handlers(node)}>
										<BoardCard
											node={node}
											onOpen={() => onOpen(node)}
											menu={renderMenu?.(node)}
										/>
									</DragArea>
								)}
							</View>
						</Fragment>
					))}

					{/* An empty column says where a drop would go; a column with cards
					    lets the gap between them say it. */}
					{slot === 0 && lifted !== null
						? landing
						: gapAt !== null && gapAt >= slot
							? gap
							: null}

					{/* Says a card is there rather than leaving the column to read as
				    empty. Not a control: turning it back on is one item in the app
				    bar's overflow, which this names. */}
					{hiddenCount > 0 ? (
						<Text
							variant="bodySmall"
							style={{
								color: theme.colors.onSurfaceVariant,
								paddingHorizontal: space.sm,
								paddingVertical: space.sm,
							}}
						>
							{t("board.hiddenHere", {
								count: hiddenCount,
								action: t("board.showEveryone"),
							})}
						</Text>
					) : null}

					{wide ? (
						<Button
							icon="plus"
							onPress={onAdd}
							contentStyle={{ minHeight: touchTarget }}
						>
							{t("board.addTo", { column: label })}
						</Button>
					) : null}
				</ScrollView>
			</View>
		</View>
	);
}
