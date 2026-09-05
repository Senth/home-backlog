import { useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "react-native-paper";
import { PaperIcon } from "@/components/ui/PaperIcon";
import type { LabelWithId } from "@/models/label";
import { clampLabelColor } from "@/models/label-color";
import { type LabelHueName, labelHues, useAppTheme } from "@/theme";
import {
	contentWidth,
	elevation,
	icon,
	radius,
	size,
	space,
} from "@/theme/tokens";

/**
 * One label dot in the card's left gutter (#100): the label's glyph in its
 * hue, a circle the same size as the priority dot beside it.
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
 * A preset hue reads its own fill and on-colour from the theme, both schemes
 * explicit; a custom colour is clamped at draw time by `clampLabelColor`, so a
 * change to `boardCard` or to a floor re-derives it rather than letting the
 * stored value go stale.
 */
export function LabelDot({ label }: { label: LabelWithId }) {
	const theme = useAppTheme();
	const [open, setOpen] = useState(false);

	const hue =
		label.color in labelHues
			? labelHues[label.color as LabelHueName]
			: undefined;
	const scheme = theme.dark ? "dark" : "light";
	const { fill, on } =
		hue?.[scheme] ??
		clampLabelColor(label.color, scheme, theme.colors.boardCard);

	return (
		<Pressable
			accessible
			accessibilityRole="button"
			accessibilityLabel={label.title}
			accessibilityState={{ expanded: open }}
			onPress={() => setOpen((wasOpen) => !wasOpen)}
			onHoverIn={() => setOpen(true)}
			onHoverOut={() => setOpen(false)}
			hitSlop={space.xs}
		>
			<View
				style={{
					width: size.labelDot,
					height: size.labelDot,
					borderRadius: radius.full,
					backgroundColor: fill,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<PaperIcon name={label.icon} size={icon.sm} color={on} />
			</View>
			{open ? (
				<View
					style={{
						position: "absolute",
						left: size.labelDot,
						top: space.none,
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
