import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { useWindowDimensions } from "react-native";
import { IconButton } from "react-native-paper";
import { BoardCard } from "@/components/board/BoardCard";
import { useAncestors } from "@/hooks/use-ancestors";
import { useBlockerReads } from "@/hooks/use-blockers";
import { useLocations } from "@/hooks/use-locations";
import type { Node } from "@/models/node";
import {
	cardGutterBreakpoint,
	contentWidth,
	icon,
	space,
	touchTargetStyle,
} from "@/theme/tokens";

interface DetailCardProps {
	homeId: string | null;
	/** The card this screen is about — the one that was tapped. */
	node: Node;
	/** Opens the rename dialog the overflow menu also opens. */
	onRename: () => void;
	/** Where a crumb goes: that ancestor's board. */
	onOpenCrumb: (nodeId: string) => void;
}

/**
 * The card at the top of the details screen (#237 phase 2) — the settled face
 * at details size, and **the canonical face**: this renders `BoardCard` in its
 * non-pressable mode rather than restyling a copy. Nothing here has a press of
 * its own except the pencil, because the screen the face sits on is the
 * destination a card's tap normally is.
 *
 * What it adds over a board card is what only details can know: the trail as
 * links that wrap (`CardTrail`, first crumb the project), the card's own
 * blockers read on focus so the waiting mark is live, and the location map for
 * the footer. The title stays `bodyLarge` — the loudest text on the screen.
 */
export function DetailCard({
	homeId,
	node,
	onRename,
	onOpenCrumb,
}: DetailCardProps) {
	const { t } = useTranslation();
	const focused = useIsFocused();
	const { width } = useWindowDimensions();

	const { crumbs } = useAncestors(homeId, node.ancestorIds);
	const blockers = useBlockerReads(homeId, node.blockedBy, focused);
	const { locations } = useLocations(homeId);

	// The card fills the screen's form column, so its own width — not the
	// window's — is what the gutter breakpoint names. The screen hands this
	// down rather than the card measuring itself; see `BoardCard`.
	const narrow =
		Math.min(width - space.md * 2, contentWidth.form) < cardGutterBreakpoint;

	const menu = (
		<IconButton
			icon="pencil"
			size={icon.sm}
			accessibilityLabel={t("board.rename")}
			onPress={onRename}
			// The same box the board card's menu glyph sits in: the glyph is
			// small, the target is not, and Paper's own margin would lean the
			// box against the card's rounded edge.
			style={[touchTargetStyle, { margin: space.none }]}
		/>
	);

	return (
		<BoardCard
			node={node}
			menu={menu}
			linkedTrail={crumbs.length === 0 ? undefined : { crumbs, onOpenCrumb }}
			blockers={blockers}
			ancestorLabelIds={crumbs.flatMap((crumb) => crumb.node?.labelIds ?? [])}
			locations={
				new Map(locations.map((location) => [location.id, location.title]))
			}
			narrow={narrow}
		/>
	);
}
