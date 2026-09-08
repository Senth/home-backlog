import { useIsFocused } from "@react-navigation/native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button, Divider, IconButton, Text } from "react-native-paper";
import { MetaChip } from "@/components/board/MetaChip";
import { BlockerSearchDialog } from "@/components/node/BlockerSearchDialog";
import { DetailRow } from "@/components/node/DetailRow";
import { AppSheet } from "@/components/ui/AppSheet";
import { PaperIcon } from "@/components/ui/PaperIcon";
import { Row } from "@/components/ui/Row";
import { useAuth } from "@/contexts/AuthContext";
import type { NodeChanges } from "@/data/nodes";
import { useBlockerReads } from "@/hooks/use-blockers";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { allBlockersDone, leadBlocker } from "@/models/blockers";
import type { Node } from "@/models/node";
import { useAppTheme } from "@/theme";
import { icon, space, touchTarget, touchTargetStyle } from "@/theme/tokens";

interface WaitingOnSectionProps {
	homeId: string;
	/** The card that waits. */
	node: Node;
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
 * that came back gone, resolves to nothing the row can name — the sheet, one
 * tap away, shows every entry in its honest state.
 *
 * The sheet is today's section: one row per blocker with its state and its
 * remove action, and the add button over the search dialog. Stopping is still
 * a person's tap and queues offline like every other field write — a row
 * collapse must not take the only way back out of a wait.
 */
export function WaitingOnSection({
	homeId,
	node,
	onSave,
}: WaitingOnSectionProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const { user } = useAuth();
	const focused = useIsFocused();
	const online = useOnlineStatus();
	const [open, setOpen] = useState(false);
	const [searching, setSearching] = useState(false);

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
			// same not-yet the section's rows showed as *Loading*, never a hole:
			// the card is waiting, and the row may not pretend it is not.
			<Text variant="bodyMedium">{t("common.loading")}</Text>
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

			{/* Mounted only while open — see `CardMenu`'s dialogs. The dismiss is
			    guarded on `searching`: Escape runs both dismissals in one tick
			    while the search dialog is up, and the sheet must not take the
			    dialog's keystroke with it. */}
			{open ? (
				<AppSheet
					visible
					onDismiss={() => {
						if (!searching) setOpen(false);
					}}
					testID={`waiting-${node.id}`}
				>
					<View style={{ gap: space.sm }}>
						<Text
							variant="labelLarge"
							style={{ color: theme.colors.onSurfaceVariant }}
						>
							{t("detail.waitingOn")}
						</Text>

						{node.blockedBy.length === 0 ? null : (
							<View>
								{node.blockedBy.map((id) => {
									// Unanswered holds its row — the same not-yet direction the
									// face mark takes. `null` is a read that came back gone.
									// Offline the read cannot happen at all: say so instead of
									// loading forever, the way the search dialog admits it.
									const blocker = blockers.get(id);
									const title =
										blocker === undefined
											? t(online ? "common.loading" : "board.offlineHint")
											: (blocker?.title ?? t("detail.blockerGone"));

									return (
										<View key={id}>
											<Divider />
											<Row
												title={title}
												right={
													<View
														style={{
															flexDirection: "row",
															alignItems: "center",
															gap: space.sm,
														}}
													>
														{blocker !== undefined &&
														blocker !== null &&
														blocker.status === "done" ? (
															<MetaChip>{t("detail.blockerDone")}</MetaChip>
														) : null}
														<IconButton
															icon="close"
															size={icon.sm}
															accessibilityLabel={
																// A label with no title to name — the read
																// is pending/offline or came back gone —
																// must not make the hint or the sentence
																// its object ("Stop waiting on Needs a
																// connection."); both use the no-title key.
																blocker === undefined || blocker === null
																	? t("detail.stopWaitingOnGone")
																	: t("detail.stopWaitingOn", {
																			title,
																		})
															}
															onPress={() => stopWaiting(id)}
															style={touchTargetStyle}
														/>
													</View>
												}
											/>
										</View>
									);
								})}
								<Divider />
							</View>
						)}

						<Button
							mode="contained-tonal"
							icon="plus"
							onPress={() => setSearching(true)}
							contentStyle={{ minHeight: touchTarget }}
							style={{ alignSelf: "flex-start" }}
						>
							{t("detail.waitingAdd")}
						</Button>
					</View>

					{searching ? (
						<BlockerSearchDialog
							homeId={homeId}
							uid={user?.uid ?? null}
							node={node}
							onDismiss={() => setSearching(false)}
							onPick={(id) => onSave({ blockedBy: [...node.blockedBy, id] })}
							onUnpick={stopWaiting}
							testID={`blocker-search-${node.id}`}
						/>
					) : null}
				</AppSheet>
			) : null}
		</>
	);
}
