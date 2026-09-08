import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import {
	Button,
	Divider,
	Icon,
	Text,
	TouchableRipple,
} from "react-native-paper";
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
import { icon as iconSize, radius, space, touchTarget } from "@/theme/tokens";

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
 * is explained once, in the disclosure below, rather than in a grey sentence per
 * control on a screen somebody opened to write down a date.
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
				</View>
			) : null}
		</>
	);
}

/**
 * The two rules about people, folded away until somebody wants them.
 *
 * The screen used to explain itself in grey sentences under the controls, on
 * every card at every depth, whether or not anything was confusing. They are
 * one disclosure instead, titled with the question the confused person is
 * actually asking — *Who can see what?* rather than "Looking for something
 * else?", which in Swedish reads as a shop's search box and gives nobody a
 * reason to open it.
 *
 * It carries the *Change who's in on…* action that used to sit permanently under
 * the assignee list: on a step, that is the way to the project's own screen, and
 * inside the section that just explained why you would want to go there.
 */
export function WhoSeesWhat({
	node,
	project,
}: {
	node: Node;
	/** The root's title — what the action names. */
	project: string;
}) {
	const { t } = useTranslation();
	const router = useRouter();
	const theme = useAppTheme();
	const [expanded, setExpanded] = useState(false);

	return (
		// One tinted panel, header and body together. Opened, the body used to sit
		// full-bleed on the page under a hairline — the same weight and the same
		// rule as the `Steps` section right below it — so the explainer read as the
		// top of `Steps` rather than as something that had just opened.
		<View
			style={{
				backgroundColor: theme.colors.surfaceVariant,
				borderRadius: radius.sm,
				overflow: "hidden",
			}}
		>
			{/* Not `List.Accordion`, for the third time in this codebase after
			    `Checkbox.Item` and `MetaChip`: it hard-codes
			    `accessibilityState={{ expanded }}` on its own row and forwards no
			    override, and React Native Web 0.21 dropped the object form of that
			    prop — so the header announces as a plain button that never says
			    whether it is open. Verified in the browser: `aria-expanded` was
			    absent both collapsed and expanded. The row carries the semantics
			    here, the way `CheckRow` does. */}
			<TouchableRipple
				onPress={() => setExpanded(!expanded)}
				accessibilityRole="button"
				aria-expanded={expanded}
				accessibilityLabel={t("detail.whoSeesWhat")}
				style={{
					minHeight: touchTarget,
					justifyContent: "center",
					paddingHorizontal: space.md,
				}}
			>
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						gap: space.md,
						paddingVertical: space.sm,
					}}
				>
					<Text
						variant="bodyLarge"
						style={{ flex: 1, color: theme.colors.onSurfaceVariant }}
					>
						{t("detail.whoSeesWhat")}
					</Text>
					<Icon
						source={expanded ? "chevron-up" : "chevron-down"}
						size={iconSize.md}
						color={theme.colors.onSurfaceVariant}
					/>
				</View>
			</TouchableRipple>

			{expanded ? (
				<View
					style={{
						gap: space.md,
						paddingHorizontal: space.md,
						paddingBottom: space.md,
					}}
				>
					<View style={{ gap: space.xs }}>
						<Header>{t("detail.whoSeesProject")}</Header>
						<Hint>{t("detail.whoSeesProjectBody")}</Hint>
					</View>

					<Divider />

					<View style={{ gap: space.xs }}>
						<Header>{t("detail.whoSeesStep")}</Header>
						<Hint>{t("detail.whoSeesStepBody")}</Hint>
					</View>

					{/* The way to the project's own screen, from the section that just
				    explained why you would want it. Not on the project itself: that
				    is a push to the screen you are standing on, which stacks a second
				    identical details screen behind the back arrow — and the control
				    it would take you to is one scroll up. */}
					{rootIdOf(node) === node.id ? null : (
						<Action
							icon="account-multiple-outline"
							onPress={() => router.push(detailsHref(rootIdOf(node)))}
						>
							{t("detail.assigneesChange", { project })}
						</Action>
					)}
				</View>
			) : null}
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
