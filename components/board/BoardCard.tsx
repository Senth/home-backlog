import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Card, Chip, Icon, Text } from "react-native-paper";
import { dueState, formatDueElapsed } from "@/models/due-date";
import { hasSteps, type Node } from "@/models/node";
import { useAppTheme } from "@/theme";
import { icon, space, touchTarget } from "@/theme/tokens";

interface BoardCardProps {
	node: Node;
	/**
	 * A tap. On a card with steps that is its board; on one without, its details
	 * — a card is a board only once it has a step in it.
	 */
	onOpen: () => void;
	/** The overflow menu. Everything that is not "open" lives in there. */
	menu?: ReactNode;
}

/**
 * One card: a title, what little metadata is worth carrying, and a mark when
 * something is blocking it.
 *
 * **The chevron says the card is a board**, and it is there only when the card
 * really has steps — `hasSteps`, from the stored `childCount`. That is the whole
 * shape of #49: a node is a board because it has children, so there is no flag,
 * no *convert to a board* action and no undo. A tap on a card without steps
 * opens its details instead, because "buy tile adhesive" is not a board and an
 * empty board reads as a bug rather than as an empty board.
 *
 * What the face gained, and what it did not:
 *
 * - **Priority and effort** appear as outlined chips whenever set. Words, never
 *   a colour-coded alarm — on a curated board a priority is one member's
 *   judgement of another member's Saturday, and four red chips on the outdoor
 *   cards is `PERSONAS.md`'s stated quit line rendered as UI.
 * - **The due date** appears only when it is overdue or within a week. A date
 *   three months out is not asking for anything, and a board where every card
 *   carries a date teaches people to stop reading dates.
 * - **Overdue is carried by words**, *3 days late*, in the warning colour the
 *   blocked mark already uses and at the same weight. Nothing in the app acts on
 *   a due date yet — no reminder, no notification (#54, #55) — so a red card
 *   would be pure guilt for a deadline nothing will ever remind anyone about.
 *   Words also survive 200% text and colour blindness, which a red chip does not.
 * - **`2/5` rather than a progress bar.** A count of direct steps is a fact; a
 *   bar is a claim about the project, and on nested work it is a false one. A
 *   bathroom with five children that each have six subtasks reads *1 of 5* when
 *   20 of 30 real jobs are done, and somebody reads that as broken once and then
 *   stops reading bars.
 *
 * A card with nothing set is exactly the card that shipped before, minus the
 * chevron.
 */
export function BoardCard({ node, onOpen, menu }: BoardCardProps) {
	const { t, i18n } = useTranslation();
	const theme = useAppTheme();

	const steps = hasSteps(node);
	const due = dueState(node.dueDate, new Date());
	const late = due === "late";
	const showDue = node.dueDate !== null && (late || due === "soon");

	return (
		<Card
			mode="outlined"
			onPress={onOpen}
			accessibilityHint={steps ? t("board.open") : t("detail.title")}
		>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: space.sm,
					minHeight: touchTarget,
					paddingLeft: space.md,
					// The menu button carries its own padding; without this the card
					// would be visibly wider on the right than on the left.
					paddingRight: menu ? space.none : space.sm,
					paddingVertical: space.sm,
				}}
			>
				<View style={{ flex: 1, gap: space.xs }}>
					<Text variant="bodyLarge">{node.title}</Text>

					{node.priority !== null || node.effort !== null || showDue ? (
						<View
							style={{
								flexDirection: "row",
								flexWrap: "wrap",
								alignItems: "center",
								gap: space.xs,
							}}
						>
							{node.priority === null ? null : (
								<Chip compact mode="outlined">
									{t(`priority.${node.priority}`)}
								</Chip>
							)}
							{node.effort === null ? null : (
								<Chip compact mode="outlined">
									{t(`effort.${node.effort}`)}
								</Chip>
							)}
							{showDue && node.dueDate !== null ? (
								<Chip
									compact
									mode="outlined"
									icon="calendar"
									textStyle={late ? { color: theme.colors.warning } : undefined}
								>
									{t(late ? "board.dueLate" : "board.dueSoon", {
										elapsed: formatDueElapsed(
											node.dueDate,
											new Date(),
											i18n.language,
										),
									})}
								</Chip>
							) : null}
						</View>
					) : null}

					{/* Blocked is a *condition*, not a column: the card stays in the
					    stage it is really in and says it is waiting. Nothing in the UI
					    sets `blockedBy` yet — that is #66 — so this arrives from the
					    REST API or a fixture until then. */}
					{node.blockedBy.length > 0 ? (
						<View
							style={{
								flexDirection: "row",
								alignItems: "center",
								gap: space.xs,
							}}
						>
							<Icon
								source="pause-circle-outline"
								size={icon.sm}
								color={theme.colors.warning}
							/>
							<Text
								variant="labelMedium"
								style={{ color: theme.colors.warning }}
							>
								{t("board.blocked")}
							</Text>
						</View>
					) : null}
				</View>

				{steps ? (
					<>
						<Text
							variant="labelMedium"
							style={{ color: theme.colors.onSurfaceVariant }}
							accessibilityLabel={t("detail.stepsDone", {
								done: node.doneCount,
								total: node.childCount,
							})}
						>
							{t("board.steps", {
								done: node.doneCount,
								total: node.childCount,
							})}
						</Text>
						<Icon
							source="chevron-right"
							size={icon.md}
							color={theme.colors.onSurfaceVariant}
						/>
					</>
				) : null}
				{menu}
			</View>
		</Card>
	);
}
