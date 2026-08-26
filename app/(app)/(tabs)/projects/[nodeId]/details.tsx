import { useIsFocused } from "@react-navigation/native";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, useWindowDimensions, View } from "react-native";
import {
	ActivityIndicator,
	Appbar,
	Menu,
	Snackbar,
	Text,
} from "react-native-paper";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { boardHref, goneHref } from "@/components/board/board-href";
import { TitleDialog } from "@/components/board/TitleDialog";
import { ChoiceField } from "@/components/node/ChoiceField";
import { DueDateField } from "@/components/node/DueDateField";
import { FlipDialog, useFlip } from "@/components/node/FlipDialog";
import { NotesField } from "@/components/node/NotesField";
import { PeopleSection, WhoSeesWhat } from "@/components/node/PeopleSection";
import { StepsSection } from "@/components/node/StepsSection";
import { VisibilityField } from "@/components/node/VisibilityField";
import { useAuth } from "@/contexts/AuthContext";
import { useHome } from "@/contexts/HomeContext";
import { type NodeChanges, updateNode } from "@/data/nodes";
import { useNode } from "@/hooks/use-node";
import { membersOf } from "@/models/home";
import { efforts, priorities, rootIdOf } from "@/models/node";
import { useAppTheme } from "@/theme";
import {
	appBarStackBreakpoint,
	contentWidth,
	space,
	touchTargetStyle,
} from "@/theme/tokens";

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
	const { width } = useWindowDimensions();
	const { nodeId } = useLocalSearchParams<{ nodeId: string }>();
	const { activeHome } = useHome();
	const { user } = useAuth();
	const focused = useIsFocused();

	// A missing param must subscribe to nothing rather than to the wrong node —
	// scoping the home to null is what says "wait". It is a required segment of
	// this route, so this only ever holds for a frame.
	const id = nodeId ?? null;
	const homeId = id === null ? null : (activeHome?.id ?? null);
	const { node, gone } = useNode(homeId, id);

	/**
	 * The root of this card's subtree, which is what carries the participants
	 * both people-controls are built from.
	 *
	 * A **listener**, not the breadcrumb memo. `useAncestors` was built to resolve
	 * crumb *titles* and never invalidates within a session, which is exactly what
	 * a title wants and exactly wrong here: participants edited on the project
	 * would leave a step's assignee list narrowed to the old set, and the
	 * stale-assignee sentence saying something untrue until a reload. One more
	 * single-document listener, constrained and torn down with the screen.
	 *
	 * A node that is itself a root subscribes to nothing — `useNode` already
	 * holds that document, and pointing a second listener at it would pay twice
	 * for one answer.
	 */
	const rootId =
		node === null || node.parentId === null ? null : rootIdOf(node);
	const { node: ancestorRoot } = useNode(homeId, rootId);
	const root = node === null ? null : rootId === null ? node : ancestorRoot;

	const members = activeHome === null ? [] : membersOf(activeHome);
	const flip = useFlip(homeId ?? "");

	const [failed, setFailed] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const menuAnchor = useRef<View | null>(null);

	// Stable so Paper keeps its Escape handler — see `components/board/CardMenu.tsx`.
	const closeMenu = useCallback(() => setMenuOpen(false), []);

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
			<Appbar.Header
				// Three 48dp targets and the bar's padding leave a narrow screen no
				// room for a title — see `appBarStackBreakpoint`.
				mode={width < appBarStackBreakpoint ? "medium" : "small"}
			>
				{/* Wherever you came from, and never a dead arrow.
				    `router.back()` alone is the trap the board hit: on a screen
				    reached by a reload, a bookmark or a shared link there is no
				    history, and it becomes a no-op that logs "GO_BACK was not handled
				    by any navigator". `canGoBack()` is exactly that test.
				    The parent board alone is a different failure: these details are
				    reachable from the board's *own* app-bar action, where the stack is
				    [parent, board X, details X] — so dismissing to the parent pops
				    board X as well, and tapping the mark then back lands you a level
				    above where you started, with the board you were on gone. */}
				<Appbar.BackAction
					style={touchTargetStyle}
					accessibilityLabel={t("board.up")}
					onPress={() =>
						router.canGoBack()
							? router.back()
							: router.dismissTo(boardHref(node?.parentId ?? null))
					}
				/>
				<Appbar.Content title={node?.title ?? ""} />
				{node === null ? null : (
					<Menu
						visible={menuOpen}
						onDismiss={closeMenu}
						overlayAccessibilityLabel={t("common.closeMenu")}
						anchor={
							<View ref={menuAnchor}>
								<Appbar.Action
									style={touchTargetStyle}
									icon="dots-vertical"
									accessibilityLabel={t("board.actions")}
									onPress={() => setMenuOpen(true)}
								/>
							</View>
						}
					>
						<Menu.Item
							leadingIcon="pencil-outline"
							title={t("board.rename")}
							onPress={() => {
								closeMenu();
								setRenaming(true);
							}}
						/>
					</Menu>
				)}
				<AccountMenu />
			</Appbar.Header>

			{/* Mounted only while open — see `CardMenu`'s identical dialog. */}
			{renaming && node !== null ? (
				<TitleDialog
					visible
					onDismiss={() => setRenaming(false)}
					heading={t("board.renameTitle")}
					confirmLabel={t("board.rename")}
					initialTitle={node.title}
					onSubmit={(title) => save({ title })}
					testID={`rename-details-${node.id}`}
					returnFocusTo={menuAnchor}
				/>
			) : null}

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
					{/* One plain line, and only for a card an agent wrote.
					    Marcus curates everything and needs to know which of forty
					    cards a machine wrote; Ingrid needs to understand eleven cabin
					    cards that appeared at 03:00 without meeting the word "API".
					    Nothing on the card face — a chip there would mark every card
					    on the boards that are already fullest, which is the clutter
					    `PROJECT.md`'s overwhelm principle exists to prevent. */}
					{node.createdVia === "api" ? (
						<Text
							variant="bodySmall"
							style={{ color: theme.colors.onSurfaceVariant }}
						>
							{t("detail.createdViaApi")}
						</Text>
					) : null}

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

					{/* Whose project this is, who is doing this card, and whether it is
					    anybody else's business. All three are hidden while the home has
					    one member — in a house she lives in alone, participants (nobody
					    to involve), assignees (only her) and privacy (nothing to hide
					    from) are pure clutter on the screen Ingrid uses to write down
					    what the chimney sweep said, at 200 % text.

					    The one exception: a node that is *already* private always shows
					    the visibility control, so a home that drops back to one member
					    can undo it rather than being stuck with a setting it cannot
					    reach. */}
					{homeId === null || user === null ? null : (
						<>
							<PeopleSection
								node={node}
								root={root}
								members={members}
								onSave={save}
								flip={flip}
							/>

							{node.parentId === null &&
							(members.length > 1 || node.visibility === "private") ? (
								<VisibilityField
									node={node}
									members={members}
									uid={user.uid}
									flip={flip}
								/>
							) : null}

							{/* The two rules about people, once, folded away — rather
							    than a grey sentence under every control on a screen
							    somebody opened to write down a date. It sits below all
							    three controls because it explains all three, and only
							    where they render at all. */}
							{members.length > 1 && root !== null ? (
								<WhoSeesWhat node={node} project={root.title} />
							) : null}

							{/* One dialog for both controls: a private project's
							    participants are the same top-down subtree write the flip
							    is, and only one of them can be running. */}
							<FlipDialog state={flip} uid={user.uid} />
						</>
					)}

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
