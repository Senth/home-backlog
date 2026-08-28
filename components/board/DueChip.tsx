import { useTranslation } from "react-i18next";
import { MetaChip } from "@/components/board/MetaChip";
import { dueState, formatDueElapsed } from "@/models/due-date";
import type { Node } from "@/models/node";
import { useAppTheme } from "@/theme";

/**
 * What a node's due date says, when it is worth saying: *3 days late*, or *due
 * in 2 days*. Nothing at all when the date is absent or still far off.
 *
 * **Overdue is words, never colour.** Nothing in the app acts on a due date
 * yet, so a red card is pure guilt for a deadline nothing will remind anyone
 * about — and words survive 200% text and colour blindness, which a colour
 * alone does not. The warning colour is carried *with* the words, never
 * instead of them.
 *
 * One component rather than one per surface: the card face and the Overview row
 * make the same claim about the same field, and two copies of the rule the spec
 * calls load-bearing is two places for it to drift.
 */
export function DueChip({ node }: { node: Node }) {
	const { t, i18n } = useTranslation();
	const theme = useAppTheme();

	const state = dueState(node.dueDate, new Date());
	const late = state === "late";

	if (node.dueDate === null || !(late || state === "soon")) return null;

	return (
		<MetaChip source="calendar" color={late ? theme.colors.warning : undefined}>
			{t(late ? "board.dueLate" : "board.dueSoon", {
				elapsed: formatDueElapsed(node.dueDate, new Date(), i18n.language),
			})}
		</MetaChip>
	);
}
