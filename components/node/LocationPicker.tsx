import { router } from "expo-router";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button, Icon, Text, TextInput } from "react-native-paper";
import { AppSheet } from "@/components/ui/AppSheet";
import { CheckRow } from "@/components/ui/CheckRow";
import { foldTitle } from "@/components/ui/fold-title";
import type { NodeChanges } from "@/data/nodes";
import type { Location } from "@/models/locations";
import type { Node } from "@/models/node";
import { useAppTheme } from "@/theme";
import { icon, space, touchTarget } from "@/theme/tokens";

interface LocationPickerProps {
	/** The home's location tree, read by the screen and handed down. */
	locations: readonly Location[];
	/** The card being filed — the row ticked is the place it sits in. */
	node: Node;
	onDismiss: () => void;
	/** The write, the screen's own `save` — errors surface on its snackbar. */
	onSave: (changes: NodeChanges) => void;
	testID: string;
}

/**
 * Filing a card in a place (#246) — the details screen's location editor, in
 * the sheet every field editor there rises in.
 *
 * The rows are the whole location tree, flat, because locations count in tens;
 * what tells two same-named rooms apart is the trail under the row — the
 * place's full path as breadcrumbs, the same chevron-separated line every
 * trail in the app draws. A tap writes the place's id and its stored path in
 * one write; tapping the ticked row unfiles the card, the way a selected
 * priority chip clears itself. The writes go through the screen's `save`, so
 * the card's own listener moves the tick and the row's value — no local state.
 */
export function LocationPicker({
	locations,
	node,
	onDismiss,
	onSave,
	testID,
}: LocationPickerProps) {
	const { t } = useTranslation();
	const [text, setText] = useState("");

	const needle = foldTitle(text.trim());
	const visible = locations.filter((location) =>
		foldTitle(location.title).includes(needle),
	);

	const byId = new Map(locations.map((location) => [location.id, location]));

	const toggle = (location: Location) => {
		onSave(
			location.id === node.locationId
				? { locationId: null, locationAncestorIds: [] }
				: {
						locationId: location.id,
						locationAncestorIds: [...location.ancestorIds],
					},
		);
	};

	return (
		<AppSheet visible onDismiss={onDismiss} testID={testID}>
			<View style={{ gap: space.md }}>
				<View style={{ flexDirection: "row", alignItems: "center" }}>
					<Text variant="titleMedium" style={{ flex: 1 }}>
						{t("detail.location")}
					</Text>
					{/* The locations tab is where the tree is curated; the picker is
					    where it is spent. Navigation is dismissal's work, so the sheet
					    goes with the tap. */}
					<Button
						mode="text"
						icon="plus"
						onPress={() => {
							onDismiss();
							router.push("/locations");
						}}
						contentStyle={{ minHeight: touchTarget }}
					>
						{t("locations.add")}
					</Button>
				</View>

				<TextInput
					mode="flat"
					label={t("detail.locationSearchPlaceholder")}
					value={text}
					onChangeText={setText}
					left={<TextInput.Icon icon="magnify" />}
					testID={`${testID}-search`}
					autoFocus
				/>

				<View style={{ gap: space.xs }}>
					{locations.length === 0 ? (
						<Text variant="bodyMedium">{t("detail.locationNone")}</Text>
					) : null}

					{visible.length === 0 && locations.length > 0 ? (
						<Text variant="bodyMedium">{t("detail.locationSearchEmpty")}</Text>
					) : null}

					{visible.map((location) => (
						<View key={location.id}>
							<CheckRow
								label={location.title}
								checked={location.id === node.locationId}
								onPress={() => toggle(location)}
							/>
							<LocationTrail location={location} byId={byId} />
						</View>
					))}
				</View>
			</View>
		</AppSheet>
	);
}

/**
 * The place's path under its row — root first, muted `bodySmall`,
 * chevron-separated, never a link: the picker's job is to pick, and its rows
 * are the surface. Every crumb is in hand — the trail reads out of the same
 * list the rows come from, so a path costs no read of its own.
 */
function LocationTrail({
	location,
	byId,
}: {
	location: Location;
	byId: ReadonlyMap<string, Location>;
}) {
	const { t } = useTranslation();
	const theme = useAppTheme();

	if (location.ancestorIds.length === 0) return null;

	return (
		<View
			style={{
				flexDirection: "row",
				flexWrap: "wrap",
				alignItems: "center",
				columnGap: space.xs,
				// Under the title, past the tick — the row's own second line.
				paddingLeft: icon.md + space.md,
				paddingBottom: space.xs,
			}}
		>
			{location.ancestorIds.map((id, index) => (
				<Fragment key={id}>
					{index === 0 ? null : (
						<Icon
							source="chevron-right"
							size={icon.sm}
							color={theme.colors.onSurfaceVariant}
						/>
					)}
					<Text
						variant="bodySmall"
						style={{ color: theme.colors.onSurfaceVariant }}
					>
						{byId.get(id)?.title ?? t("board.crumbHidden")}
					</Text>
				</Fragment>
			))}
		</View>
	);
}
