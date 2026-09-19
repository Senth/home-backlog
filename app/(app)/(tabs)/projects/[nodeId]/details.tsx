import { useIsFocused } from "@react-navigation/native";
import { router, useLocalSearchParams } from "expo-router";
import {
	type ReactElement,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, useWindowDimensions, View } from "react-native";
import {
	ActivityIndicator,
	Appbar,
	Divider,
	Menu,
	Snackbar,
	Text,
} from "react-native-paper";
import { boardHref, goneHref } from "@/components/board/board-href";
import { PriorityDot } from "@/components/board/PriorityDot";
import { TitleDialog } from "@/components/board/TitleDialog";
import { LabelGlyph } from "@/components/label/LabelGlyph";
import { LabelPicker } from "@/components/label/LabelPicker";
import { ChoiceField } from "@/components/node/ChoiceField";
import { ColumnBar } from "@/components/node/ColumnBar";
import { DetailCard } from "@/components/node/DetailCard";
import { DetailRow } from "@/components/node/DetailRow";
import { DueDateField } from "@/components/node/DueDateField";
import { FlipDialog, useFlip } from "@/components/node/FlipDialog";
import { LocationPicker } from "@/components/node/LocationPicker";
import { NotesField } from "@/components/node/NotesField";
import { PeopleSection } from "@/components/node/PeopleSection";
import { StepsSection } from "@/components/node/StepsSection";
import { VisibilityField } from "@/components/node/VisibilityField";
import { WaitingOnSection } from "@/components/node/WaitingOnSection";
import { AppSheet } from "@/components/ui/AppSheet";
import { BackAction } from "@/components/ui/BackAction";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useHome } from "@/contexts/HomeContext";
import { type NodeChanges, updateNode } from "@/data/nodes";
import { useAncestors } from "@/hooks/use-ancestors";
import { useLocations } from "@/hooks/use-locations";
import { useNode } from "@/hooks/use-node";
import { useNodes } from "@/hooks/use-nodes";
import { formatList } from "@/i18n/format-list";
import { formatCalendarDay } from "@/models/due-date";
import { membersOf } from "@/models/home";
import { maxLabelsPerNode } from "@/models/label";
import type { Node } from "@/models/node";
import {
	assignableMembers,
	defaultColumns,
	effectiveLocation,
	efforts,
	prioritiesHighFirst,
	rootIdOf,
} from "@/models/node";
import { useAppTheme } from "@/theme";
import {
	appBarStackBreakpoint,
	contentWidth,
	size,
	space,
	touchTargetStyle,
} from "@/theme/tokens";

/** The field editor a row has open. Its sheet mounts only while open. */
type Editor =
	| "priority"
	| "effort"
	| "due"
	| "participants"
	| "assignees"
	| "visibility";

