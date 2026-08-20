import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { Chip } from "react-native-paper";
import { chipKey } from "@/components/board/use-board-drag";
import type { Node, Status } from "@/models/node";
import { useAppTheme } from "@/theme";
import { space } from "@/theme/tokens";

interface ColumnStripProps {
	columns: readonly Status[];
	nodes: readonly Node[];
	current: number;
	onSelect: (index: number) => void;
	/** Registers each chip as a drop target, while a card is being dragged. */
	register?: (key: string) => (view: View | null) => void;
	/** The chip a held card is over, which is marked while it is. */
	dropOn?: Status | null;
}

/**
 * The column strip, below `compactBreakpoint` only.
 *
 * Six of eight panes are empty in a small household, and without this the board
 * is swiped blind — an empty pane is indistinguishable from a broken app. Each
 * chip names its column and carries its card count, the current one is marked,
 * and a tap jumps straight to it: it is also the way back after a move, and the
 * way to Done without seven swipes.
 *
 * Above the breakpoint the column headers say the same thing, so this is not
 * rendered at all.
 */
export function ColumnStrip({
	columns,
	nodes,
	current,
	onSelect,
	register,
	dropOn = null,
}: ColumnStripProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();

	return (
		<ScrollView
			horizontal
			showsHorizontalScrollIndicator={false}
			style={{
				// Hugs its content: a `ScrollView` in a column parent otherwise grows
				// to fill it, and one row of chips would take half the board.
				flexGrow: 0,
				// Above a card being dragged onto it. A lifted card spans the width
				// of a phone, so it would otherwise cover the very chip it is being
				// aimed at, and the mark saying which one would be under the hand.
				zIndex: 1,
			}}
			contentContainerStyle={{
				gap: space.sm,
				paddingHorizontal: space.md,
				paddingBottom: space.sm,
			}}
		>
			{columns.map((status, index) => {
				const count = nodes.filter((node) => node.status === status).length;
				const marked = dropOn === status;
				// The separator is punctuation rather than a translated string: both
				// locales write a count after a label the same way.
				const label = `${t(`status.${status}`)} · ${count}`;

				return (
					// The frame a chip drop is measured against. A chip is the primary
					// way across on a phone: it never moves the pane, so sorting six
					// cards out of To do costs no navigation at all.
					<View
						key={status}
						ref={register?.(chipKey(status))}
						collapsable={false}
					>
						<Chip
							// Filled against outlined, not Paper's selected tint alone: on a
							// strip of eight, a slightly different shade of the same green is
							// not a mark anyone can find while swiping.
							mode={index === current || marked ? "flat" : "outlined"}
							selected={index === current || marked}
							showSelectedCheck={false}
							// "This is where the card would land" is inverted rather than
							// tinted, because the selected tint is already spoken for by
							// "this is the pane you are on" — and a household member sorting
							// one-handed mid-drag reads a colour, not a word. Nothing
							// changes size, so the strip does not shift under the hand.
							style={
								marked ? { backgroundColor: theme.colors.primary } : undefined
							}
							selectedColor={marked ? theme.colors.onPrimary : undefined}
							onPress={() => onSelect(index)}
							accessibilityState={{ selected: index === current }}
						>
							{label}
						</Chip>
					</View>
				);
			})}
		</ScrollView>
	);
}
