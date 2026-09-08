import { useTranslation } from "react-i18next";
import { Text } from "react-native-paper";
import { DetailRow } from "@/components/node/DetailRow";
import { useNodes } from "@/hooks/use-nodes";
import type { Node } from "@/models/node";

interface StepsSectionProps {
	homeId: string;
	/** The card these are the steps of. */
	node: Node;
	onOpenBoard: () => void;
}

/**
 * The *Steps* row (#237): the count as its value, and the board one tap away —
 * the row *is* the navigation, so *Open board* is gone with the buttons.
 *
 * It still runs the **real board queries** — `useNodes` with this node as the
 * parent, the same two listeners and the same index a board load uses — rather
 * than reading `childCount`. That is what closes the one direction of counter
 * drift that could hide work: a card whose counter has gone low still counts
 * its true steps here.
 *
 * Nothing on this screen creates a step any more. The board owns adding,
 * reordering, moving, renaming and deleting, so there is one place that does
 * the complicated things — and a load that could not be read says so in the
 * row rather than offering a retry against the screen it failed on.
 */
export function StepsSection({ homeId, node, onOpenBoard }: StepsSectionProps) {
	const { t } = useTranslation();
	const { nodes: steps, loading, failed } = useNodes(homeId, node.id);
	const done = steps.filter((step) => step.status === "done").length;

	return (
		<DetailRow
			glyph="format-list-checks"
			name={t("detail.steps")}
			onPress={onOpenBoard}
			testID={`field-steps-${node.id}`}
			value={
				loading ? null : (
					<Text variant="bodyMedium">
						{/* "No steps yet" says the same thing whether there are none or
						    whether they could not be read, and only one of those is worth
						    opening the board against. */}
						{failed
							? t("detail.stepsFailed")
							: steps.length === 0
								? t("detail.stepsNone")
								: t("detail.stepsDone", { done, total: steps.length })}
					</Text>
				)
			}
		/>
	);
}