/**
 * One row a field (#237).
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
	const { t, i18n } = useTranslation();
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

	/**
	 * The board the card sits on: the parent's frozen column set for the bar's
	 * ramp, and the siblings a destination rank is computed against (#237).
	 * `useNodes` is the same listener the phase 5 picker wants, so it is held
	 * once here and passed down. A root has no parent document, and takes
	 * `defaultColumns` — the set every board it could sit on reads.
	 */
	const { node: parent } = useNode(homeId, node?.parentId ?? null);
	const board = useNodes(homeId, node?.parentId ?? null);
	const columns = parent?.columns ?? defaultColumns;

	// The trail above the card (#290): the location row and its picker answer
	// for the nearest place an ancestor passes down when the card carries none
	// of its own. `useAncestors` is the cached read the breadcrumbs resolve —
	// a crumb it cannot answer contributes no place, the neutral answer it
	// renders.
	const { crumbs } = useAncestors(homeId, node?.ancestorIds ?? []);
	const trail = crumbs.map((crumb) => crumb.node);

	const members = activeHome === null ? [] : membersOf(activeHome);
	const assignable = assignableMembers(root, members);
	const flip = useFlip(homeId ?? "");

	// The location tree (#50), heard once here and passed down — the card
	// face's footer reads titles from it, and so does the row below (#246).
	const { locations } = useLocations(homeId);
	const locationTitles = new Map(
		locations.map((location) => [location.id, location.title]),
	);

	const [failed, setFailed] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const [labelling, setLabelling] = useState(false);
	const [locating, setLocating] = useState(false);
	const [editor, setEditor] = useState<Editor | null>(null);
	const menuAnchor = useRef<View | null>(null);

	// Stable so Paper keeps its Escape handler — see `components/board/CardMenu.tsx`.
	const closeMenu = useCallback(() => setMenuOpen(false), []);
	const closeEditor = useCallback(() => setEditor(null), []);

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

	const nameOfUid = (uid: string) =>
		activeHome?.memberProfiles?.[uid]?.displayName || t("members.unknown");

	/** The people value on a row: initials, named once for the whole group. */
	const avatarsOf = (uids: readonly string[]) => (
		<View
			accessible
			accessibilityLabel={formatList(uids.map(nameOfUid), i18n.language)}
			style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}
		>
			{uids.map((uid) => (
				<PersonAvatar
					key={uid}
					name={nameOfUid(uid)}
					photoURL={activeHome?.memberProfiles?.[uid]?.photoURL ?? null}
					px={size.avatarXs}
				/>
			))}
		</View>
	);

	/**
	 * The ten rows in the settled order (#237, #246): Steps · Priority · Time
	 * needed · Location · Labels · Waiting on · Due by · Who can see it · Who's
	 * in it · Who's doing it. The people rows keep today's visibility rules —
	 * hidden in a one-member home, except a node already private.
	 */
	const rowsOf = (current: Node) => {
		const ownLabels = (activeHome?.labels ?? [])
			.filter((label) => current.labelIds.includes(label.id))
			.slice(0, maxLabelsPerNode);
		// The place the card answers to (#290) — its own, or the nearest one an
		// ancestor passes down.
		const at = effectiveLocation(current, trail);
		const place =
			at === null ? null : (locationTitles.get(at.locationId) ?? null);

		return [
			homeId === null ? null : (
				<StepsSection
					key="steps"
					homeId={homeId}
					node={current}
					onOpenBoard={() => router.push(boardHref(current.id))}
				/>
			),
			<DetailRow
				key="priority"
				glyph="thermometer"
				name={t("detail.priority")}
				testID={`field-priority-${current.id}`}
				onPress={() => setEditor("priority")}
				// The ✕ clears where the value sits, without the trip through
				// the sheet; it only exists while there is something to clear.
				onClear={
					current.priority === null ? undefined : () => save({ priority: null })
				}
				clearLabel={t("detail.clearField", { what: t("detail.priority") })}
				value={
					current.priority === null ? (
						<Text variant="bodyMedium">{t("detail.notSet")}</Text>
					) : (
						<View
							style={{
								flexDirection: "row",
								alignItems: "center",
								gap: space.xs,
							}}
						>
							{/* The ramp dot beside its word: the one value the brief
							    sharpens, the same mark the card's gutter draws. */}
							<PriorityDot priority={current.priority} />
							<Text variant="bodyMedium">
								{t(`priority.${current.priority}`)}
							</Text>
						</View>
					)
				}
			/>,
			<DetailRow
				key="effort"
				glyph="clock-outline"
				name={t("detail.effort")}
				testID={`field-effort-${current.id}`}
				onPress={() => setEditor("effort")}
				value={
					<Text variant="bodyMedium">
						{current.effort === null
							? t("detail.notSet")
							: t(`effort.${current.effort}`)}
					</Text>
				}
			/>,
			<DetailRow
				key="location"
				glyph="crosshairs-gps"
				name={t("detail.location")}
				testID={`field-location-${current.id}`}
				onPress={() => setLocating(true)}
				value={<Text variant="bodyMedium">{place ?? t("detail.notSet")}</Text>}
			/>,
			homeId === null ? null : (
				<DetailRow
					key="labels"
					glyph="tag-outline"
					name={t("detail.labels")}
					testID={`field-labels-${current.id}`}
					onPress={() => setLabelling(true)}
					value={
						ownLabels.length === 0 ? (
							<Text variant="bodyMedium">{t("detail.labelsNone")}</Text>
						) : (
							// The card's own labels only, as today: what the trail
							// passes down is true of the card but not of this control.
							<View
								style={{
									flexDirection: "row",
									flexWrap: "wrap",
									justifyContent: "flex-end",
									gap: space.xs,
								}}
							>
								{ownLabels.map((label) => (
									<LabelGlyph
										key={label.id}
										color={label.color}
										icon={label.icon}
									/>
								))}
							</View>
						)
					}
				/>
			),
			homeId === null ? null : (
				<WaitingOnSection
					key="waiting"
					homeId={homeId}
					node={current}
					siblings={board.nodes}
					onSave={save}
				/>
			),
			<DetailRow
				key="due"
				glyph="calendar"
				name={t("detail.dueDate")}
				testID={`field-due-${current.id}`}
				onPress={() => setEditor("due")}
				value={
					<Text
						variant="bodyMedium"
						style={
							current.dueDate === null
								? undefined
								: { color: theme.colors.warning }
						}
					>
						{current.dueDate === null
							? t("detail.addDate")
							: formatCalendarDay(current.dueDate, i18n.language)}
					</Text>
				}
			/>,
			current.parentId === null &&
			(members.length > 1 || current.visibility === "private") ? (
				<DetailRow
					key="visibility"
					glyph="eye-outline"
					name={t("detail.whoCanSee")}
					testID={`field-visibility-${current.id}`}
					onPress={() => setEditor("visibility")}
					value={
						<Text variant="bodyMedium">
							{t(
								current.visibility === "private"
									? "detail.visibilityPrivate"
									: "detail.visibilityShared",
							)}
						</Text>
					}
				/>
			) : null,
			current.parentId === null && members.length > 1 ? (
				<DetailRow
					key="participants"
					glyph="account-multiple-outline"
					name={t("detail.whoIsIn")}
					testID={`field-participants-${current.id}`}
					onPress={() => setEditor("participants")}
					value={
						current.participantIds.length === 0
							? null
							: avatarsOf(current.participantIds)
					}
				/>
			) : null,
			members.length > 1 &&
			root !== null &&
			(assignable.length > 1 || current.assigneeIds.length > 0) ? (
				<DetailRow
					key="assignees"
					glyph="account-outline"
					name={t("detail.whoIsDoing")}
					testID={`field-assignees-${current.id}`}
					onPress={() => setEditor("assignees")}
					value={
						current.assigneeIds.length === 0 ? (
							<Text variant="bodyMedium">{t("detail.assigneesNone")}</Text>
						) : (
							avatarsOf(current.assigneeIds)
						)
					}
				/>
			) : null,
		].filter((row): row is ReactElement => row !== null);
	};

	if (id === null) return null;

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header
				// Three 48dp targets and the bar's padding leave a narrow screen no
				// room for a title — see `appBarStackBreakpoint`.
				mode={width < appBarStackBreakpoint ? "medium" : "small"}
				// The card is the screen's subject, and the face at the top of the
				// scroll is where it says so (#237): the bar merges into the page
				// instead of drawing a band of its own above it. `transparent`
				// names an absence, and no palette entry could replace it.
				style={{ backgroundColor: "transparent" }}
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
				<BackAction
					accessibilityLabel={t("board.up")}
					onPress={() =>
						router.canGoBack()
							? router.back()
							: router.dismissTo(boardHref(node?.parentId ?? null))
					}
				/>
				{/* The bar names the screen, not the card — the card face below is
			    where the card says its own name, and repeating it here left a
			    long title with nowhere to go (#237, the settled mock). */}
				<Appbar.Content title={t("detail.title")} />
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
					style={{ flex: 1 }}
					contentContainerStyle={{
						padding: space.md,
						// The bar has given up its own band, so the card sits one
						// `space.sm` under it (#237) — closer than the sections
						// below, because it is the thing this screen opened for.
						paddingTop: space.sm,
						gap: space.lg,
						alignSelf: "center",
						width: "100%",
						maxWidth: contentWidth.form,
					}}
				>
					{/* The card the screen is about, then the only free text
					    anyone wrote on it. Both sit above the fields: the face is
					    what was tapped, the note is what someone said. */}
					{homeId === null ? null : (
						<DetailCard
							homeId={homeId}
							node={node}
							locations={locationTitles}
							onRename={() => setRenaming(true)}
							onOpenCrumb={(crumbId) => router.dismissTo(boardHref(crumbId))}
						/>
					)}

					{/* Keyed on the node, so the same screen re-pointed at another card
					    starts with that card's notes rather than carrying an unsaved
					    draft across — the autosave state is per card, not per screen. */}
					<NotesField
						key={node.id}
						label={t("detail.notes")}
						stored={node.notes}
						onSave={(notes) => save({ notes })}
					/>

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

					{/* One row a field, hairline between: the value is why the row
					    exists, the chevron says the whole row opens. Every editor
					    mounts only while open, in an `AppSheet` below. */}
					<View>
						{rowsOf(node).flatMap((row, index) => [
							<Divider key={`before-${row.key ?? index}`} />,
							row,
						])}
						<Divider />
					</View>

					{/* One dialog for both controls: a private project's
					    participants are the same top-down subtree write the flip
					    is, and only one of them can be running. The who-sees-what
					    explanation rode along here until phase 5 moved it inside
					    the editors it explains (#237). */}
					{user === null ? null : <FlipDialog state={flip} uid={user.uid} />}
				</ScrollView>
			)}

			{/* The bar at the foot (#237): a card moved without going back to
			    the board. It rides the card's own listener — the name here is
			    the name the card's status carries, never local state. */}
			{node !== null && homeId !== null ? (
				<ColumnBar
					homeId={homeId}
					node={node}
					columns={columns}
					nodes={board.nodes}
					onFailed={() => setFailed(true)}
				/>
			) : null}

			{/* The field editors, mounted only while open — the way `CardMenu`'s
			    dialogs are. Each holds today's control unchanged; the sheet is the
			    container the plan's decision chose over a centered dialog. */}
			{editor === "priority" && node !== null ? (
				<AppSheet
					visible
					onDismiss={closeEditor}
					testID={`editor-priority-${node.id}`}
				>
					<ChoiceField
						label={t("detail.priority")}
						value={node.priority}
						values={prioritiesHighFirst}
						labelFor={(value) => t(`priority.${value}`)}
						onChange={(priority) => save({ priority })}
						adornment={(value) => <PriorityDot priority={value} />}
					/>
				</AppSheet>
			) : null}

			{editor === "effort" && node !== null ? (
				<AppSheet
					visible
					onDismiss={closeEditor}
					testID={`editor-effort-${node.id}`}
				>
					{/* Kept at every child count, though `PROJECT.md` says effort is
					    for tasks rather than projects. "Tasks only" is enforced where
					    effort is *used* — the quick-wins and split nudge — rather than
					    by a control that vanishes. */}
					<ChoiceField
						label={t("detail.effort")}
						value={node.effort}
						values={efforts}
						labelFor={(value) => t(`effort.${value}`)}
						onChange={(effort) => save({ effort })}
					/>
				</AppSheet>
			) : null}

			{editor === "due" && node !== null ? (
				<AppSheet
					visible
					onDismiss={closeEditor}
					testID={`editor-due-${node.id}`}
				>
					<DueDateField
						label={t("detail.dueDate")}
						value={node.dueDate}
						onChange={(dueDate) => save({ dueDate })}
					/>
				</AppSheet>
			) : null}

			{editor === "visibility" && node !== null && user !== null ? (
				<AppSheet
					visible
					onDismiss={closeEditor}
					testID={`editor-visibility-${node.id}`}
				>
					<VisibilityField
						node={node}
						members={members}
						uid={user.uid}
						flip={flip}
					/>
				</AppSheet>
			) : null}

			{editor === "participants" && node !== null && user !== null ? (
				<AppSheet
					visible
					onDismiss={closeEditor}
					testID={`editor-participants-${node.id}`}
				>
					<PeopleSection
						node={node}
						root={root}
						members={members}
						onSave={save}
						flip={flip}
						only="participants"
						uid={user.uid}
					/>
				</AppSheet>
			) : null}

			{editor === "assignees" && node !== null && user !== null ? (
				<AppSheet
					visible
					onDismiss={closeEditor}
					testID={`editor-assignees-${node.id}`}
				>
					<PeopleSection
						node={node}
						root={root}
						members={members}
						onSave={save}
						flip={flip}
						only="assignees"
						uid={user.uid}
					/>
				</AppSheet>
			) : null}

			{/* Mounted only while open — see `CardMenu`'s dialogs. */}
			{labelling && homeId !== null && node !== null ? (
				<LabelPicker
					homeId={homeId}
					labels={activeHome?.labels ?? []}
					node={node}
					onDismiss={() => setLabelling(false)}
					testID={`label-picker-${node.id}`}
				/>
			) : null}

			{/* Mounted only while open — see `CardMenu`'s dialogs. */}
			{locating && homeId !== null && node !== null ? (
				<LocationPicker
					locations={locations}
					node={node}
					effectiveLocationId={
						effectiveLocation(node, trail)?.locationId ?? null
					}
					onDismiss={() => setLocating(false)}
					onSave={save}
					testID={`location-picker-${node.id}`}
				/>
			) : null}

			<Snackbar visible={failed} onDismiss={() => setFailed(false)}>
				{t("error.saveFailed")}
			</Snackbar>
		</View>
	);
}
