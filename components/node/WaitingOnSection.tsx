import { useIsFocused } from "@react-navigation/native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Text } from "react-native-paper";
import { BlockerSearchDialog } from "@/components/node/BlockerSearchDialog";
import { DetailRow } from "@/components/node/DetailRow";
import { PaperIcon } from "@/components/ui/PaperIcon";
import { useAuth } from "@/contexts/AuthContext";
import type { NodeChanges } from "@/data/nodes";
import { useBlockerReads } from "@/hooks/use-blockers";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { allBlockersDone, leadBlocker } from "@/models/blockers";
import type { Node } from "@/models/node";
import { useAppTheme } from "@/theme";
import { icon, space } from "@/theme/tokens";

interface WaitingOnSectionProps {
	homeId: string;
	/** The card that waits. */
	node: Node;
	/**
	 * The cards sharing this card's board — the screen's own `useNodes`
	 * listener (#237), passed down rather than heard twice. The picker's
	 * *On this board* group is these, free and working offline.
	 */
	siblings: readonly Node[];
	onSave: (changes: NodeChanges) => void;
}

/**
 * The *Waiting on* row (#237), collapsed out of the section of blocker rows.
 *
 * The value comes from phase 1's rules, so the row and the card face cannot
 * disagree about what waiting means: `leadBlocker` names the one blocker the
 * card waits on first — `Book the plumber +3` — and `allBlockersDone` turns
 * the row into `✓ All 4 done` in `success`, the state in which the card face
 * stops drawing the waiting entry at all. A read that has not landed yet, or
 * that came back gone, resolves to nothing the row can name.
 *
 * The row opens the picker (#237 PK2): picked blockers ticked with their
 * states, the board's own cards under *On this board*, the home-wide search
 * under *Everywhere else*. Stopping is a tap on the ticked row, and queues
 * offline like every other field write — a row collapse must not take the
 * only way back out of a wait.
 */
export function WaitingOnSection({
	homeId,
	node,
	siblings,
	onSave,
}: WaitingOnSectionProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const { user } = useAuth();
	const focused = useIsFocused();
	const online = useOnlineStatus();
	const [open, setOpen] = useState(false);

	const blockers = useBlockerReads(homeId, node.blockedBy, focused);

	const stopWaiting = (id: string) =>
		onSave({
			blockedBy: node.blockedBy.filter((current) => current !== id),
		});

	const lead = leadBlocker(node.blockedBy, blockers);
	const allDone = allBlockersDone(node.blockedBy, blockers);

	const value =
		allDone === true ? (
			<View
				style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}
			>
				<PaperIcon name="check" size={icon.sm} color={theme.colors.success} />
				<Text variant="bodyMedium" style={{ color: theme.colors.success }}>
					{t("detail.waitingAllDone", { count: node.blockedBy.length })}
				</Text>
			</View>
		) : lead !== null ? (
			<Text variant="bodyMedium">
				{node.blockedBy.length > 1
					? t("detail.waitingLead", {
							title: lead.title,
							more: node.blockedBy.length - 1,
						})
					: lead.title}
			</Text>
		) : node.blockedBy.length === 0 ? (
			<Text variant="bodyMedium">{t("detail.waitingNone")}</Text>
		) : (
			// The list is stored but not one read has named a blocker yet — the
			// same not-yet the face mark takes, never a hole. Offline the read
			// cannot happen at all: say so instead of loading forever.
			<Text variant="bodyMedium">
				{t(online ? "common.loading" : "board.offlineHint")}
			</Text>
		);

	return (
		<>
			<DetailRow
				glyph="timer-sand"
				name={t("detail.waitingOn")}
				onPress={() => setOpen(true)}
				testID={`field-waiting-${node.id}`}
				value={value}
			/>

			{/* Mounted only while open — the sheet is the picker itself (#237),
			    so there is one dismissal and one Escape: the sheet's own. */}
			{open ? (
				<BlockerSearchDialog
					homeId={homeId}
					uid={user?.uid ?? null}
					node={node}
					siblings={siblings}
					blockers={blockers}
					onDismiss={() => setOpen(false)}
					onPick={(id) => onSave({ blockedBy: [...node.blockedBy, id] })}
					onUnpick={stopWaiting}
					testID={`waiting-${node.id}`}
				/>
			) : null}
		</>
	);
}
