import { useTranslation } from "react-i18next";
import { type Node, unresolvedBlockers } from "@/models/node";

/**
 * The waiting mark's one derivation, for every surface that shows it.
 *
 * Waiting is the *unresolved* blockers, never the stored list: a done blocker
 * stops holding the card without being removed, and a card in Done never
 * marks, whatever its list holds. The count appears past one blocker, and the
 * a11y label carries the plural form, and the words come from here so no
 * surface that shows the mark can disagree with another.
 */
export function useWaitingMark(
	node: Node,
	blockers: ReadonlyMap<string, Node | null>,
): { isWaiting: boolean; label: string; a11yLabel: string } {
	const { t } = useTranslation();
	const count = unresolvedBlockers(node, blockers).length;

	return {
		isWaiting: node.status !== "done" && count > 0,
		label: count > 1 ? `${t("board.blocked")} · ${count}` : t("board.blocked"),
		a11yLabel: t("board.waitingLabel", { count }),
	};
}
