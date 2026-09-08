import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button, Text } from "react-native-paper";
import { detailsHref } from "@/components/board/board-href";
import type { FlipState } from "@/components/node/FlipDialog";
import { PeopleField } from "@/components/node/PeopleField";
import type { NodeChanges } from "@/data/nodes";
import { useOnlineStatus } from "@/hooks/use-online-status";
import type { Member } from "@/models/home";
import {
	assignableMembers,
	type Node,
	rootIdOf,
	staleAssignees,
} from "@/models/node";
import { useAppTheme } from "@/theme";
import { space, touchTarget } from "@/theme/tokens";

interface PeopleSectionProps {
	node: Node;
	/**
	 * The root of this node's subtree — the node itself when it is one, and
	 * `null` while its listener is still resolving.
	 */
	root: Node | null;
	members: readonly Member[];
	onSave: (changes: NodeChanges) => void;
	/** Shared with the visibility control: one subtree write runs at a time. */
	flip: FlipState;
	/**
	 * The actor's uid, handed in rather than read off `useAuth`: the section
	 * mounts inside a sheet's portal (#237), above which the auth context does
	 * not reach. The private-participants write needs the actor — the rules
	 * refuse a private document its author could not read back.
	 */
	uid: string | null;
	/**
	 * Renders one of the two fields instead of both (#237): the details screen's
	 * rows name them separately, so *Who's in it* opens the participants field
	 * and *Who's doing it* the assignees. Absent renders both, as always.
	 */
	only?: "participants" | "assignees";
}

/**
 * Whose project this is, and who is doing this card.
 *
 * Both are drawn from `membersOf(activeHome)` — no listener and no read: the
 * home document, with its `memberProfiles`, is already on screen.
 *
 * **Nothing here renders in a one-member home.** Ingrid is alone in her house
 * and one of four people at the cabin; in the house, participants (nobody to
 * involve) and assignees (only her) are clutter on the screen she uses to write
 * down what the chimney sweep said, at 200 % text.
 *
 * **Nothing renders until the root has arrived either.** `assignableMembers`
 * reads an unresolved root as "no participants stored" and hands back the whole
 * household, so on a narrowed project the assignee control would appear for one
 * tick with the wrong people in it and then shrink under a thumb already
 * reaching for it.
 *
 * **Participants are root-only, and so is privacy.** Both answer a question
 * about a *project* rather than about a step inside one, so a household that
 * learns the rule once has learned it for both — and neither ever needs a
 * greyed-out inherited row on a descendant. What a descendant needs explaining
 * is explained in the editors, not on the screen (#237).
 */
