import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useWindowDimensions, View } from "react-native";
import { Button, Icon, Text } from "react-native-paper";
import { BoardCard } from "@/components/board/BoardCard";
import { boardHref, detailsHref } from "@/components/board/board-href";
import { cardsAtPlace } from "@/models/location-cards";
import type { Location } from "@/models/locations";
import { hasSteps, type Node } from "@/models/node";
import { useAppTheme } from "@/theme";
import {
	cardGutterBreakpoint,
	compactBreakpoint,
	contentWidth,
	icon,
	indent,
	space,
	touchTarget,
} from "@/theme/tokens";

interface LocationCardsProps {
	location: Location;
	/** The home's open cards — the pool pair the screen already holds. */
	pool: readonly Node[];
	/** Location id → place, for the card faces. */
	locationTitles: ReadonlyMap<string, Location>;
	/** The "+N more": the filtered board, the route the row's tap writes. */
	onMore: (location: Location) => void;
}

/**
 * One place's own card list (#205), revealed by the control row's toggle and
 * hidden by default. The selection is `cardsAtPlace`'s — leaf cards, exactly
 * this place, the most-urgent chain first — and the heading says which chain
 * the cards came from. These are the real `BoardCard`, unchanged, capped at
 * `contentWidth.cards`: at and above it the list is two columns of ~292px —
 * the width the face was built for, both gutters surviving — and below it one
 * column at full width, which is what a phone gives it. The card indents no
 * more than one step past its place, so a deep row's cards never starve.
 */
export function LocationCards({
	location,
	pool,
	locationTitles,
	onMore,
}: LocationCardsProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const { width } = useWindowDimensions();
	const [areaWidth, setAreaWidth] = useState<number | null>(null);

	const selection = cardsAtPlace(pool, location.id);
	if (selection === null) return null;

	const twoColumns = areaWidth !== null && areaWidth >= contentWidth.cards;
	const column =
		twoColumns && areaWidth !== null ? (areaWidth - space.sm) / 2 : null;

	// Blockers resolve against the open pool — the same answer Overview gives,
	// from the same listener. A blocker it cannot answer keeps the card
	// waiting, the not-yet direction the board and details take. The same map
	// is also the ancestor walk's titles.
	const byId = new Map(pool.map((node) => [node.id, node]));

	return (
		<View style={{ marginLeft: indent.step, marginBottom: space.md }}>
			<Text
				variant="bodySmall"
				style={{
					color: theme.colors.onSurfaceVariant,
					marginBottom: space.xs,
				}}
			>
				{t(`status.${selection.source}`)}
			</Text>
			<View
				onLayout={(event) => setAreaWidth(event.nativeEvent.layout.width)}
				style={{
					flexDirection: "row",
					flexWrap: "wrap",
					gap: space.sm,
				}}
			>
				{selection.cards.map((node) => (
					<View
						key={node.id}
						style={column === null ? { width: "100%" } : { width: column }}
					>
						<BoardCard
							node={node}
							wide={width >= compactBreakpoint}
							narrow={column !== null && column < cardGutterBreakpoint}
							blockers={byId}
							path={node.ancestorIds.map((id) => byId.get(id)?.title ?? null)}
							locations={locationTitles}
							// The card sits inside the very place's row; the footer
							// saying the place's name again is the row twice.
							hideLocation
							onOpen={() =>
								router.push(
									hasSteps(node) ? boardHref(node.id) : detailsHref(node.id),
								)
							}
						/>
					</View>
				))}
			</View>
			{selection.more > 0 ? (
				<Button
					mode="text"
					onPress={() => onMore(location)}
					contentStyle={{ minHeight: touchTarget }}
				>
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: space.xs,
						}}
					>
						<Text variant="labelLarge" style={{ color: theme.colors.primary }}>
							{t("locations.moreCards", {
								count: selection.more,
								name: location.title,
							})}
						</Text>
						<Icon
							source="chevron-right"
							size={icon.sm}
							color={theme.colors.primary}
						/>
					</View>
				</Button>
			) : null}
		</View>
	);
}
