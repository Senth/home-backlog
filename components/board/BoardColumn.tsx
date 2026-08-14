import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { Button, Text } from "react-native-paper";
import { BoardCard } from "@/components/board/BoardCard";
import type { Node, Status } from "@/models/node";
import { useAppTheme } from "@/theme";
import { radius, space, touchTarget } from "@/theme/tokens";

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
	onAdd: () => void;
	onOpen: (node: Node) => void;
	/** The card's overflow menu, which the board owns because the actions do. */
	renderMenu?: (node: Node) => ReactNode;
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
	onAdd,
	onOpen,
	renderMenu,
}: BoardColumnProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();

	const label = t(`status.${status}`);

	return (
		<View
			style={{
				width,
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
				{nodes.length === 0 ? (
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
				) : (
					nodes.map((node) => (
						<BoardCard
							key={node.id}
							node={node}
							onOpen={() => onOpen(node)}
							menu={renderMenu?.(node)}
						/>
					))
				)}

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
	);
}
