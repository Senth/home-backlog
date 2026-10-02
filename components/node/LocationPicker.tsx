import { router } from "expo-router";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWindowDimensions, View } from "react-native";
import { Button, Icon, Text, TextInput } from "react-native-paper";
import { AppSheet } from "@/components/ui/AppSheet";
import { CheckRow } from "@/components/ui/CheckRow";
import type { NodeChanges } from "@/data/nodes";
import { useLocationColors } from "@/hooks/use-location-colors";
import { foldTitle } from "@/models/fold-title";
import type { Location } from "@/models/locations";
import type { Node } from "@/models/node";
import { useAppTheme } from "@/theme";
import { denseBreakpoint, icon, space, touchTarget } from "@/theme/tokens";

interface LocationPickerProps {
	/** The home's location tree, read by the screen and handed down. */
	locations: readonly Location[];
	/** The card being filed — the row filled in is the place it sits in. */
	node: Node;
	/**
	 * The place the card answers to (#290) — its own, or the nearest one an
	 * ancestor passes down. It is the row filled in; the write still names
	 * the card's own field, so the trail's answer shows through the
	 * moment the card's own place comes off.
	 */
	effectiveLocationId: string | null;
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
 * trail in the app draws. Each row leads with the place's own glyph in its
 * hue (#394) — the same mark the tree and the card footer draw for it — and
 * selection is the shared fill presentation (#314), not a checkbox. A tap
 * writes the place's id and its stored path in one write; tapping the card's
 * own selected row unfiles the card, the way a selected priority chip clears
 * itself — and the place an ancestor's card passes down (#290) is named as
 * inherited, with no write of its own to take. The writes go through the
 * screen's `save`, so the card's own listener moves the selection and the
 * row's value — no local state.
 */
export function LocationPicker({
	locations,
	node,
	effectiveLocationId,
	onDismiss,
	onSave,
	testID,
}: LocationPickerProps) {
	const { t } = useTranslation();
	const { width } = useWindowDimensions();
	const [text, setText] = useState("");

	const needle = foldTitle(text.trim());
	const visible = locations.filter((location) =>
		foldTitle(location.title).includes(needle),
	);

	const byId = new Map(locations.map((location) => [location.id, location]));

	const toggle = (location: Location) => {
		if (location.id === node.locationId) {
			// The card's own place comes off; what the trail passes down shows
			// through again.
			onSave({ locationId: null, locationAncestorIds: [] });
		} else if (location.id !== effectiveLocationId) {
			onSave({
				locationId: location.id,
				locationAncestorIds: [...location.ancestorIds],
			});
		}
		// The inherited row: filled in above this card's own field, so there
		// is nothing here to clear and nothing to pin.
	};

	return (
		<AppSheet visible onDismiss={onDismiss} testID={testID}>
			<View style={{ gap: space.md }}>
				<View
					style={{
						flexDirection: "row",
						flexWrap: "wrap",
						alignItems: "center",
					}}
				>
					<Text variant="titleMedium" style={{ flexGrow: 1 }}>
						{t("detail.location")}
					</Text>
					{/* The locations tab is where the tree is curated; the picker is
					    where it is spent. Adding a place goes there, so the sheet goes
					    with the tap. */}
					<Button
						mode="outlined"
						icon={width < denseBreakpoint ? undefined : "plus"}
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

					{visible.map((location) => {
						const checked = location.id === effectiveLocationId;
						const inherited = checked && location.id !== node.locationId;
						return (
							<View key={location.id}>
								<LocationOption
									location={location}
									checked={checked}
									inherited={inherited}
									onPress={() => toggle(location)}
								/>
								<LocationTrail location={location} byId={byId} />
							</View>
						);
					})}
				</View>
			</View>
		</AppSheet>
	);
}

/**
 * One place in the picker: the shared fill presentation (#314) instead of a
 * checkbox, led by the place's own glyph in its hue — the mark the tree and
 * the card footer draw for the same place (#394). The name carries the
 * accessibility of the glyph, the way every row with an identity mark here
 * does.
 */
function LocationOption({
	location,
	checked,
	inherited,
	onPress,
}: {
	location: Location;
	checked: boolean;
	inherited: boolean;
	onPress: () => void;
}) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const tone = useLocationColors(location.color).fill;

	return (
		<CheckRow
			label={location.title}
			checked={checked}
			onPress={onPress}
			fill
			left={<Icon source={location.icon} size={icon.md} color={tone} />}
			right={
				inherited ? (
					<Text
						variant="bodySmall"
						style={{ color: theme.colors.onSurfaceVariant }}
					>
						{t("detail.locationInherited")}
					</Text>
				) : undefined
			}
		/>
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
				// Under the title, past the glyph — the fill row's side padding,
				// its leading mark, then its gap. The row's own second line.
				paddingLeft: space.md + icon.md + space.sm,
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
