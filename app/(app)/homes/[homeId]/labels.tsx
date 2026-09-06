import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, useWindowDimensions, View } from "react-native";
import {
	Appbar,
	Button,
	FAB,
	IconButton,
	Menu,
	Snackbar,
	Text,
	TouchableRipple,
} from "react-native-paper";
import { LabelDialog } from "@/components/label/LabelDialog";
import { LabelGlyph } from "@/components/label/LabelGlyph";
import { BackAction } from "@/components/ui/BackAction";
import { useHome } from "@/contexts/HomeContext";
import { reorderLabel } from "@/data/homes";
import { type LabelWithId, movedRank } from "@/models/label";
import { useAppTheme } from "@/theme";
import {
	contentWidth,
	denseBreakpoint,
	fab as fabTokens,
	icon,
	space,
	touchTarget,
	touchTargetStyle,
} from "@/theme/tokens";

/**
 * Where the household curates its label set (#100).
 *
 * One uninterrupted list — the set is one list however long it grows, so no
 * divider ever lands between the rows — with the glyph out front, the name,
 * and a quiet reorder handle on every row. The FAB is the only saturated
 * block, and it stands down while the empty state is up, the way the
 * locations screen's does: one primary action per surface.
 *
 * Reached from the navigation row on the manage-home screen, and named for
 * the home in the app bar — the screen it opened from, never the screen's
 * own name.
 */
export default function LabelsScreen() {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();
	const { width } = useWindowDimensions();
	const { homeId } = useLocalSearchParams<{ homeId: string }>();
	const { homes } = useHome();

	const home = homes.find((candidate) => candidate.id === homeId) ?? null;
	const labels = home?.labels ?? [];

	const [creating, setCreating] = useState(false);
	const [failed, setFailed] = useState(false);
	const [fabHeight, setFabHeight] = useState(0);
	const opener = useRef<View | null>(null);

	const fabInset = fabHeight > 0 ? fabHeight + space.md + space.md : space.xxl;

	const move = (index: number, delta: -1 | 1) => {
		if (home === null) return;
		const rank = movedRank(labels, index, delta);
		if (rank === null) return;
		reorderLabel(home.id, labels[index].id, rank).catch((reason) => {
			console.error("Could not reorder the labels:", reason);
			setFailed(true);
		});
	};

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header>
				{/* Back to the manage screen this was opened from, by name and
				    never `router.back()` — a reload or a pasted URL has no history
				    and would leave a dead arrow. */}
				<BackAction
					accessibilityLabel={t("manageHome.title")}
					onPress={() => router.replace(`/homes/${homeId}`)}
				/>
				<Appbar.Content title={home?.name ?? ""} />
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
				{home === null ? (
					// Left behind by a home that was deleted, or that you were
					// removed from, while this screen was open.
					<Text
						variant="bodyLarge"
						style={{ color: theme.colors.onSurfaceVariant }}
					>
						{t("homes.empty")}
					</Text>
				) : labels.length === 0 ? (
					<View
						style={{
							alignItems: "center",
							gap: space.md,
							paddingVertical: space.xl,
						}}
					>
						<Text variant="titleMedium">{t("labels.emptyTitle")}</Text>
						<Text
							variant="bodyLarge"
							style={{
								color: theme.colors.onSurfaceVariant,
								textAlign: "center",
							}}
						>
							{t("labels.emptyBody")}
						</Text>
						<Button
							ref={opener}
							mode="contained"
							icon="plus"
							onPress={() => setCreating(true)}
							contentStyle={{ minHeight: touchTarget }}
						>
							{t("labels.newLabel")}
						</Button>
					</View>
				) : (
					<View>
						{labels.map((label, index) => (
							<LabelRow
								key={label.id}
								homeId={home.id}
								label={label}
								index={index}
								count={labels.length}
								onMove={move}
								onError={() => setFailed(true)}
							/>
						))}
					</View>
				)}
			</ScrollView>

			{/* The same two footprint caps every FAB carries: a share of the
			    width it floats over, and the words over the glyph below
			    `denseBreakpoint`. Stands down while the empty state is up. */}
			{home !== null && labels.length > 0 ? (
				<FAB
					ref={opener}
					icon={width < denseBreakpoint ? undefined : "plus"}
					label={t("labels.newLabel")}
					onPress={() => setCreating(true)}
					onLayout={(event) => setFabHeight(event.nativeEvent.layout.height)}
					style={{
						position: "absolute",
						right: space.md,
						bottom: space.md,
						maxWidth: width * fabTokens.widthShare,
					}}
				/>
			) : null}

			{/* Mounted only while open — see the row's identical dialog. */}
			{creating && home !== null ? (
				<LabelDialog
					homeId={home.id}
					label={null}
					onDismiss={() => setCreating(false)}
					onError={() => setFailed(true)}
					testID="new-label-dialog"
					returnFocusTo={opener}
				/>
			) : null}

			<Snackbar
				visible={failed}
				onDismiss={() => setFailed(false)}
				style={{
					maxWidth: contentWidth.snackbar,
					alignSelf: "center",
					marginBottom: space.md,
				}}
			>
				{t("error.saveFailed")}
			</Snackbar>
		</View>
	);
}

