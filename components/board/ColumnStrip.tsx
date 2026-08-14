import { useTranslation } from "react-i18next";
import { ScrollView } from "react-native";
import { Chip } from "react-native-paper";
import type { Node, Status } from "@/models/node";
import { space } from "@/theme/tokens";

interface ColumnStripProps {
	columns: readonly Status[];
	nodes: readonly Node[];
	current: number;
	onSelect: (index: number) => void;
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
}: ColumnStripProps) {
	const { t } = useTranslation();

	return (
		<ScrollView
			horizontal
			showsHorizontalScrollIndicator={false}
			contentContainerStyle={{
				gap: space.sm,
				paddingHorizontal: space.md,
				paddingBottom: space.sm,
			}}
		>
			{columns.map((status, index) => {
				const count = nodes.filter((node) => node.status === status).length;
				// The separator is punctuation rather than a translated string: both
				// locales write a count after a label the same way.
				const label = `${t(`status.${status}`)} · ${count}`;

				return (
					<Chip
						key={status}
						selected={index === current}
						showSelectedCheck={false}
						onPress={() => onSelect(index)}
						accessibilityState={{ selected: index === current }}
					>
						{label}
					</Chip>
				);
			})}
		</ScrollView>
	);
}
