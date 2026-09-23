import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type StyleProp, View, type ViewStyle } from "react-native";
import { Icon, Text } from "react-native-paper";
import { DueChip } from "@/components/board/DueChip";
import { useLocationColors } from "@/hooks/use-location-colors";
import { cardFace } from "@/models/attachment";
import { showsDue } from "@/models/due-date";
import type { Location } from "@/models/locations";
import type { Node } from "@/models/node";
import { useAppTheme } from "@/theme";
import { border, icon, space } from "@/theme/tokens";

interface CardFooterProps {
	node: Node;
	/**
	 * The place the card answers to — its own, or the nearest its trail passes
	 * down (#290, #296), resolved by `BoardCard`. A location the map cannot
	 * answer — gone, or not loaded — says nothing rather than a wrong name, the
	 * same neutral answer an unreadable crumb renders.
	 */
	locationId: string | null;
	/**
	 * Location id → place, as passed down by the screen. A location the map
	 * cannot answer — gone, or not loaded — says nothing rather than a wrong
	 * name, the same neutral answer an unreadable crumb renders.
	 */
	locations?: ReadonlyMap<string, Location>;
	/**
	 * False suppresses the location fact (#205): the tree screen draws a card
	 * inside the very place's row, and *Verkstaden* under *Verkstaden* is the
	 * row saying its own name twice. One prop, so the footer keeps its shape.
	 */
	showLocation?: boolean;
	/** The waiting mark, when the card is waiting; `null` when it is not. */
	waiting: { label: string; a11yLabel: string } | null;
	/** The card owns the air between its title and this footer. */
	style?: StyleProp<ViewStyle>;
}

interface FactProps {
	source: string;
	/** Overrides the muted tier — the warning color, on an overdue card. */
	color?: string;
	/** What a screen reader hears instead of the visual shorthand. */
	accessibilityLabel?: string;
	children: ReactNode;
}

/**
 * The location fact (#338): the place's own glyph, in its own hue — the same
 * colored mark the tree draws for it, so a card and the tree say one place
 * alike, and a footer of places reads as a footer of places, not of pins.
 */
function LocationFact({
	location,
	children,
}: {
	location: Location;
	children: ReactNode;
}) {
	const tone = useLocationColors(location.color).fill;

	return (
		<Fact source={location.icon} color={tone}>
			{children}
		</Fact>
	);
}

/**
 * One bare fact: a leading glyph and the words, no box around them. The
 * card's footer is text on the card, and a chip border there was one more
 * edge competing with the card's own.
 */
function Fact({ source, color, accessibilityLabel, children }: FactProps) {
	const theme = useAppTheme();
	const tone = color ?? theme.colors.onCardMuted;

	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
			<Icon source={source} size={icon.sm} color={tone} />
			<Text
				variant="labelMedium"
				accessibilityLabel={accessibilityLabel}
				style={{ color: tone, flexShrink: 1 }}
			>
				{children}
			</Text>
		</View>
	);
}

/** A pair of facts that wraps as one unit: `columnGap` between, `rowGap` of one hairline. */
function Pair({ children }: { children: ReactNode }) {
	return (
		<View
			style={{
				flexDirection: "row",
				flexWrap: "wrap",
				alignItems: "center",
				columnGap: space.sm,
				rowGap: border.hairline,
			}}
		>
			{children}
		</View>
	);
}

/**
 * The card's footer (#100), two pairs of bare facts: **where and how long**,
 * then **due and waiting**.
 *
 * The spacing is the wrap fix: every pair spaces its own members `space.sm`
 * apart horizontally and one hairline apart vertically, so a pair that runs
 * out of room wraps into exactly the same rhythm as the two footer lines
 * themselves — a wrapped pair used to sit a whole `space.sm` further apart
 * than two separate facts, which read as a torn list rather than a footer.
 *
 * Location is **the leaf only** — *Workshop*, never *Basement · workshop* —
 * because the trail above it is a place the reader is not standing in, and
 * the card face has no room for a chain. Waiting is quieter than overdue on
 * purpose: `onCardMuted` against the due date's `warning`, so a card that is
 * merely blocked never out-shouts one that is late.
 */
export function CardFooter({
	node,
	locationId,
	locations,
	showLocation = true,
	waiting,
	style,
}: CardFooterProps) {
	const { t } = useTranslation();

	// Only to decide whether the second pair exists — the chip itself, and the
	// warning color on it, are `DueChip`'s.
	const showDue = showsDue(node, new Date());

	// The count face (#298): what the card carries, as a bare fact. It is the
	// default face and the fallback — in thumbnails or hero mode the pictures
	// say it themselves, and a card with no image draws this whatever its
	// stored mode claims.
	const face = cardFace(node);
	const carries = face.mode === "count" && face.total > 0;

	const location =
		showLocation && locationId !== null
			? locations?.get(locationId)
			: undefined;
	const where = location !== undefined || node.effort !== null;
	const when = showDue || waiting !== null;

	if (!where && !when && !carries) return null;

	return (
		<View style={[{ rowGap: border.hairline }, style]}>
			{where || carries ? (
				<Pair>
					{location === undefined ? null : (
						<LocationFact location={location}>{location.title}</LocationFact>
					)}
					{node.effort === null ? null : (
						<Fact source="clock-outline">{t(`effort.${node.effort}`)}</Fact>
					)}
					{carries ? (
						<Fact source="paperclip">
							{t("board.attachedCount", { count: face.total })}
						</Fact>
					) : null}
				</Pair>
			) : null}
			{when ? (
				<Pair>
					{showDue ? <DueChip node={node} /> : null}
					{waiting === null ? null : (
						<Fact source="timer-sand" accessibilityLabel={waiting.a11yLabel}>
							{waiting.label}
						</Fact>
					)}
				</Pair>
			) : null}
		</View>
	);
}
