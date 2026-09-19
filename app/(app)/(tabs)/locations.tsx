import { useRouter } from "expo-router";
import { type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, useWindowDimensions, View } from "react-native";
import {
	ActivityIndicator,
	Appbar,
	Button,
	FAB,
	Icon,
	IconButton,
	Menu,
	Snackbar,
	Text,
	TouchableRipple,
} from "react-native-paper";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { LocationDialog } from "@/components/location/LocationDialog";
import { ConfirmDialog } from "@/components/ui/AppDialog";
import { BackAction } from "@/components/ui/BackAction";
import { useHome } from "@/contexts/HomeContext";
import {
	deleteLocation,
	locationErrorKey,
	moveLocation,
	reorderLocation,
} from "@/data/locations";
import { useLocations } from "@/hooks/use-locations";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { inSubtree, type Location } from "@/models/locations";
import { movedRank, rankAtEnd } from "@/models/node";
import { useAppTheme } from "@/theme";
import {
	contentWidth,
	denseBreakpoint,
	fab as fabTokens,
	icon,
	indent,
	space,
	touchTarget,
} from "@/theme/tokens";

const newLocationDialogTestID = "new-location-dialog";

/** `null` is the top level. */
type AddTarget = { parent: Location | null } | null;

/**
 * The location tree — the second hierarchy, of places (#50).
 *
 * One row per location, indented by depth, one listener for the whole
 * collection behind it. The FAB creates a root place; a row's overflow menu
 * reorders, nests, edits, moves and deletes. Create and edit queue offline;
 * move and delete read the subtree from the server first, so they
 * are disabled offline with the hint the card menu shows, rather than failing
 * after the tap.
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

	/** Collapsed, not expanded: the tree opens expanded, and session-only. */
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const [adding, setAdding] = useState<AddTarget>(null);
	const [error, setError] = useState<string | null>(null);
	const [fabHeight, setFabHeight] = useState(0);
	const openerRef = useRef<View | null>(null);

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

	const rows: ReactNode[] = [];
	if (!loading && !failed && locations.length > 0) {
		const renderLevel = (parentId: string | null, depth: number) => {
			for (const location of childrenOf(locations, parentId)) {
				const hasChildren = childrenOf(locations, location.id).length > 0;
				const expanded = !collapsed.has(location.id);
				rows.push(
					<LocationRow
						key={location.id}
						homeId={homeId ?? ""}
						location={location}
						depth={depth}
						hasChildren={hasChildren}
						expanded={expanded}
						onToggle={toggle}
						locations={locations}
						online={online}
						onAddUnder={(parent) => setAdding({ parent })}
						onError={setError}
					/>,
				);
				if (hasChildren && expanded) renderLevel(location.id, depth + 1);
			}
		};
		renderLevel(null, 0);
	}

	const empty = !loading && !failed && locations.length === 0;

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header>
				<BackAction
					accessibilityLabel={t("homes.title")}
					onPress={() => router.push("/homes")}
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
					maxWidth: contentWidth.form,
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

				{rows.length > 0 ? <View>{rows}</View> : null}
			</ScrollView>

			{/* The same two footprint caps the board's and Overview's FABs carry:
			    a share of the width it floats over, and the words over the glyph
			    below `denseBreakpoint`. Stands down while the empty state is up —
			    its button is then the one create control. */}
			{rows.length > 0 ? (
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

			{adding !== null ? (
				<LocationDialog
					homeId={homeId ?? ""}
					location={null}
					parent={adding.parent}
					siblings={childrenOf(locations, adding.parent?.id ?? null)}
					onDismiss={() => setAdding(null)}
					testID={newLocationDialogTestID}
					returnFocusTo={openerRef}
				/>
			) : null}

			<Snackbar
				visible={error !== null}
				onDismiss={() => setError(null)}
				style={{
					maxWidth: contentWidth.snackbar,
					alignSelf: "center",
					marginBottom: space.md,
				}}
			>
				{error ? t(error) : ""}
			</Snackbar>
		</View>
	);
}