export function PeopleSection({
	node,
	root,
	members,
	onSave,
	flip,
	only,
	uid,
}: PeopleSectionProps) {
	const { t } = useTranslation();
	const online = useOnlineStatus();

	const isRoot = node.parentId === null;
	const isPrivate = node.visibility === "private";
	const rootTitle = root?.title ?? "";
	const assignable = assignableMembers(root, members);
	const stale = staleAssignees(node, assignable);

	const nameOf = (memberUid: string) =>
		members.find((member) => member.uid === memberUid)?.displayName ||
		t("members.unknown");

	/**
	 * On a **shared** project this changes no permission at all: the read grant is
	 * `visibility == 'shared' || uid in participantIds`, and the first disjunct
	 * alone lets every member in. All it feeds is the board's default-hide filter,
	 * so it queues offline like any other edit.
	 *
	 * On a **private** one the same list *is* the access list, and the rules
	 * require every descendant to carry all of its parent's participants — so a
	 * plain update here would hand somebody a project whose steps they still could
	 * not read, and an empty board is the worst possible answer to "you have been
	 * let in". It runs through the same top-down machinery as the visibility flip
	 * instead: *n* server-checked writes, a dialog that holds the screen, and a
	 * *Try again* that re-reads and finishes.
	 *
	 * The retry has to come from that dialog rather than from ticking the box
	 * again, and this is why: the root is written first, so after a half-finished
	 * run `node.participantIds` already names the new person — and ticking their
	 * box a second time would take them back off.
	 */
	const saveParticipants = (participantIds: string[]) => {
		if (uid === null) return;

		if (!isPrivate) {
			onSave({ participantIds });
			return;
		}

		// The rules refuse a private document whose author could not read the
		// result back, so the actor is written in rather than defended against.
		const next = participantIds.includes(uid)
			? participantIds
			: [uid, ...participantIds];

		// The node itself, unmodified — the plan measures every skip against what
		// is *stored*, so handing it a copy carrying the new list would make the
		// root look already-correct and write nothing at all.
		flip.run(
			{
				node,
				target: "private",
				participantIds: next,
				title: t("detail.participantsPrivate"),
			},
			uid,
		);
	};

	if (members.length < 2 || root === null) return null;

	// Who's doing it, over a list of one, is not a choice — but this is the only
	// place in the app that *removes* an assignee, so the control comes back the
	// moment anybody is on the card, stale ones included.
	const showAssignees = assignable.length > 1 || node.assigneeIds.length > 0;

	/**
	 * The one row that cannot be unticked, and why.
	 *
	 * Both cases are a write the rules would refuse: yours on a private project,
	 * because `allow update` requires `visibleToMe(request.resource.data)`; and
	 * the last one on any root, because a root with nobody on it stopped being
	 * legal with #102. A checkbox that silently refuses is the failure this whole
	 * control was rebuilt to avoid.
	 */
	const lockedUid = isPrivate
		? (uid ?? undefined)
		: node.participantIds.length === 1
			? node.participantIds[0]
			: undefined;

	return (
		<>
			{isRoot && only !== "assignees" ? (
				<View style={{ gap: space.sm }}>
					<PeopleField
						label={t(
							isPrivate ? "detail.participantsPrivate" : "detail.participants",
						)}
						members={members}
						value={node.participantIds}
						onChange={saveParticipants}
						unknownLabel={t("members.unknown")}
						lockedUid={lockedUid}
						lockedHint={t(
							isPrivate
								? "detail.participantsYouStay"
								: "detail.participantsLast",
						)}
						// Only the private path needs a connection — it is n
						// server-checked writes. The shared one queues like any edit.
						disabled={isPrivate && !online}
						disabledHint={t("board.offlineHint")}
					/>
					<WhoSeesProjectNote />
				</View>
			) : null}

			{only !== "participants" && showAssignees ? (
				<View style={{ gap: space.sm }}>
					<PeopleField
						label={t("detail.assignees")}
						members={assignable}
						value={node.assigneeIds}
						onChange={(assigneeIds) => onSave({ assigneeIds })}
						unknownLabel={t("members.unknown")}
					/>

					{/* Somebody assigned who has *since* been dropped from the project,
					    or who has left the home. A real state, and deliberately shown
					    rather than hidden: it is information, and drawing it as an
					    orphaned checked box outside its own list is what would make it
					    read as a bug. */}
					{stale.map((memberUid) => (
						<View key={memberUid} style={{ gap: space.xs }}>
							<Hint>
								{t("detail.assigneeStale", {
									name: nameOf(memberUid),
									project: rootTitle,
								})}
							</Hint>
							<Action
								icon="account-remove-outline"
								onPress={() =>
									onSave({
										assigneeIds: node.assigneeIds.filter(
											(current) => current !== memberUid,
										),
									})
								}
							>
								{t("detail.assigneeStaleClear", { name: nameOf(memberUid) })}
							</Action>
						</View>
					))}

					{/* A step's assignee list is bounded by the project's
					    participants — the rule that used to sit on the screen now
					    lives in the editor it explains. On the project itself the
					    action would push to the screen you are standing on, so it is
					    the step's editor that carries it. */}
					{rootIdOf(node) === node.id ? null : (
						<WhoSeesStepNote project={rootTitle} rootId={rootIdOf(node)} />
					)}
				</View>
			) : null}
		</>
	);
}

/**
 * The two rules about people, inside the editors they explain (#237).
 *
 * The screen used to explain itself in grey sentences under the controls, on
 * every card at every depth, whether or not anything was confusing; then, for
 * one phase, in a folded disclosure below the rows. Both are gone: each rule
 * renders in the sheet it answers, and the screen carries none of it.
 *
 * Both render through the sheet's portal, above which the navigation context
 * does not reach either — the step note's way to the project's own screen is
 * the imperative `router`, the same singleton `details.tsx` pushes with.
 */

/** The participants rule, inside the participants and visibility editors. */
export function WhoSeesProjectNote() {
	const { t } = useTranslation();

	return (
		<View style={{ gap: space.xs }}>
			<Header>{t("detail.whoSeesProject")}</Header>
			<Hint>{t("detail.whoSeesProjectBody")}</Hint>
		</View>
	);
}

/**
 * The assignees rule, inside the assignees editor of a step — with the way to
 * the project's own screen, from the editor that just explained why you would
 * want it.
 */
export function WhoSeesStepNote({
	project,
	rootId,
}: {
	project: string;
	/** The project this step belongs to — where the action goes. */
	rootId: string;
}) {
	const { t } = useTranslation();

	return (
		<View style={{ gap: space.xs }}>
			<Header>{t("detail.whoSeesStep")}</Header>
			<Hint>{t("detail.whoSeesStepBody")}</Hint>
			<Action
				icon="account-multiple-outline"
				onPress={() => router.push(detailsHref(rootId))}
			>
				{t("detail.assigneesChange", { project })}
			</Action>
		</View>
	);
}

/** A section heading inside the disclosure, so the two are not one paragraph. */
function Header({ children }: { children: string }) {
	return <Text variant="titleMedium">{children}</Text>;
}

/** A sentence that explains a control, in the same voice everywhere. */
function Hint({ children }: { children: string }) {
	const theme = useAppTheme();

	return (
		<Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
			{children}
		</Text>
	);
}

/** The action a hint offers, left-aligned under it and never full width. */
function Action({
	children,
	icon,
	onPress,
}: {
	children: string;
	icon: string;
	onPress: () => void;
}) {
	return (
		<Button
			mode="text"
			icon={icon}
			onPress={onPress}
			style={{ alignSelf: "flex-start" }}
			contentStyle={{ minHeight: touchTarget }}
		>
			{children}
		</Button>
	);
}
