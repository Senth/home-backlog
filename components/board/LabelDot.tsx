import { useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "react-native-paper";
import { LabelGlyph } from "@/components/label/LabelGlyph";
import type { LabelWithId } from "@/models/label";
import { useAppTheme } from "@/theme";
import { contentWidth, elevation, radius, size, space } from "@/theme/tokens";

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
			hitSlop={space.xs}
		>
			<LabelGlyph color={label.color} icon={label.icon} />
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
