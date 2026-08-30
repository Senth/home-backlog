import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Card, Icon, Text } from "react-native-paper";
import { DueChip } from "@/components/board/DueChip";
import { MetaChip } from "@/components/board/MetaChip";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import { useHome } from "@/contexts/HomeContext";
import { formatList } from "@/i18n/format-list";
import { dueState } from "@/models/due-date";
import { hasSteps, type Node, unresolvedBlockers } from "@/models/node";
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
	/**
	 * Above `compactBreakpoint`, where the title drops to `bodyMedium` because a
	 * column of desktop cards is read as a list rather than one card at a time.
	 *
	 * The column passes it down; **the card does not measure itself**. A card is
	 * rendered once per row and dragged over a second time in an overlay, and a
	 * width listener on each of those is a resize observer per card for a fact
	 * the board already knows.
	 */
	wide?: boolean;
	/**
	 * The blockers this card might wait on, by id — the board's own nodes plus
	 * the watcher's cross-board documents, `null` for one the server confirmed
	 * gone. Absent means *not heard from yet*, which waits. Overview hands the
	 * statuses it already holds, in the same shape.
	 */
	blockers?: ReadonlyMap<string, Node | null>;
}

/** What a card resolves its waiting against before its board has said anything. */
const noBlockers: ReadonlyMap<string, Node | null> = new Map();

/**
 * One card: a title, what little metadata is worth carrying, and a mark when
 * something is blocking it.
 *
 * **The steps glyph says the card is a board**, and it is there only when the
 * card really has steps — `hasSteps`, from the stored `childCount`. That is the
 * whole shape of #49: a node is a board because it has children, so there is no
 * flag, no *convert to a board* action and no undo. A tap on a card without
 * steps opens its details instead, because "buy tile adhesive" is not a board
 * and an empty board reads as a bug rather than as an empty board.
 *
 * The face is two columns: the content, and a narrow rail on the right carrying
 * the menu button with the glyph and the count under it. The rail never wraps,
 * so the count is position-stable at any text size — a count floated right on
 * the chip row is stranded below everything at 200% in Swedish.
 *
 * **There is no chevron.** It appeared exactly when the count did, so the two
 * said the same thing twice; the mark that survives is the one that also carries
 * information, and `format-list-checks` beside `2/5` is that mark. Removing both
 * was rejected: a board card and a plain card would then be identical, and a tap
 * meant for the next job would open a five-step mountain.
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
 * A card with nothing set is a title and, if it is a board, a count: nothing is
 * added to make it look finished.
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
export function BoardCard({
	node,
	onOpen,
	menu,
	wide = false,
	blockers = noBlockers,
}: BoardCardProps) {
	const { t, i18n } = useTranslation();
	const theme = useAppTheme();
	const { activeHome } = useHome();

	const steps = hasSteps(node);
	const due = dueState(node.dueDate, new Date());
	// Only to decide whether the chip row exists at all — the chip itself, and
	// the warning colour on it, are `DueChip`'s.
	const showDue = node.dueDate !== null && (due === "late" || due === "soon");
	const isPrivate = node.visibility === "private";

	// Waiting is the *unresolved* blockers, never the stored list: a done
	// blocker stops holding this card without being removed, and a card in
	// Done never marks, whatever its list holds.
	const waiting = unresolvedBlockers(node, blockers);
	const isWaiting = node.status !== "done" && waiting.length > 0;

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
			accessibilityHint={steps ? t("board.open") : t("board.openDetails")}
			// Raised out of its column: the fill is a board colour rather than
			// `surface`, which in dark was the same colour as the page. Paper draws
			// the outlined card's hairline itself, in whatever `borderColor` this
			// style carries — a `borderWidth` here would put a second, coincident
			// border on the surface underneath it and inset the content by a pixel.
			style={{
				backgroundColor: theme.colors.boardCard,
				borderColor: theme.colors.boardCardBorder,
			}}
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
					{/* Smaller on desktop, where a column is read as a list of cards
					    rather than one card filling the screen. `wide` comes from the
					    column, not from a measurement taken here. */}
					<Text variant={wide ? "bodyMedium" : "bodyLarge"}>{node.title}</Text>

					{/* One label for the row rather than one per face: a screen reader
					    reading "M W, N A" learns nothing, and the initials are a visual
					    shorthand rather than a name. */}
					{assignees.length === 0 ? null : (
						<View
							accessible
							accessibilityLabel={t("board.assignedTo", {
								count: assignees.length,
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
							<DueChip node={node} />
						</View>
					) : null}

					{/* Waiting is a *condition*, not a column: the card stays in the
				    stage it is really in and says it is waiting. The mark derives
				    from the blockers' own statuses, so a done blocker stops marking
				    its dependents and a missing one keeps holding the card — honest
				    *not yet* beats a mark that lies either way. The count appears
				    past one blocker; the colour is the warning colour, and the words
				    and icon separate it from the overdue text beside it. */}
					{isWaiting ? (
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
								accessibilityLabel={t("board.waitingLabel", {
									count: waiting.length,
								})}
							>
								{waiting.length > 1
									? `${t("board.blocked")} · ${waiting.length}`
									: t("board.blocked")}
							</Text>
						</View>
					) : null}
				</View>

				{/* The rail. The menu, and under it the mark that this card is a
				    board. A column of its own so the count sits out of the title's
				    way and cannot be pushed anywhere by what the content does. */}
				{menu === undefined && !steps ? null : (
					<View style={{ alignItems: "center", gap: space.xs }}>
						{menu}
						{steps ? (
							<View
								testID="card-steps"
								style={{
									flexDirection: "row",
									// Never wraps: the glyph and its count are one mark, and
									// half of it on the next line is not a smaller mark.
									flexWrap: "nowrap",
									alignItems: "center",
									gap: space.xs,
									paddingHorizontal: space.xs,
								}}
							>
								<Icon
									source="format-list-checks"
									size={icon.sm}
									color={theme.colors.onCardMuted}
								/>
								<Text
									variant="labelMedium"
									numberOfLines={1}
									style={{ color: theme.colors.onCardMuted }}
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
							</View>
						) : null}
					</View>
				)}
			</View>
		</Card>
	);
}
