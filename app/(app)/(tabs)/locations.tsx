import { useNavigation } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import {
	ActivityIndicator,
	Appbar,
	Button,
	FAB,
	Icon,
	Snackbar,
	Text,
} from "react-native-paper";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { LocationDialog } from "@/components/location/LocationDialog";
import {
	LocationDragOverlay,
	LocationTree,
} from "@/components/location/LocationRow";
import {
	screenKey,
	useLocationDrag,
} from "@/components/location/use-location-drag";
import { BackAction } from "@/components/ui/BackAction";
import { useHome } from "@/contexts/HomeContext";
import { locationErrorKey, moveLocation } from "@/data/locations";
import { useBoardFilter } from "@/hooks/use-board-filter";
import { useEscapeCancel } from "@/hooks/use-escape-cancel";
import { useLocationCounts } from "@/hooks/use-location-counts";
import { useLocations } from "@/hooks/use-locations";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { locationFilter } from "@/models/board-filter";
import { dropHint } from "@/models/location-drag";
import {
	beginMove,
	cancelMove,
	idleMove,
	type MoveMode,
	selectDestination,
} from "@/models/location-move";
import { childLocations, type Location } from "@/models/locations";
import { rankAtEnd } from "@/models/node";
import { useAppTheme } from "@/theme";
import {
	border,
	contentWidth,
	denseBreakpoint,
	fab as fabTokens,
	icon,
	radius,
	space,
	touchTarget,
} from "@/theme/tokens";

const newLocationDialogTestID = "new-location-dialog";

/** `null` is the top level. */
type AddTarget = { parent: Location | null } | null;

/**
 * The location tree — the second hierarchy, of places (#50).
 *
 * One row per place; the depth is carried by the rails, not by padding. The
 * FAB creates a root place; a row's overflow menu reorders, nests, edits,
 * moves and deletes. Create and edit queue offline; move and delete read the
 * subtree from the server first, so they are disabled offline with the hint
 * the card menu shows, rather than failing after the tap.
 *
 * A row is three sibling controls and nothing nested — a pressable inside a
 * pressable rendered invalid HTML on every load (#205). The row itself and
 * its rails are `components/location/LocationRow.tsx`'s.
 *
 * The app bar names the *home*, not the screen — the tab bar already names
 * the screen, and which home you are in has to be visible without a tap.
 */