interface LabelRowProps {
	homeId: string;
	label: LabelWithId;
	index: number;
	count: number;
	onMove: (index: number, delta: -1 | 1) => void;
	onError: () => void;
}

/**
 * One label of the set: the glyph in its hue, its name, and the quiet
 * handle. Tapping the row edits; the handle opens the two moves, which are
 * this repo's drag alternative — every reorder a drag could do, reachable
 * without one.
 */
function LabelRow({
	homeId,
	label,
	index,
	count,
	onMove,
	onError,
}: LabelRowProps) {
	const { t } = useTranslation();
	const anchor = useRef<View | null>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const [editing, setEditing] = useState(false);

	return (
		<View>
			<TouchableRipple
				onPress={() => setEditing(true)}
				accessibilityRole="button"
				style={{ minHeight: touchTarget }}
			>
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						gap: space.md,
						paddingVertical: space.sm,
					}}
				>
					<LabelGlyph color={label.color} icon={label.icon} />
					<Text variant="bodyLarge" style={{ flex: 1 }}>
						{label.title}
					</Text>
					<Menu
						visible={menuOpen}
						onDismiss={() => setMenuOpen(false)}
						overlayAccessibilityLabel={t("common.closeMenu")}
						anchor={
							<View ref={anchor}>
								<IconButton
									icon="swap-vertical"
									size={icon.sm}
									accessibilityLabel={t("labels.reorderHandle", {
										name: label.title,
									})}
									// Without this the row underneath takes the tap as
									// well and the editor opens behind the menu.
									onPress={(event) => {
										event.stopPropagation();
										setMenuOpen(true);
									}}
									style={[touchTargetStyle, { margin: space.none }]}
								/>
							</View>
						}
					>
						<Menu.Item
							leadingIcon="arrow-up"
							title={t("labels.moveUp")}
							disabled={index === 0}
							onPress={() => {
								setMenuOpen(false);
								onMove(index, -1);
							}}
						/>
						<Menu.Item
							leadingIcon="arrow-down"
							title={t("labels.moveDown")}
							disabled={index === count - 1}
							onPress={() => {
								setMenuOpen(false);
								onMove(index, 1);
							}}
						/>
					</Menu>
				</View>
			</TouchableRipple>

			{/* Mounted only while open — each dialog carries a `Portal`, and a
			    list grows without bound. */}
			{editing ? (
				<LabelDialog
					homeId={homeId}
					label={label}
					onDismiss={() => setEditing(false)}
					onError={onError}
					testID={`edit-label-${label.id}`}
					returnFocusTo={anchor}
				/>
			) : null}
		</View>
	);
}
