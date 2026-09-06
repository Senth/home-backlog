import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { LabelDot } from "@/components/board/LabelDot";
import { PaperIcon } from "@/components/ui/PaperIcon";
import type { LabelWithId } from "@/models/label";
import { type Node, priorityOrder } from "@/models/node";
import { useAppTheme } from "@/theme";
import {
	border,
	icon,
	priorityRamp,
	radius,
	size,
	space,
} from "@/theme/tokens";

interface CardGutterProps {
	/**
	 * Only the priority is read here, and `LabelDialog`'s live preview passes
	 * exactly that — a sample card that is a priority and nothing else.
	 */
	node: Pick<Node, "priority">;
	/** The card's own and inherited labels, in the home's order, already capped. */
	labels: readonly LabelWithId[];
	/** Below `cardGutterBreakpoint` the gutter gives back the room it does not have. */
	narrow?: boolean;
}

/**
 * The card's left gutter (#100): the priority glyph in its dot, a hairline,
 * then up to six label dots — identity and priority in one column of marks.
 *
 * **Always drawn**, even when the card has neither a priority nor a label: a
 * gutter that appears and disappears makes every card a different shape, and
 * the whole point of the column is that a board of cards reads as a set. The
 * fill is the column colour — recessed, the one thing on a raised card that
 * is allowed to be — and the hairline on its right edge is the edge the fill
 * alone cannot make crisp against the card.
 *
 * The priority dot is a glyph, not the word the chip used to be: the ramp is
 * ordinal and the gutter is where *more* lives, so the word moved out and the
 * dot carries its name for a screen reader on the wrapper — the same rule a
 * label dot follows, for the same reason.
 */
export function CardGutter({ node, labels, narrow = false }: CardGutterProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const step =
		node.priority === null ? null : priorityRamp[priorityOrder[node.priority]];

	return (
		<View
			testID="card-gutter"
			style={{
				width: narrow ? size.cardGutterNarrow : size.cardGutter,
				backgroundColor: theme.colors.boardColumn,
				borderRightWidth: border.hairline,
				borderColor: theme.colors.outlineVariant,
				alignItems: "center",
				paddingTop: space.sm,
				gap: space.xs,
			}}
		>
			{step === null ? null : (
				<View
					accessible
					accessibilityLabel={t(`priority.${node.priority}`)}
					style={{
						width: size.labelDot,
						height: size.labelDot,
						borderRadius: radius.full,
						backgroundColor: step.color,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					{/* The glyph is knocked out of the dot in the ramp's own on-colour. */}
					<PaperIcon name={step.glyph} size={icon.sm} color={step.on} />
				</View>
			)}
			{step === null || labels.length === 0 ? null : (
				<View
					style={{
						width: icon.sm,
						height: border.hairline,
						backgroundColor: theme.colors.outlineVariant,
					}}
				/>
			)}
			{labels.map((label) => (
				<LabelDot key={label.id} label={label} />
			))}
		</View>
	);
}
