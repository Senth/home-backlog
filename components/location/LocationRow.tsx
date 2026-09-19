import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, View } from "react-native";
import { Icon, IconButton, Menu, Text } from "react-native-paper";
import { LocationDialog } from "@/components/location/LocationDialog";
import { ConfirmDialog } from "@/components/ui/AppDialog";
import {
	deleteLocation,
	locationErrorKey,
	moveLocation,
	reorderLocation,
} from "@/data/locations";
import { useLocationColor } from "@/hooks/use-location-color";
import { childLocations, inSubtree, type Location } from "@/models/locations";
import { movedRank, rankAtEnd } from "@/models/node";
import { useAppTheme } from "@/theme";
import { border, icon, space, touchTarget } from "@/theme/tokens";

/** `null` is the top level. */
type RowPage = "root" | "under";

interface LocationTreeProps {
	locations: Location[];
	parentId: string | null;
	collapsed: ReadonlySet<string>;
	/** The open count per place, rolled up — what the row draws. */
	counts: ReadonlyMap<string, number>;
	onToggle: (id: string) => void;
	onOpen: (location: Location) => void;
	onAddUnder: (parent: Location) => void;
	onError: (message: string) => void;
	homeId: string;
	online: boolean;
}

/**
 * The siblings under one parent, each followed by its own children's rail.
 *
 * The rail wraps **only the children** — never the container that holds the
 * parent row — so it can never cross a chevron, whatever the depth. It is
 * centred on the parent's chevron band: `icon.sm - space.xs` puts the hairline
 * at the band's centre (+12), and `space.xs - border.hairline` of padding puts
 * the child content at +16, exactly one `indent.step` — the depth the old
 * padding scheme carried, now carried by the rails themselves. There is no
 * rail at the top level, because the top level has no parent to hang one on.
 */
export function LocationTree({
	locations,
	parentId,
	collapsed,
	counts,
	onToggle,
	onOpen,
	onAddUnder,
	onError,
	homeId,
	online,
}: LocationTreeProps) {
	const theme = useAppTheme();
	const rail = {
		marginLeft: icon.sm - space.xs,
		borderLeftWidth: border.hairline,
		borderLeftColor: theme.colors.outlineVariant,
		paddingLeft: space.xs - border.hairline,
	};

	return (
		<View>
			{childLocations(locations, parentId).map((location) => {
				const hasChildren = childLocations(locations, location.id).length > 0;
				const expanded = !collapsed.has(location.id);
				return (
					<View key={location.id}>
						<LocationRow
							homeId={homeId}
							location={location}
							hasChildren={hasChildren}
							expanded={expanded}
							counts={counts}
							onToggle={onToggle}
							onOpen={onOpen}
							locations={locations}
							online={online}
							onAddUnder={onAddUnder}
							onError={onError}
						/>
						{hasChildren && expanded ? (
							<View style={rail}>
								<LocationTree
									locations={locations}
									parentId={location.id}
									collapsed={collapsed}
									counts={counts}
									onToggle={onToggle}
									onOpen={onOpen}
									onAddUnder={onAddUnder}
									onError={onError}
									homeId={homeId}
									online={online}
								/>
							</View>
						) : null}
					</View>
				);
			})}
		</View>
	);
}

interface LocationRowProps {
	homeId: string;
	location: Location;
	hasChildren: boolean;
	expanded: boolean;
	/** The open count per place, rolled up — what the row draws. */
	counts: ReadonlyMap<string, number>;
	onToggle: (id: string) => void;
	onOpen: (location: Location) => void;
	/** Every location in the home — the move picker's destinations. */
	locations: Location[];
	online: boolean;
	onAddUnder: (parent: Location) => void;
	onError: (message: string) => void;
}

/**
 * One place, its glyph, and everything it can do.
 *
 * Three sibling controls, nothing nested: the chevron is its own button and
 * exists only where there are children; the name is the pressable that opens
 * the place's work; the menu holds the rest. Between them the colored glyph
 * is a mark — it says *which place*, and tapping it earns nothing. The
 * chevron band is fixed width (`icon.sm` of glyph in `icon.sm + space.xs` of
 * band), so a childless name lines up with a nested one at every depth and
 * text size.
 *
 * The menu changes *page* rather than opening a submenu, and the pages after
 * the first scroll inside the height Paper measured on the first one — the
 * same one-measurement shape `CardMenu` works around.
 */
export function LocationRow({
	homeId,
	location,
	hasChildren,
	expanded,
	counts,
	onToggle,
	onOpen,
	locations,
	online,
	onAddUnder,
	onError,
}: LocationRowProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const locationColor = useLocationColor(location.color);
	const count = counts.get(location.id) ?? 0;
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
		const siblings = childLocations(locations, parent?.id ?? null);
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

	const siblings = childLocations(locations, location.parentId);
	const siblingIndex = siblings.findIndex((each) => each.id === location.id);

	/** One step up or down among siblings, queued optimistically like an edit. */
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

	return (
		<View>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					minHeight: touchTarget,
					gap: space.sm,
					paddingVertical: space.xs,
					paddingRight: space.sm,
				}}
			>
				{/* The chevron's own button, present only where there is something
				    to disclose; a childless row keeps the band, so the names line
				    up. Its box runs the full row height — the band is narrow, the
				    height is what makes it hittable. */}
				{hasChildren ? (
					<Pressable
						accessible
						accessibilityRole="button"
						accessibilityLabel={t("locations.toggle", {
							name: location.title,
						})}
						aria-expanded={expanded}
						onPress={() => onToggle(location.id)}
						style={{
							width: icon.sm + space.xs,
							height: touchTarget,
							alignItems: "center",
							justifyContent: "center",
						}}
					>
						<Icon
							source={expanded ? "chevron-down" : "chevron-right"}
							size={icon.sm}
							color={theme.colors.onSurfaceVariant}
						/>
					</Pressable>
				) : (
					<View style={{ width: icon.sm + space.xs }} />
				)}

				{/* The identity mark: the place's own glyph in its own color,
				    resolved by scheme — a bare colored glyph, no fill behind it. */}
				<Icon source={location.icon} size={icon.md} color={locationColor} />

				<Pressable
					accessible
					accessibilityRole="button"
					accessibilityLabel={t("locations.open", { name: location.title })}
					onPress={() => onOpen(location)}
					style={{
						flex: 1,
						minHeight: touchTarget,
						justifyContent: "center",
					}}
				>
					<Text variant="bodyLarge">{location.title}</Text>
				</Pressable>

				{/* The open count, rolled up through the subtree and right-aligned
				    left of the menu, quiet. Nothing is drawn at zero — an empty
				    place says nothing rather than saying 0 (#205). */}
				{count > 0 ? (
					<Text
						variant="bodySmall"
						style={{ color: theme.colors.onSurfaceVariant }}
					>
						{count}
					</Text>
				) : null}

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
								// Without this the row underneath takes the tap as well
								// and the menu opens while the name navigates.
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
