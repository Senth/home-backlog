import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button, Chip, Text } from "react-native-paper";
import { AppDialog, ConfirmDialog } from "@/components/ui/AppDialog";
import { type FlipProgress, flipVisibility } from "@/data/nodes";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { formatList } from "@/i18n/format-list";
import type { Member } from "@/models/home";
import type { Node, Visibility } from "@/models/node";
import { useAppTheme } from "@/theme";
import { outlinedTouchTarget, space, touchTarget } from "@/theme/tokens";

const confirmTestID = "visibility-confirm-dialog";
const progressTestID = "visibility-progress-dialog";

const choices: readonly Visibility[] = ["shared", "private"];

interface VisibilityFieldProps {
	homeId: string;
	/** A **root** node. Visibility is a question about a project. */
	node: Node;
	members: readonly Member[];
	uid: string;
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
 * **The flip is the dangerous part, and the danger is the half-finished one.**
 * Uniform visibility means every descendant physically carries the same value,
 * so making a project private is *n* writes that cannot be batched — a rule's
 * `get()` reads committed state, so a child written ahead of its parent fails
 * inheritance. Hence:
 *
 * - **offline the control is disabled with a hint**, the pattern `Move under…`
 *   and `Delete` already use. Queuing it optimistically would show a private
 *   project that is not private yet;
 * - **a confirm dialog** that names the people and counts the work in words;
 * - **a progress dialog that cannot be dismissed while writing** — letting
 *   somebody walk away mid-flip is how a mixed subtree gets abandoned;
 * - **a failure state with *Try again***, which re-reads and finishes, because
 *   `flipVisibility` is idempotent.
 *
 * Walking away from a failure leaves cards at the old visibility: degraded and
 * honest, never orphaned, because `subtreeOf()` unions both subtree queries.
 */
export function VisibilityField({
	homeId,
	node,
	members,
	uid,
}: VisibilityFieldProps) {
	const { t, i18n } = useTranslation();
	const theme = useAppTheme();
	const online = useOnlineStatus();

	const [confirming, setConfirming] = useState<Visibility | null>(null);
	const [running, setRunning] = useState<Visibility | null>(null);
	const [progress, setProgress] = useState<FlipProgress | null>(null);
	const [failed, setFailed] = useState(false);

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

	const confirmBody = () => {
		if (confirming === "shared") {
			return t("visibility.confirmSharedBody", {
				count: node.childCount,
				title: node.title,
			});
		}

		const first = t("visibility.confirmPrivateBody", {
			count: node.childCount,
			title: node.title,
			keeping,
		});
		// The second sentence only when somebody really loses something. A home
		// where everyone is already a participant has nobody to name.
		return losing.length === 0
			? first
			: `${first} ${t("visibility.confirmPrivateLosing", {
					names: formatList(losing, i18n.language),
				})}`;
	};

	const run = async (target: Visibility) => {
		setConfirming(null);
		setFailed(false);
		setRunning(target);
		setProgress({ done: 0, total: 0 });

		try {
			await flipVisibility(homeId, node, target, uid, setProgress);
			setRunning(null);
			setProgress(null);
		} catch (reason) {
			console.error("Could not change who can see this project:", reason);
			setFailed(true);
		}
	};

	const close = () => {
		setRunning(null);
		setProgress(null);
		setFailed(false);
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
					{t("visibility.offlineHint")}
				</Text>
			)}

			{confirming === null ? null : (
				<ConfirmDialog
					visible
					onDismiss={() => setConfirming(null)}
					onConfirm={() => {
						void run(confirming);
					}}
					title={t(
						confirming === "private"
							? "visibility.confirmPrivateTitle"
							: "visibility.confirmSharedTitle",
					)}
					body={confirmBody()}
					confirmLabel={t("visibility.confirmAction")}
					testID={confirmTestID}
				/>
			)}

			{running === null || progress === null ? null : (
				<AppDialog
					visible
					// Not dismissable while the writes are going out: walking away
					// mid-flip is how a mixed subtree gets abandoned. Once it has
					// failed there is something to decide, so the actions arrive.
					onDismiss={failed ? close : noop}
					title={t(
						running === "private"
							? "visibility.confirmPrivateTitle"
							: "visibility.confirmSharedTitle",
					)}
					testID={progressTestID}
					actions={
						failed
							? [
									<Button
										key="close"
										onPress={close}
										textColor={theme.colors.onSurfaceVariant}
										contentStyle={{ minHeight: touchTarget }}
									>
										{t("common.dismiss")}
									</Button>,
									<Button
										key="retry"
										onPress={() => {
											void run(running);
										}}
										contentStyle={{ minHeight: touchTarget }}
									>
										{t("visibility.retry")}
									</Button>,
								]
							: []
					}
				>
					<Text variant="bodyMedium">
						{t(failed ? "visibility.failed" : "visibility.progress", {
							done: progress.done,
							total: progress.total,
						})}
					</Text>
				</AppDialog>
			)}
		</View>
	);
}

function noop() {}
