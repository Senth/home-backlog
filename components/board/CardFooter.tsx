import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type StyleProp, View, type ViewStyle } from "react-native";
import { Icon, Text } from "react-native-paper";
import { DueChip } from "@/components/board/DueChip";
import { showsDue } from "@/models/due-date";
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
	 * Location id → title, as passed down by the screen.
	 */
	locations?: ReadonlyMap<string, string>;
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
	waiting,
	style,
}: CardFooterProps) {
	const { t } = useTranslation();

	// Only to decide whether the second pair exists — the chip itself, and the
	// warning color on it, are `DueChip`'s.
	const showDue = showsDue(node, new Date());

	const locationTitle =
		locationId === null ? undefined : locations?.get(locationId);
	const where = locationTitle !== undefined || node.effort !== null;
	const when = showDue || waiting !== null;

	if (!where && !when) return null;

	return (
		<View style={[{ rowGap: border.hairline }, style]}>
			{where ? (
				<Pair>
					{locationTitle === undefined ? null : (
						<Fact source="crosshairs-gps">{locationTitle}</Fact>
					)}
					{node.effort === null ? null : (
						<Fact source="clock-outline">{t(`effort.${node.effort}`)}</Fact>
					)}
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
