import { useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "react-native-paper";
import { LabelGlyph } from "@/components/label/LabelGlyph";
import type { LabelWithId } from "@/models/label";
import { useAppTheme } from "@/theme";
import {
	contentWidth,
	elevation,
	radius,
	size,
	space,
	touchSlop,
	touchTarget,
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
 * **The tappable box is `touchTarget`, not the mark.** A 48px box does not fit
 * the gutter, and react-native-web's `Pressable` drops `hitSlop` — so the box
 * carries the slop and negative margins (`touchSlop`) hand the room back to
 * the flow. The 20px mark stays exactly where it was.
 */
export function LabelDot({ label }: { label: LabelWithId }) {
	const theme = useAppTheme();
	const [open, setOpen] = useState(false);

	return (
		<Pressable
			accessible
			accessibilityRole="button"
			accessibilityLabel={label.title}
			accessibilityState={{ expanded: open }}
			onPress={() => setOpen((wasOpen) => !wasOpen)}
			onHoverIn={() => setOpen(true)}
			onHoverOut={() => setOpen(false)}
			style={{
				width: touchTarget,
				height: touchTarget,
				margin: -touchSlop,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<LabelGlyph color={label.color} icon={label.icon} />
			{open ? (
				<View
					style={{
						position: "absolute",
						// The dot's own top-right corner: the box is one `touchSlop`
						// larger than the mark on every side.
						left: (touchTarget + size.labelDot) / 2,
						top: touchSlop,
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
