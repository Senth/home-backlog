import { useIsFocused } from "@react-navigation/native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button, Divider, IconButton, Text } from "react-native-paper";
import { MetaChip } from "@/components/board/MetaChip";
import { BlockerSearchDialog } from "@/components/node/BlockerSearchDialog";
import { Row } from "@/components/ui/Row";
import { useAuth } from "@/contexts/AuthContext";
import type { NodeChanges } from "@/data/nodes";
import { useBlockerReads } from "@/hooks/use-blockers";
import { useOnlineStatus } from "@/hooks/use-online-status";
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
 * What this card waits on, and the one way to change it.
 *
 * Rendered **always**, between the notes and the people: an add affordance
 * nobody can find is a feature nobody has. One row per blocker — its title,
 * and its state, a *Done* chip when the blocker has completed and nothing
 * while it is still going. The state comes from one-shot `getNode` reads per
 * blocker id, taken fresh when the screen focuses
 * (`useBlockerReads`), so a reopened blocker re-blocks on return.
 *
 * A blocker that is gone or unreadable renders as the gone row, with its
 * remove action beside it: a mark with nothing behind it is Ingrid's "tapped
 * something and cannot find my way back", rebuilt as data. A read that could
 * not happen — offline — is *unanswered* instead: the row says it needs the
 * server rather than loading forever. Nothing here ever
 * removes an entry by itself — stopping is a person's tap, and it queues
 * offline like every other field write.
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
	const [searching, setSearching] = useState(false);

	const blockers = useBlockerReads(homeId, node.blockedBy, focused);

	const stopWaiting = (id: string) =>
		onSave({
			blockedBy: node.blockedBy.filter((current) => current !== id),
		});

	return (
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
		</View>
	);
}
