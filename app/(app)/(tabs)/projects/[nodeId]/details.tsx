import { useIsFocused } from "@react-navigation/native";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { ActivityIndicator, Appbar, Snackbar } from "react-native-paper";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { boardHref, goneHref } from "@/components/board/board-href";
import { ChoiceField } from "@/components/node/ChoiceField";
import { DueDateField } from "@/components/node/DueDateField";
import { NotesField } from "@/components/node/NotesField";
import { StepsSection } from "@/components/node/StepsSection";
import { useHome } from "@/contexts/HomeContext";
import { type NodeChanges, updateNode } from "@/data/nodes";
import { useNode } from "@/hooks/use-node";
import { efforts, priorities } from "@/models/node";
import { useAppTheme } from "@/theme";
import { contentWidth, space } from "@/theme/tokens";

/**
 * Everything about one card that is not its title: its due date, priority,
 * effort and notes — and, below them, its steps.
 *
 * A real route beside the board rather than a sheet over it, so reload, the PWA
 * back gesture and a shared link all land here. It is the same screen at every
 * width; the desktop idea of a details panel pinned beside the status columns is
 * real and belongs to #31, which owns desktop layout — building it here would
 * mean two layouts for one content definition before the content has been used
 * once.
 *
 * Every control writes on the spot. A picker needs no acknowledgement, because
 * the control showing the new value *is* the acknowledgement.
 */
export default function NodeDetails() {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const { nodeId } = useLocalSearchParams<{ nodeId: string }>();
	const { activeHome } = useHome();
	const focused = useIsFocused();

	// A missing param must subscribe to nothing rather than to the wrong node —
	// scoping the home to null is what says "wait". It is a required segment of
	// this route, so this only ever holds for a frame.
	const id = nodeId ?? null;
	const homeId = id === null ? null : (activeHome?.id ?? null);
	const { node, gone } = useNode(homeId, id);

	const [failed, setFailed] = useState(false);

	// Where "up" is once the card has stopped existing, remembered while it still
	// does: a deleted card cannot say who its parent was.
	const parentId = useRef<string | null>(null);
	useEffect(() => {
		if (node !== null) parentId.current = node.parentId;
	}, [node]);

	// A card can be deleted, with its whole subtree, while somebody else is
	// looking at its details. Only the focused screen may navigate — deleting a
	// project takes everything under it, so every stacked screen below sees this
	// in the same tick and they would race for where you end up.
	useEffect(() => {
		if (gone && focused) router.dismissTo(goneHref(parentId.current));
	}, [gone, focused]);

	const save = (changes: NodeChanges) => {
		if (homeId === null || id === null) return;

		updateNode(homeId, id, changes).catch((reason) => {
			console.error("Could not save the card:", reason);
			setFailed(true);
		});
	};

	if (id === null) return null;

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header>
				{/* The parent board, explicitly. This screen is reachable with no
				    in-app history — a reload, a bookmark, a shared link — and there
				    `router.back()` is a no-op that logs "GO_BACK was not handled by
				    any navigator" and leaves the arrow dead. The same trap the board
				    hit. */}
				<Appbar.BackAction
					accessibilityLabel={t("board.up")}
					onPress={() => router.dismissTo(boardHref(node?.parentId ?? null))}
				/>
				<Appbar.Content title={node?.title ?? ""} />
				<AccountMenu />
			</Appbar.Header>

			{node === null ? (
				<ActivityIndicator
					accessibilityLabel={t("common.loading")}
					style={{ marginTop: space.xl }}
				/>
			) : (
				<ScrollView
					contentContainerStyle={{
						padding: space.md,
						gap: space.lg,
						alignSelf: "center",
						width: "100%",
						maxWidth: contentWidth.form,
					}}
				>
					<DueDateField
						label={t("detail.dueDate")}
						value={node.dueDate}
						onChange={(dueDate) => save({ dueDate })}
					/>

					<ChoiceField
						label={t("detail.priority")}
						value={node.priority}
						values={priorities}
						labelFor={(value) => t(`priority.${value}`)}
						onChange={(priority) => save({ priority })}
					/>

					{/* Kept at every child count, though `PROJECT.md` says effort is for
					    tasks rather than projects. "Tasks only" is enforced where effort
					    is *used* — quick wins and the split nudge (#56) both take
					    `childCount === 0` — rather than by a control that vanishes: the
					    nudge fires on *effort ≥ a weekend and no children*, so accepting
					    it and adding a first step would delete the field that fired it
					    from view. */}
					<ChoiceField
						label={t("detail.effort")}
						value={node.effort}
						values={efforts}
						labelFor={(value) => t(`effort.${value}`)}
						onChange={(effort) => save({ effort })}
					/>

					{/* Keyed on the node, so the same screen re-pointed at another card
					    starts with that card's notes rather than carrying an unsaved
					    draft across — the autosave state is per card, not per screen. */}
					<NotesField
						key={node.id}
						label={t("detail.notes")}
						stored={node.notes}
						onSave={(notes) => save({ notes })}
					/>

					{homeId === null ? null : (
						<StepsSection
							homeId={homeId}
							node={node}
							onOpenBoard={() => router.push(boardHref(node.id))}
						/>
					)}
				</ScrollView>
			)}

			<Snackbar visible={failed} onDismiss={() => setFailed(false)}>
				{t("error.saveFailed")}
			</Snackbar>
		</View>
	);
}
