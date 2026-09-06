import { View } from "react-native";
import { PaperIcon } from "@/components/ui/PaperIcon";
import { useLabelColors } from "@/hooks/use-label-colors";
import { icon as iconSize, radius, size } from "@/theme/tokens";

interface LabelGlyphProps {
	/** The label's colour exactly as stored — a preset hue name or a custom hex. */
	color: string;
	/** The label's MaterialCommunityIcons glyph name. */
	icon: string;
}

/**
 * One label dot, not pressable: the glyph in its hue, a circle the same size
 * as the priority dot beside it in the gutter.
 *
 * The dot alone says nothing about *which* label it is, so wherever this
 * renders, the name is carried by the control around it — `LabelDot` puts the
 * title on its own wrapper, and a picker row or a details field puts it on the
 * row. This piece only answers "what does the dot look like".
 */
export function LabelGlyph({ color, icon }: LabelGlyphProps) {
	const { fill, on } = useLabelColors(color);

	return (
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
			<PaperIcon name={icon} size={iconSize.sm} color={on} />
		</View>
	);
}
