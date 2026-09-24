import { useTranslation } from "react-i18next";
import { formatList } from "@/i18n/format-list";
import { type Node, unresolvedBlockers } from "@/models/node";

/**
 * The waiting mark's one derivation, for every surface that shows it.
 *
 * Waiting is the *unresolved* blockers, never the stored list: a done blocker
 * stops holding the card without being removed, and a card in Done never
 * marks, whatever its list holds. The face names what is being waited on
 * (#339); a blocker nobody has heard from yet has no title to name, and the
 * bare count stands in. The a11y label carries the plural form, and the words
 * come from here so no surface that shows the mark can disagree with another.
 */
export function useWaitingMark(
	node: Node,
	blockers: ReadonlyMap<string, Node | null>,
): { isWaiting: boolean; label: string; a11yLabel: string } {
	const { t, i18n } = useTranslation();
	const ids = unresolvedBlockers(node, blockers);
	const count = ids.length;
	const titles = ids
		.map((id) => blockers.get(id)?.title)
		.filter((title): title is string => typeof title === "string");

	const label =
		titles.length > 0
			? t("board.waitingOnTitle", { titles: formatList(titles, i18n.language) })
			: count > 1
				? `${t("board.blocked")} · ${count}`
				: t("board.blocked");

	return {
		isWaiting: node.status !== "done" && count > 0,
		label,
		a11yLabel: t("board.waitingLabel", { count }),
	};
}