function childrenOf(
	locations: Location[],
	parentId: string | null,
): Location[] {
	return locations.filter((location) => location.parentId === parentId);
}

type RowPage = "root" | "under";

interface LocationRowProps {
	homeId: string;
	location: Location;
	depth: number;
	hasChildren: boolean;
	expanded: boolean;
	onToggle: (id: string) => void;
	/** Every location in the home — the move picker's destinations. */
	locations: Location[];
	online: boolean;
	onAddUnder: (parent: Location) => void;
	onError: (message: string) => void;
}

/**
 * One place, its chevron, and everything it can do.
 *
 * The chevron-and-indent chrome is quiet on purpose — a chevron of
 * `onSurfaceVariant` and an indent capped by depth — because the names are
 * the content. The row with children is the disclosure control itself, the
 * way the details screen's is: `List.Accordion` hard-codes an accessibility
 * state React Native Web drops, so the row carries `aria-expanded` and the
 * chevron is a plain `Icon`. Delete lives only in the menu — never a swipe,
 * never a long-press.
 *
 * The menu changes *page* rather than opening a submenu, and the pages after
 * the first scroll inside the height Paper measured on the first one — the
 * same one-measurement shape `CardMenu` works around.
 */
function LocationRow({
	homeId,
	location,
	depth,
	hasChildren,
	expanded,
	onToggle,
	locations,
	online,
	onAddUnder,
	onError,
}: LocationRowProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const anchor = useRef<View | null>(null);
	const [open, setOpen] = useState(false);
	const [page, setPage] = useState<RowPage>("root");
	const [editing, setEditing] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [rootPageHeight, setRootPageHeight] = useState<number | undefined>(
		undefined,
	);

	const close = () => {
		setOpen(false);
		setPage("root");
	};

	/**
	 * Moving the place and everything under it. The moved place's own subtree
	 * is disabled in the picker, so the throw in `moveLocation` should never
	 * fire — it is the write-time backstop, not the refusal.
	 */
	const moveUnder = (parent: Location | null) => {
		close();
		const siblings = childrenOf(locations, parent?.id ?? null);
		moveLocation(
			homeId,
			location,
			parent,
			rankAtEnd(siblings.at(-1)?.rank ?? null),
		).catch((reason) => {
			console.error("Could not move the location:", reason);
			onError(locationErrorKey(reason));
		});
	};

	const siblings = childrenOf(locations, location.parentId);
	const siblingIndex = siblings.findIndex((each) => each.id === location.id);

	/** One step up or down among siblings, queued optimistically like a rename. */
	const reorder = (delta: -1 | 1) => {
		close();
		const rank = movedRank(siblings, siblingIndex, delta);
		if (rank === null) return;
		reorderLocation(homeId, location.id, rank);
	};

	const remove = async () => {
		setDeleting(false);
		try {
			await deleteLocation(homeId, location);
		} catch (reason) {
			console.error("Could not delete the location:", reason);
			onError(locationErrorKey(reason));
		}
	};

	const row = (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				minHeight: touchTarget,
				gap: space.sm,
				paddingVertical: space.xs,
				paddingLeft: indent.step * Math.min(depth, indent.levels),
				paddingRight: space.sm,
			}}
		>
			{/* The chevron column is fixed width, so a childless name lines up
			    with a nested one at every depth and every text size. */}
			{hasChildren ? (
				<Icon
					source={expanded ? "chevron-down" : "chevron-right"}
					size={icon.sm}
					color={theme.colors.onSurfaceVariant}
				/>
			) : (
				<View style={{ width: icon.sm }} />
			)}
			<Text variant="bodyLarge" style={{ flex: 1 }}>
				{location.title}
			</Text>
			<Menu
				visible={open}
				onDismiss={close}
				overlayAccessibilityLabel={t("common.closeMenu")}
				anchor={
					<View ref={anchor}>
						<IconButton
							icon="dots-vertical"
							size={icon.sm}
							accessibilityLabel={t("locations.actions")}
							// Without this the row underneath takes the tap as well and
							// the chevron toggles while the menu opens.
							onPress={(event) => {
								event.stopPropagation();
								setOpen(true);
							}}
							style={{
								width: touchTarget,
								height: touchTarget,
								margin: space.none,
							}}
						/>
					</View>
				}
			>
				{page === "root" ? (
					<View
						onLayout={(event) =>
							setRootPageHeight(event.nativeEvent.layout.height)
						}
					>
						<Menu.Item
							leadingIcon="plus"
							title={t("locations.addUnder")}
							onPress={() => {
								close();
								onAddUnder(location);
							}}
						/>
						<Menu.Item
							leadingIcon="arrow-up"
							title={t("locations.moveUp")}
							disabled={siblingIndex === 0}
							onPress={() => reorder(-1)}
						/>
						<Menu.Item
							leadingIcon="arrow-down"
							title={t("locations.moveDown")}
							disabled={siblingIndex === siblings.length - 1}
							onPress={() => reorder(1)}
						/>
						<Menu.Item
							leadingIcon="file-tree-outline"
							title={t("locations.moveUnder")}
							onPress={() => setPage("under")}
							disabled={!online}
						/>
						<Menu.Item
							leadingIcon="pencil-outline"
							title={t("locations.edit")}
							onPress={() => {
								close();
								setEditing(true);
							}}
						/>
						<Menu.Item
							leadingIcon="delete-outline"
							title={t("locations.delete")}
							onPress={() => {
								close();
								setDeleting(true);
							}}
							disabled={!online}
						/>
						{/* Both disabled ones read from the server on purpose, so the
						    hint says what they need rather than letting the tap fail
						    after the fact. */}
						{online ? null : (
							<Menu.Item disabled title={t("board.offlineHint")} />
						)}
					</View>
				) : (
					<ScrollView style={{ maxHeight: rootPageHeight }}>
						<Menu.Item
							title={t("locations.moveUnderTop")}
							onPress={() => moveUnder(null)}
						/>
						{locations.map((candidate) => (
							<Menu.Item
								key={candidate.id}
								title={candidate.title}
								onPress={() => moveUnder(candidate)}
								// The moved place's own subtree, itself included: the
								// refusal is visible before it is committed.
								disabled={inSubtree(candidate, location.id)}
							/>
						))}
					</ScrollView>
				)}
			</Menu>
		</View>
	);

	return (
		<View>
			{hasChildren ? (
				/* The row carries the disclosure semantics, not a `List.Accordion`:
				    see the docblock. */
				<TouchableRipple
					onPress={() => onToggle(location.id)}
					accessibilityRole="button"
					aria-expanded={expanded}
					style={{ minHeight: touchTarget }}
				>
					{row}
				</TouchableRipple>
			) : (
				row
			)}

			{/* Mounted only while open — each dialog carries a `Portal`, and a
			    tree grows without bound. */}
			{editing ? (
				<LocationDialog
					homeId={homeId}
					location={location}
					parent={null}
					siblings={siblings}
					onDismiss={() => setEditing(false)}
					testID={`edit-location-${location.id}`}
					returnFocusTo={anchor}
				/>
			) : null}

			{deleting ? (
				<ConfirmDialog
					visible
					onDismiss={() => setDeleting(false)}
					onConfirm={remove}
					title={t("locations.deleteTitle", { name: location.title })}
					body={t("locations.deleteBody", { name: location.title })}
					confirmLabel={t("locations.delete")}
					destructive
					testID={`delete-location-${location.id}`}
					returnFocusTo={anchor}
				/>
			) : null}
		</View>
	);
}
