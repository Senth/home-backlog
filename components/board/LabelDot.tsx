import { useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "react-native-paper";
import { LabelGlyph } from "@/components/label/LabelGlyph";
import type { LabelWithId } from "@/models/label";
import { useAppTheme } from "@/theme";
import {
	contentWidth,
	elevation,
	markTouch,
	radius,
	size,
	space,
} from "@/theme/tokens";

/**
 * One label dot in the card's left gutter (#100) — the dot itself is
 * `LabelGlyph`, and this wraps it in what the gutter wants around it.
 *
 * **The title is the accessible name on the wrapper.** `PaperIcon` hides every
 * glyph from the accessibility tree on purpose, so a name carried by the glyph
 * alone is a name no screen reader ever hears — the wrapper carries it
 * instead, and the dot reads as one element saying "Home Assistant".
 *
 * **The name is a tooltip on desktop and a disclosure on tap.** A dot is a
 * shape, and a shape says nothing about which label it is — hover answers that
 * where hover exists, and a tap opens the same answer where it does not.
 * Mobile has no hover, so a hover-only affordance would leave half the
 * household with dots they cannot interrogate. Tapping again closes it.
 *
 * **The tappable box is `markTouch`, not the mark.** It is one band of the
 * gutter it sits in — that gutter's width, one pitch tall — so a dot owns its
 * own tap, cannot steal the next one's, and cannot reach over the card body
 * where the card's own press would win. A `touchTarget`-sized box around a 20px mark on a
 * 24px pitch overlaps its neighbour by half, and the later sibling wins: a tap
 * on one dot opened the one below it. The 20px mark stays where it was, and
 * negative margins hand the box's extra room back to the flow.
 */
export function LabelDot({
	label,
	narrow = false,
}: {
	label: LabelWithId;
	/** Which gutter this dot sits in — the box is that gutter's width. */
	narrow?: boolean;
}) {
	const theme = useAppTheme();
	const [open, setOpen] = useState(false);
	const box = markTouch(narrow ? size.cardGutterNarrow : size.cardGutter);

	return (
		<Pressable
			// A mark, not a control: exempt from `touchTarget` and swept as
			// such — see the exemption in docs/DESIGN.md and `markTouch`.
			testID="label-mark"
			accessible
			accessibilityRole="button"
			accessibilityLabel={label.title}
			accessibilityState={{ expanded: open }}
			onPress={() => setOpen((wasOpen) => !wasOpen)}
			onHoverIn={() => setOpen(true)}
			onHoverOut={() => setOpen(false)}
			style={{
				// The box fills the gutter's content width, so there is nothing
				// to center it against and no fractional margin to invent: only
				// the vertical slop is handed back to the flow.
				width: box.width,
				height: box.height,
				marginVertical: -(box.height - size.labelDot) / 2,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<LabelGlyph color={label.color} icon={label.icon} />
			{open ? (
				<View
					style={{
						position: "absolute",
						// The dot's own top-right corner, measured from the box the
						// mark is centered in.
						left: (box.width + size.labelDot) / 2,
						top: (box.height - size.labelDot) / 2,
						zIndex: elevation.high,
						maxWidth: contentWidth.form,
						borderRadius: radius.sm,
						backgroundColor: theme.colors.inverseSurface,
						paddingHorizontal: space.sm,
						paddingVertical: space.xs,
					}}
				>
					<Text
						variant="labelMedium"
						style={{ color: theme.colors.inverseOnSurface }}
					>
						{label.title}
					</Text>
				</View>
			) : null}
		</Pressable>
	);
}
