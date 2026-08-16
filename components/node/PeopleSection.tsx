import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button, Text } from "react-native-paper";
import { detailsHref } from "@/components/board/board-href";
import type { FlipState } from "@/components/node/FlipDialog";
import { PeopleField } from "@/components/node/PeopleField";
import { useAuth } from "@/contexts/AuthContext";
import { boardOnce, type NodeChanges, reparentNode } from "@/data/nodes";
import { useOnlineStatus } from "@/hooks/use-online-status";
import type { Member } from "@/models/home";
import {
	assignableMembers,
	effectiveParticipants,
	type Node,
	rankAtEnd,
	rootIdOf,
	staleAssignees,
} from "@/models/node";
import { useAppTheme } from "@/theme";
import { space, touchTarget } from "@/theme/tokens";

interface PeopleSectionProps {
	homeId: string;
	node: Node;
	/**
	 * The root of this node's subtree — the node itself when it is one, and
	 * `null` while its listener is still resolving.
	 */
	root: Node | null;
	members: readonly Member[];
	onSave: (changes: NodeChanges) => void;
	onError: () => void;
	/** Shared with the visibility control: one subtree write runs at a time. */
	flip: FlipState;
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
 * **Participants are root-only, and so is privacy.** Both answer a question
 * about a *project* rather than about a step inside one, so a household that
 * learns the rule once has learned it for both — and neither ever needs a
 * greyed-out inherited row on a descendant. A descendant carries one sentence
 * and the action that unblocks it, in the same place and the same shape for
 * both.
 */
export function PeopleSection({
	homeId,
	node,
	root,
	members,
	onSave,
	onError,
	flip,
}: PeopleSectionProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();
	const { user } = useAuth();
	const online = useOnlineStatus();

	const uid = user?.uid ?? null;
	const isRoot = node.parentId === null;
	const isPrivate = node.visibility === "private";
	const rootTitle = root?.title ?? "";
	const assignable = assignableMembers(root, members);
	const stale = staleAssignees(node, assignable);
	// Only worth saying where the list has actually been shortened, and only
	// where the control that would explain it is not right above.
	const narrowed = !isRoot && effectiveParticipants(root).length > 0;

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

	/**
	 * A step that has to be a project before it can be kept to anyone — the same
	 * call `Move under… › Top level` in `CardMenu` already makes, reading the root
	 * board once for the neighbours the new rank is computed against.
	 */
	const moveToTop = async () => {
		if (uid === null) return;

		try {
			const board = await boardOnce(homeId, null, uid);
			const last = board.filter((card) => card.status === node.status).at(-1);
			await reparentNode(
				homeId,
				node,
				null,
				rankAtEnd(last?.rank ?? null),
				uid,
			);
		} catch (reason) {
			console.error("Could not move the card to the top level:", reason);
			onError();
		}
	};

	if (members.length < 2) return null;

	return (
		<>
			{isRoot ? (
				<PeopleField
					label={t(
						isPrivate ? "detail.participantsPrivate" : "detail.participants",
					)}
					members={members}
					value={node.participantIds}
					onChange={saveParticipants}
					unknownLabel={t("members.unknown")}
					// On a private project you are the one person who cannot come off
					// it: `allow update` requires `visibleToMe(request.resource.data)`,
					// so the write is refused, and a checkbox that silently refuses is
					// the failure this whole control was rebuilt to avoid.
					lockedUid={isPrivate ? (uid ?? undefined) : undefined}
					lockedHint={t("detail.participantsYouStay")}
					// Only the private path needs a connection — it is n
					// server-checked writes. The shared one queues like any edit.
					disabled={isPrivate && !online}
					disabledHint={t("board.offlineHint")}
				/>
			) : null}

			<View style={{ gap: space.sm }}>
				<PeopleField
					label={t("detail.assignees")}
					members={assignable}
					value={node.assigneeIds}
					onChange={(assigneeIds) => onSave({ assigneeIds })}
					unknownLabel={t("members.unknown")}
				/>

				{/* Why the list is shorter than the household. With the default-hide
				    filter shipping here, assigning somebody a step inside a project
				    they are not a participant of would hand them work that is hidden
				    from their board and reachable from nowhere — so adding them to the
				    project is what makes the task findable, and this is the way there. */}
				{narrowed ? (
					<>
						<Hint>{t("detail.assigneesNarrowed", { project: rootTitle })}</Hint>
						<Action
							icon="account-multiple-outline"
							onPress={() => router.push(detailsHref(rootIdOf(node)))}
						>
							{t("detail.assigneesChange", { project: rootTitle })}
						</Action>
					</>
				) : null}

				{/* Somebody assigned who has *since* been dropped from the project, or
				    who has left the home. A real state, and deliberately shown rather
				    than hidden: it is information, and drawing it as an orphaned checked
				    box outside its own list is what would make it read as a bug. */}
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
			</View>

			{/* Where the visibility control is on a descendant, and what to do about
			    it. One sentence and the action that unblocks it, rather than a dimmed
			    control with nothing to say about where its value came from. */}
			{isRoot ? null : (
				<View style={{ gap: space.xs }}>
					<Hint>{t("detail.privateOnlyProjects")}</Hint>
					<Action
						icon="arrow-up-bold-outline"
						onPress={moveToTop}
						// It reads the subtree from the server on purpose — "no children
						// in the cache" is not "no children" — so the hint says what it
						// needs rather than letting the tap fail after the fact.
						disabled={!online}
					>
						{t("detail.privateMoveUp", { title: node.title })}
					</Action>
					{online ? null : (
						<Text
							variant="bodySmall"
							style={{ color: theme.colors.onSurfaceVariant }}
						>
							{t("board.offlineHint")}
						</Text>
					)}
				</View>
			)}
		</>
	);
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
	disabled,
}: {
	children: string;
	icon: string;
	onPress: () => void;
	disabled?: boolean;
}) {
	return (
		<Button
			mode="text"
			icon={icon}
			onPress={onPress}
			disabled={disabled}
			style={{ alignSelf: "flex-start" }}
			contentStyle={{ minHeight: touchTarget }}
		>
			{children}
		</Button>
	);
}
