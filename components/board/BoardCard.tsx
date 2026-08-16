import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Card, Icon, Text } from "react-native-paper";
import { MetaChip } from "@/components/board/MetaChip";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import { useHome } from "@/contexts/HomeContext";
import { formatList } from "@/i18n/format-list";
import { dueState, formatDueElapsed } from "@/models/due-date";
import { hasSteps, type Node } from "@/models/node";
import { useAppTheme } from "@/theme";
import { icon, size, space, touchTarget } from "@/theme/tokens";

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
 *
 * Two more marks, both only when set, the same rule the due chip follows:
 *
 * - **who is doing it**, as small avatars. "Is this mine, or is he asking me?"
 *   is otherwise answered only on the detail screen, and the phone-only member
 *   never opens the detail screen.
 * - **a *Hidden* chip** on a private card, beside priority and effort. It stays
 *   a `MetaChip` — deliberately not a control — which is what keeps a screen
 *   reader from announcing every private card as "dimmed".
 *
 * Neither costs a read: `memberProfiles` is already on `activeHome`.
 */
export function BoardCard({ node, onOpen, menu }: BoardCardProps) {
	const { t, i18n } = useTranslation();
	const theme = useAppTheme();
	const { activeHome } = useHome();

	const steps = hasSteps(node);
	const due = dueState(node.dueDate, new Date());
	const late = due === "late";
	const showDue = node.dueDate !== null && (late || due === "soon");
	const isPrivate = node.visibility === "private";

	// A member who has left the home has no profile left, and is still assigned:
	// the row says *Someone* rather than dropping them, the same way the members
	// list does.
	const assignees = node.assigneeIds.map((uid) => ({
		uid,
		name:
			activeHome?.memberProfiles?.[uid]?.displayName || t("members.unknown"),
		photoURL: activeHome?.memberProfiles?.[uid]?.photoURL ?? null,
	}));

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

					{/* One label for the row rather than one per face: a screen reader
					    reading "M W, N A" learns nothing, and the initials are a visual
					    shorthand rather than a name. */}
					{assignees.length === 0 ? null : (
						<View
							accessible
							accessibilityLabel={t("board.assignedTo", {
								names: formatList(
									assignees.map((assignee) => assignee.name),
									i18n.language,
								),
							})}
							style={{
								flexDirection: "row",
								flexWrap: "wrap",
								alignItems: "center",
								gap: space.xs,
							}}
						>
							{assignees.map((assignee) => (
								<PersonAvatar
									key={assignee.uid}
									name={assignee.name}
									photoURL={assignee.photoURL}
									px={size.avatarXs}
								/>
							))}
						</View>
					)}

					{node.priority !== null ||
					node.effort !== null ||
					showDue ||
					isPrivate ? (
						<View
							style={{
								flexDirection: "row",
								flexWrap: "wrap",
								alignItems: "center",
								gap: space.xs,
							}}
						>
							{isPrivate ? (
								<MetaChip source="eye-off-outline">
									{t("board.hidden")}
								</MetaChip>
							) : null}
							{node.priority === null ? null : (
								<MetaChip>{t(`priority.${node.priority}`)}</MetaChip>
							)}
							{node.effort === null ? null : (
								<MetaChip>{t(`effort.${node.effort}`)}</MetaChip>
							)}
							{showDue && node.dueDate !== null ? (
								<MetaChip
									source="calendar"
									color={late ? theme.colors.warning : undefined}
								>
									{t(late ? "board.dueLate" : "board.dueSoon", {
										elapsed: formatDueElapsed(
											node.dueDate,
											new Date(),
											i18n.language,
										),
									})}
								</MetaChip>
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
