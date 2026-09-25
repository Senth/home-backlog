import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Chip } from "react-native-paper";
import { chipKey } from "@/components/board/use-board-drag";
import { SlimScrollView } from "@/components/ui/SlimScrollView";
import type { Node, Status } from "@/models/node";
import { useAppTheme } from "@/theme";
import { outlinedTouchTarget, space } from "@/theme/tokens";

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
		<SlimScrollView
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
				const column = t(`status.${status}`);
				// From a key rather than composed here: the separator is punctuation
				// and both locales happen to write it the same way today, but a label
				// assembled in code is a string no translator can reach.
				const label = t("board.columnChip", { column, count });
				// A middle dot is read aloud as "middle dot", or as nothing at all,
				// depending on the screen reader — so the spoken chip says what it
				// means: "To do, 3 cards". The current column says so in its own
				// name, not only in a state: `accessibilityState` reaches the DOM
				// as nothing on react-native-web 0.21, and every `aria-*` prop
				// Paper's `Chip` takes lands on its outer surface — never on the
				// `<button>` a person taps. The label is the one channel that
				// reaches it.
				const spoken = t(
					index === current
						? "board.columnChipCurrentA11y"
						: "board.columnChipA11y",
					{ column, count },
				);

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
							// The resting selected chip is *quiet*: outlined, with the
							// brand color on its border and its words only — the same
							// primary-as-active-tab role the tab bar uses. It is always
							// on screen, and a filled chip here competed with the card
							// titles for the eye whenever nobody was dragging.
							mode={marked ? "flat" : "outlined"}
							selected={index === current || marked}
							showSelectedCheck={false}
							// "This is where the card would land" is inverted rather than
							// tinted, because the selected tint is already spoken for by
							// "this is the pane you are on" — and a household member sorting
							// one-handed mid-drag reads a color, not a word. Nothing
							// changes size, so the strip does not shift under the hand.
							// Paper's chip is 32dp tall, under the project's 48, and it is
							// the primary way across a board on a phone — exactly the control
							// that must not be a small target. `outlinedTouchTarget` rather
							// than `touchTarget` because the chip keeps a 1dp border in both
							// modes and measures it inside its own height; see the token.
							style={[
								{
									minHeight: outlinedTouchTarget,
									justifyContent: "center",
								},
								marked
									? { backgroundColor: theme.colors.primary }
									: index === current
										? { borderColor: theme.colors.primary }
										: null,
							]}
							textStyle={
								marked || index !== current
									? undefined
									: { color: theme.colors.primary }
							}
							selectedColor={marked ? theme.colors.onPrimary : undefined}
							onPress={() => onSelect(index)}
							accessibilityLabel={spoken}
							accessibilityState={{ selected: index === current }}
							// The web DOM's own "you are here", beside the native state.
							// It lands on Paper's outer surface rather than the button,
							// so the label above is what a reader actually hears.
							{...(index === current ? { "aria-current": "true" } : {})}
						>
							{label}
						</Chip>
					</View>
				);
			})}
		</SlimScrollView>
	);
}
