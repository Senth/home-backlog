import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Chip, Text } from "react-native-paper";
import type { FlipState } from "@/components/node/FlipDialog";
import { WhoSeesProjectNote } from "@/components/node/PeopleSection";
import { ConfirmDialog } from "@/components/ui/AppDialog";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { formatList } from "@/i18n/format-list";
import type { Member } from "@/models/home";
import { hasSteps, type Node, type Visibility } from "@/models/node";
import { useAppTheme } from "@/theme";
import { outlinedTouchTarget, space } from "@/theme/tokens";

const confirmTestID = "visibility-confirm-dialog";

const choices: readonly Visibility[] = ["shared", "private"];

interface VisibilityFieldProps {
	/** A **root** node. Visibility is a question about a project. */
	node: Node;
	members: readonly Member[];
	uid: string;
	/** Shared with the participants control: one flip runs at a time. */
	flip: FlipState;
}

/**
 * Whether a project is anybody else's business.
 *
 * A two-choice control shaped like priority and effort, so it never has to say
 * "only me" about a project two people share — private is *the people on it*,
 * not one person, and the rules have always allowed several. Two members
 * planning something for a third in the same household have no other way to
 * express it.
 *
 * The confirm dialog names the people and says what happens to the work, and it
 * is careful in both directions:
 *
 * - it says **"and everything in it"** rather than a count. The flip writes the
 *   whole subtree, and `childCount` is the direct children only — a project of
 *   three tasks with six steps each would have promised "its 3 steps" and then
 *   counted to 22 in the progress dialog, which is a privacy confirmation
 *   understating its own blast radius;
 * - going **shared** it adds that the project stays off other people's boards
 *   while its participants are set. The permission really does change; the
 *   observable outcome does not, and saying only the first would be a promise
 *   the other member's board immediately breaks.
 *
 * Offline the control is disabled with a hint, the pattern `Move under…` and
 * `Delete` already use: queuing a flip optimistically would show a private
 * project that is not private yet.
 */
export function VisibilityField({
	node,
	members,
	uid,
	flip,
}: VisibilityFieldProps) {
	const { t, i18n } = useTranslation();
	const theme = useAppTheme();
	const online = useOnlineStatus();

	const [confirming, setConfirming] = useState<Visibility | null>(null);

	const nameOf = (member: Member) => member.displayName || t("members.unknown");

	// Who a flip to private would keep in, and who it would shut out. The root's
	// own participants come along — a project two people have already claimed
	// becomes a private project they can both still see — and the actor is always
	// in it, because the rules refuse a private document its author could not read
	// back.
	const keepingIds = [uid, ...node.participantIds.filter((id) => id !== uid)];
	const keeping = formatList(
		[
			t("visibility.you"),
			...members
				.filter(
					(member) => member.uid !== uid && keepingIds.includes(member.uid),
				)
				.map(nameOf),
		],
		i18n.language,
	);
	const losing = members
		.filter((member) => !keepingIds.includes(member.uid))
		.map(nameOf);

	const titleFor = (target: Visibility) =>
		t(
			target === "private"
				? "visibility.confirmPrivateTitle"
				: "visibility.confirmSharedTitle",
		);

	const confirmBody = (target: Visibility) => {
		const deep = hasSteps(node);

		if (target === "shared") {
			const first = t(
				deep
					? "visibility.confirmSharedBodyAll"
					: "visibility.confirmSharedBody",
				{ title: node.title },
			);
			// The root keeps its participants when it goes shared — that list is
			// "whose project" again — so for anybody not on it the card is readable
			// and still hidden by default.
			const stillHidden =
				node.participantIds.length > 0 &&
				members.some((member) => !node.participantIds.includes(member.uid));
			return stillHidden
				? `${first} ${t("visibility.confirmSharedStillHidden")}`
				: first;
		}

		const first = t(
			deep
				? "visibility.confirmPrivateBodyAll"
				: "visibility.confirmPrivateBody",
			{ title: node.title, keeping },
		);
		// The second sentence only when somebody really loses something. A home
		// where everyone is already a participant has nobody to name.
		return losing.length === 0
			? first
			: `${first} ${t("visibility.confirmPrivateLosing", {
					names: formatList(losing, i18n.language),
				})}`;
	};

	return (
		<View style={{ gap: space.sm }}>
			<Text
				variant="labelLarge"
				style={{ color: theme.colors.onSurfaceVariant }}
			>
				{t("detail.visibility")}
			</Text>
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
				{choices.map((choice) => {
					const selected = choice === node.visibility;

					return (
						<Chip
							key={choice}
							mode={selected ? "flat" : "outlined"}
							selected={selected}
							showSelectedCheck={false}
							disabled={!online}
							// The one it is already on is not an action. Unlike priority
							// and effort there is no way back to unset: every node has a
							// visibility, and one of the two is always true.
							onPress={() => {
								if (!selected) setConfirming(choice);
							}}
							// See `ChoiceField`: the object form is not forwarded by React
							// Native Web, and Paper's chip is a `<button>`.
							aria-pressed={selected}
							style={{ minHeight: outlinedTouchTarget }}
						>
							{t(
								choice === "private"
									? "detail.visibilityPrivate"
									: "detail.visibilityShared",
							)}
						</Chip>
					);
				})}
			</View>
			{online ? null : (
				<Text
					variant="bodySmall"
					style={{ color: theme.colors.onSurfaceVariant }}
				>
					{t("board.offlineHint")}
				</Text>
			)}

			{/* What the participants list is *for* — the rule that used to sit on
			    the screen under these controls, now in the editor it explains. */}
			<WhoSeesProjectNote />

			{confirming === null ? null : (
				<ConfirmDialog
					visible
					onDismiss={() => setConfirming(null)}
					onConfirm={() => {
						const target = confirming;
						setConfirming(null);
						flip.run({ node, target, title: titleFor(target) }, uid);
					}}
					title={titleFor(confirming)}
					body={confirmBody(confirming)}
					confirmLabel={t("visibility.confirmAction")}
					testID={confirmTestID}
				/>
			)}
		</View>
	);
}
