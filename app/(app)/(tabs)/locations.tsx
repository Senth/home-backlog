import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, useWindowDimensions, View } from "react-native";
import {
	ActivityIndicator,
	Appbar,
	Button,
	FAB,
	Snackbar,
	Text,
} from "react-native-paper";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { LocationDialog } from "@/components/location/LocationDialog";
import { LocationTree } from "@/components/location/LocationRow";
import { BackAction } from "@/components/ui/BackAction";
import { useHome } from "@/contexts/HomeContext";
import { useBoardFilter } from "@/hooks/use-board-filter";
import { useLocationCounts } from "@/hooks/use-location-counts";
import { useLocations } from "@/hooks/use-locations";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { locationFilter } from "@/models/board-filter";
import { childLocations, type Location } from "@/models/locations";
import { useAppTheme } from "@/theme";
import {
	contentWidth,
	denseBreakpoint,
	fab as fabTokens,
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
	const { counts } = useLocationCounts(homeId);

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

	const empty = !loading && !failed && locations.length === 0;
	const showTree = !loading && !failed && locations.length > 0;

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
				    a deep tree never needs a walk to tidy. Session-only, like the
				    collapsed set itself — the cards toggle lands beside these in
				    the same slot (#205). */}
				{showTree ? (
					<View
						style={{
							flexDirection: "row",
							gap: space.sm,
							marginBottom: space.md,
						}}
					>
						<Button
							mode="outlined"
							icon="unfold-less-horizontal"
							onPress={collapseAll}
							contentStyle={{ minHeight: touchTarget }}
						>
							{t("locations.collapseAll")}
						</Button>
						<Button
							mode="outlined"
							icon="unfold-more-horizontal"
							onPress={expandAll}
							contentStyle={{ minHeight: touchTarget }}
						>
							{t("locations.expandAll")}
						</Button>
					</View>
				) : null}

				{showTree ? (
					<LocationTree
						locations={locations}
						parentId={null}
						collapsed={collapsed}
						counts={counts}
						onToggle={toggle}
						onOpen={openPlace}
						onAddUnder={(parent) => setAdding({ parent })}
						onError={setError}
						homeId={homeId ?? ""}
						online={online}
					/>
				) : null}
			</ScrollView>

			{/* The same two footprint caps the board's and Overview's FABs carry:
			    a share of the width it floats over, and the words over the glyph
			    below `denseBreakpoint`. Stands down while the empty state is up —
			    its button is then the one create control. */}
			{showTree ? (
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
					siblings={childLocations(locations, adding.parent?.id ?? null)}
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
