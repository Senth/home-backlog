import { View } from "react-native";
import { PaperIcon } from "@/components/ui/PaperIcon";
import { type Priority, priorityOrder } from "@/models/node";
import { icon, priorityRamp, radius, size } from "@/theme/tokens";

interface PriorityDotProps {
	priority: Priority;
	/**
	 * The name, when the dot is the only thing carrying it — the card gutter's
	 * mark. Absent, the dot is decorative beside the word that names it.
	 */
	label?: string;
}

/**
 * The priority ramp's dot (#100): the ramp glyph knocked out of its hue, at
 * the gutter dot's size. Extracted from `CardGutter` so the details screen's
 * priority row (#237) draws the identical mark instead of a restyled copy —
 * one dot definition, two surfaces.
 */
export function PriorityDot({ priority, label }: PriorityDotProps) {
	const step = priorityRamp[priorityOrder[priority]];

	return (
		<View
			accessible={label !== undefined}
			accessibilityRole={label === undefined ? undefined : "image"}
			accessibilityLabel={label}
			style={{
				width: size.labelDot,
				height: size.labelDot,
				borderRadius: radius.full,
				backgroundColor: step.color,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			{/* The glyph is knocked out of the dot in the ramp's own on-color. */}
			<PaperIcon name={step.glyph} size={icon.sm} color={step.on} />
		</View>
	);
}
