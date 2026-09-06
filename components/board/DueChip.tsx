import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Icon, Text } from "react-native-paper";
import { dueState, formatDueElapsed } from "@/models/due-date";
import type { Node } from "@/models/node";
import { useAppTheme } from "@/theme";
import { icon, space } from "@/theme/tokens";

/**
 * What a node's due date says, when it is worth saying: *3 days late*, or *due
 * in 2 days*. Nothing at all when the date is absent or still far off.
 *
 * **Overdue is words, never color.** Nothing in the app acts on a due date
 * yet, so a red card is pure guilt for a deadline nothing will remind anyone
 * about — and words survive 200% text and color blindness, which a color
 * alone does not. The warning color is carried *with* the words, never
 * instead of them.
 *
 * **Bare**, on the card face (#100): a leading glyph and the words, no chip
 * border — the card's footer is text, and a box around it was one more edge
 * competing with the card's own. One component rather than one per surface:
 * the card face and the Overview row make the same claim about the same field,
 * and two copies of the rule the spec calls load-bearing is two places for it
 * to drift.
 */
export function DueChip({ node }: { node: Node }) {
	const { t, i18n } = useTranslation();
	const theme = useAppTheme();

	const state = dueState(node.dueDate, new Date());
	const late = state === "late";

	if (node.dueDate === null || !(late || state === "soon")) return null;

	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: space.xs,
			}}
		>
			<Icon source="calendar" size={icon.sm} color={theme.colors.warning} />
			<Text variant="labelMedium" style={{ color: theme.colors.warning }}>
				{t(late ? "board.dueLate" : "board.dueSoon", {
					elapsed: formatDueElapsed(node.dueDate, new Date(), i18n.language),
				})}
			</Text>
		</View>
	);
}