export default function Locations() {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();
	const { activeHome } = useHome();
	const { width } = useWindowDimensions();
	const online = useOnlineStatus();

	const homeId = activeHome?.id ?? null;
	const { locations, loading, failed, retry } = useLocations(homeId);
	const { setFilter } = useBoardFilter(homeId);
	const { pool, counts } = useLocationCounts(homeId, locations);

	/** Collapsed, not expanded: the tree opens expanded, and session-only. */
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	/** Cards hidden by default (#205); the toggle is the control row's. */
	const [cardsOpen, setCardsOpen] = useState(false);
	/** The move-under mode (Q14) — idle means the tree browses. */
	const [move, setMove] = useState<MoveMode>(idleMove);
	const [adding, setAdding] = useState<AddTarget>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [fabHeight, setFabHeight] = useState(0);
	const openerRef = useRef<View | null>(null);
	const navigation = useNavigation();

	// The drag is the one move a gesture makes, and it writes the same
	// `moveLocation` the move mode does — offline the hook never starts.
	const drag = useLocationDrag({
		homeId: homeId ?? "",
		locations,
		onPutBack: () => setNotice("locations.putBack"),
		onError: (reason) => {
			console.error("Could not move the location:", reason);
			setNotice(locationErrorKey(reason));
		},
	});
	// The drop indicator is what the model already decided, drawn: a highlight
	// for a re-parent, an empty recessed slot between the blocks for a reorder
	// or an outdent.
	const hint = drag.over === null ? null : dropHint(drag.over, locations);
	const gapHeight = drag.overlay?.height ?? space.none;

	// The tab bar stays live, and leaving cancels silently: a blur ends the
	// mode before another tab can act on a half-run one.
	useEffect(
		() => navigation.addListener("blur", () => setMove(idleMove)),
		[navigation],
	);

	// Escape and the back gesture answer the same cancel — a mode is not a
	// navigation push, so the back button must not leave the screen.
	useEscapeCancel(move.phase !== "idle", () => setMove(cancelMove()));

	/** The card face's location facts: id → place, from the one tree listener. */
	const locationsById = new Map(locations.map((l) => [l.id, l]));

	const fabInset = fabHeight > 0 ? fabHeight + space.md + space.md : space.xxl;

	const toggle = (id: string) => {
		setCollapsed((previous) => {
			const next = new Set(previous);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const collapseAll = () => {
		setCollapsed(
			new Set(
				locations
					.filter(
						(location) => childLocations(locations, location.id).length > 0,
					)
					.map((location) => location.id),
			),
		);
	};

	const expandAll = () => setCollapsed(new Set());

	/**
	 * The tap is the row's reason to exist (#204): the board filtered to this
	 * place and everything under it — the same reach the row's count answers
	 * to, so the place delivers the number it promised. This replaces whatever
	 * filter the member already had, and it persists for a day; the chips on
	 * the board make the new state visible at once.
	 */
	const openPlace = (location: Location) => {
		setFilter(locationFilter(location.id));
		router.push("/projects");
	};

	/**
	 * The move itself, written only from the confirm phase: one batch, the
	 * moved place at the end of its new siblings. Offline the write reads the
	 * subtree from the server and fails loudly, which is why the menu item
	 * that starts the mode is disabled offline instead.
	 */
	const confirmMove = () => {
		if (move.phase !== "confirm" || homeId === null) return;
		const { moving, parent } = move;
		setMove(idleMove);
		const siblings = childLocations(locations, parent?.id ?? null);
		moveLocation(
			homeId,
			moving,
			parent,
			rankAtEnd(siblings.at(-1)?.rank ?? null),
		).catch((reason) => {
			console.error("Could not move the location:", reason);
			setNotice(locationErrorKey(reason));
		});
	};

	const empty = !loading && !failed && locations.length === 0;
	const showTree = !loading && !failed && locations.length > 0;
	const moveActive = move.phase !== "idle";

	const footBarStyle = {
		position: "absolute" as const,
		left: space.md,
		right: space.md,
		bottom: space.md,
		flexDirection: "row" as const,
		alignItems: "center" as const,
		gap: space.sm,
		padding: space.md,
		borderRadius: radius.md,
		backgroundColor: theme.colors.elevation.level2,
	};

	return (
		<View
			ref={drag.register(screenKey)}
			collapsable={false}
			style={{ flex: 1, backgroundColor: theme.colors.background }}
		>
			<Appbar.Header>
				<BackAction
					accessibilityLabel={
						moveActive ? t("common.cancel") : t("homes.title")
					}
					onPress={() => {
						if (moveActive) {
							setMove(cancelMove());
						} else {
							router.push("/homes");
						}
					}}
				/>
				<Appbar.Content title={activeHome?.name ?? ""} />
				<AccountMenu />
			</Appbar.Header>

			<ScrollView
				contentContainerStyle={{
					padding: space.md,
					paddingBottom: fabInset,
					alignSelf: "center",
					width: "100%",
					maxWidth: contentWidth.tree,
				}}
			>
				{loading ? (
					<ActivityIndicator
						accessibilityLabel={t("common.loading")}
						style={{ marginTop: space.xl }}
					/>
				) : null}

				{/* Said instead of the empty state, never next to it: "add the
				    places around your home" and "could not load" are contradictory
				    instructions, and only one of them is true. */}
				{failed ? (
					<View style={{ gap: space.md, paddingVertical: space.lg }}>
						<Text
							variant="bodyLarge"
							style={{
								color: theme.colors.onSurfaceVariant,
								textAlign: "center",
							}}
						>
							{t("screen.locations.loadFailed")}
						</Text>
						<Button
							mode="contained-tonal"
							icon="refresh"
							onPress={retry}
							contentStyle={{ minHeight: touchTarget }}
						>
							{t("common.retry")}
						</Button>
					</View>
				) : null}

				{/* The homes screen's empty-state-onboarding: what the places are
				    for, and the one create control. The FAB stands down while this
				    is up — one primary action per surface. */}
				{empty ? (
					<View
						style={{
							alignItems: "center",
							gap: space.md,
							paddingVertical: space.xl,
						}}
					>
						<Text variant="titleMedium">{t("locations.emptyTitle")}</Text>
						<Text
							variant="bodyLarge"
							style={{
								color: theme.colors.onSurfaceVariant,
								textAlign: "center",
							}}
						>
							{t("locations.emptyBody")}
						</Text>
						<Button
							ref={openerRef}
							mode="contained"
							icon="plus"
							onPress={() => setAdding({ parent: null })}
							contentStyle={{ minHeight: touchTarget }}
						>
							{t("locations.add")}
						</Button>
					</View>
				) : null}

				{/* The control row: the tree's two disclosures in one place, so
				    a deep tree never needs a walk to tidy; the cards toggle rides
				    beside them. Session-only, like the collapsed set itself. A
				    drag starts nowhere offline, and the row is where the screen
				    says why — before the gesture, not after a dead one. */}
				{showTree ? (
					<View
						style={{
							flexDirection: "row",
							flexWrap: "wrap",
							gap: space.sm,
							marginBottom: space.md,
						}}
					>
						<Button
							mode="outlined"
							icon="unfold-less-horizontal"
							onPress={collapseAll}
							// The row wraps below the phone's width, and a wrapped line
							// starts at the same left edge as the one above it — buttons
							// that stretch to the row's rhythm keep their edges exactly
							// on each other's instead of a fraction of a pixel off.
							style={{ flexGrow: 1 }}
							contentStyle={{ minHeight: touchTarget }}
						>
							{t("locations.collapseAll")}
						</Button>
						<Button
							mode="outlined"
							icon="unfold-more-horizontal"
							onPress={expandAll}
							style={{ flexGrow: 1 }}
							contentStyle={{ minHeight: touchTarget }}
						>
							{t("locations.expandAll")}
						</Button>
						<Button
							mode="outlined"
							icon={cardsOpen ? "eye-off-outline" : "eye-outline"}
							onPress={() => setCardsOpen((open) => !open)}
							accessibilityRole="button"
							style={{ flexGrow: 1 }}
							contentStyle={{ minHeight: touchTarget }}
						>
							{t(cardsOpen ? "locations.hideCards" : "locations.showCards")}
						</Button>
						{online ? null : (
							<Text
								variant="bodySmall"
								style={{
									color: theme.colors.onSurfaceVariant,
									alignSelf: "center",
								}}
							>
								{t("locations.dragOffline")}
							</Text>
						)}
					</View>
				) : null}

				{/* The mode's synthetic row, pinned above the tree and visible only
				    during a move (Q14): every destination, the top level included,
				    is then one list. Refused is impossible here — the top level is
				    no place's subtree. */}
				{moveActive ? (
					<Pressable
						accessible
						accessibilityRole="button"
						accessibilityLabel={t("locations.moveUnderTop")}
						accessibilityState={{
							selected: move.phase === "confirm" && move.parent === null,
						}}
						onPress={() => setMove(selectDestination(move, null))}
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: space.sm,
							minHeight: touchTarget,
							marginBottom: space.sm,
							paddingHorizontal: space.sm,
							borderRadius: radius.md,
							borderWidth: border.hairline,
							borderColor:
								move.phase === "confirm" && move.parent === null
									? theme.colors.primary
									: theme.colors.outlineVariant,
						}}
					>
						<Icon
							source="home-variant-outline"
							size={icon.md}
							color={theme.colors.onSurfaceVariant}
						/>
						<Text variant="bodyLarge" style={{ flex: 1 }}>
							{t("locations.moveUnderTop")}
						</Text>
						{move.phase === "confirm" && move.parent === null ? (
							<Icon
								source="check"
								size={icon.md}
								color={theme.colors.primary}
							/>
						) : null}
					</Pressable>
				) : null}

				{showTree ? (
					<LocationTree
						locations={locations}
						parentId={null}
						collapsed={collapsed}
						counts={counts}
						cardsOpen={cardsOpen}
						pool={pool}
						locationTitles={locationsById}
						mode={move}
						onToggle={toggle}
						onOpen={openPlace}
						onAddUnder={(parent) => setAdding({ parent })}
						onMoveUnder={(location) => setMove(beginMove(location))}
						onSelectDestination={(parent) =>
							setMove(selectDestination(move, parent))
						}
						onError={setNotice}
						homeId={homeId ?? ""}
						online={online}
						drag={drag}
						hint={hint}
						gapHeight={gapHeight}
					/>
				) : null}
			</ScrollView>

			{/* The same two footprint caps the board's and Overview's FABs carry:
			    a share of the width it floats over, and the words over the glyph
			    below `denseBreakpoint`. Stands down while the empty state is up —
			    its button is then the one create control. */}
			{/* The FAB stands down while a move runs — the foot bar below is then
			    the loudest shape on the screen, and the mode is unmistakable. */}
			{showTree && !moveActive ? (
				<FAB
					ref={openerRef}
					icon={width < denseBreakpoint ? undefined : "plus"}
					label={t("locations.add")}
					onPress={() => setAdding({ parent: null })}
					onLayout={(event) => setFabHeight(event.nativeEvent.layout.height)}
					style={{
						position: "absolute",
						right: space.md,
						bottom: space.md,
						maxWidth: width * fabTokens.widthShare,
					}}
				/>
			) : null}

			{/* The mode's foot bar: first it asks, then it confirms (Q14).
			    Confirm is the one contained-tonal action — the affirmative — and
			    Cancel and Escape and back all answer the same way: idle, with
			    nothing written. */}
			{move.phase === "choose" ? (
				<View style={footBarStyle}>
					<Text variant="bodyLarge">
						{t("locations.moveBar", { name: move.moving.title })}
					</Text>
				</View>
			) : null}
			{move.phase === "confirm" ? (
				<View style={footBarStyle}>
					<Text variant="bodyLarge" style={{ flex: 1 }}>
						{t("locations.moveConfirm", {
							name: move.moving.title,
							destination: move.parent?.title ?? t("locations.moveUnderTop"),
						})}
					</Text>
					<Button
						mode="text"
						onPress={() => setMove(cancelMove())}
						textColor={theme.colors.onSurfaceVariant}
						contentStyle={{ minHeight: touchTarget }}
					>
						{t("common.cancel")}
					</Button>
					<Button
						mode="contained-tonal"
						onPress={confirmMove}
						contentStyle={{ minHeight: touchTarget }}
					>
						{t("locations.moveHere")}
					</Button>
				</View>
			) : null}

			{adding !== null ? (
				<LocationDialog
					homeId={homeId ?? ""}
					location={null}
					parent={adding.parent}
					siblings={childLocations(locations, adding.parent?.id ?? null)}
					onDismiss={() => setAdding(null)}
					testID={newLocationDialogTestID}
					returnFocusTo={openerRef}
				/>
			) : null}

			{/* The carried place, following the finger; the row it belongs to
			    waits flattened where it was. */}
			{drag.dragged !== null ? <LocationDragOverlay drag={drag} /> : null}

			<Snackbar
				visible={notice !== null}
				onDismiss={() => setNotice(null)}
				style={{
					maxWidth: contentWidth.snackbar,
					alignSelf: "center",
					marginBottom: space.md,
				}}
			>
				{notice ? t(notice) : ""}
			</Snackbar>
		</View>
	);
}
