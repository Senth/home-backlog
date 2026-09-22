import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Icon } from "react-native-paper";
import { ColorField } from "@/components/ui/ColorField";
import { useLabelColors } from "@/hooks/use-label-colors";
import { useLocationColors } from "@/hooks/use-location-colors";
import { type LabelHueName, labelHues, useAppTheme } from "@/theme";
import { border, icon, radius, size, space, touchTarget } from "@/theme/tokens";

const hueNames = Object.keys(labelHues) as LabelHueName[];

/** The two tones one stored color draws in, per variant — see `ColorSwatches`. */
function useSwatchColors(color: string, variant: "label" | "location") {
	const label = useLabelColors(color);
	const location = useLocationColors(color);
	return variant === "location" ? location : label;
}

interface ColorSwatchesProps {
	/** The color exactly as stored — a hue name or a custom hex. */
	value: string;
	/** Called with the chosen hue, or the normalized hex once the field holds one. */
	onChange: (color: string) => void;
	/**
	 * Which drawing the swatches preview. Labels are filled dots in a hue's
	 * `fill` tone; locations are bare glyphs in its `ink` tone, and a custom
	 * color clamps against the page rather than the card (#328). Default:
	 * `label`.
	 */
	variant?: "label" | "location";
}

/**
 * The identity palette row (#100): the twelve preset hues, then the custom
 * swatch that opens `ColorField`. LabelDialog draws it beneath the icon and
 * LocationDialog (#205) draws the same row, so both pickers are one
 * implementation — extend this file, never restyle a copy.
 *
 * The custom field is open from the start when the stored color already is a
 * custom one — the field is where its value is visible.
 */
export function ColorSwatches({
	value,
	onChange,
	variant = "label",
}: ColorSwatchesProps) {
	const { t } = useTranslation();
	const [customOpen, setCustomOpen] = useState(
		!(value in labelHues) && value !== "",
	);

	return (
		<View style={{ gap: space.sm }}>
			<View
				style={{
					flexDirection: "row",
					flexWrap: "wrap",
					gap: space.xs,
				}}
			>
				{hueNames.map((hue) => (
					<HueSwatch
						key={hue}
						hue={hue}
						selected={value === hue}
						onSelect={() => onChange(hue)}
						variant={variant}
					/>
				))}
				<CustomSwatch
					color={value}
					selected={!(value in labelHues)}
					onOpen={() => setCustomOpen(true)}
					variant={variant}
				/>
			</View>
			{customOpen ? (
				<ColorField
					label={t("labels.customColor")}
					value={value}
					onChange={onChange}
				/>
			) : null}
		</View>
	);
}

interface SwatchProps {
	/** The accessible name — the swatch is a shape, and a shape says nothing. */
	accessibilityLabel: string;
	selected: boolean;
	onSelect: () => void;
}

/**
 * One color swatch: the dot inside a full `touchTarget` pressable, with a
 * hairline ring on the chosen one and a check in the dot's own on-color —
 * the same mark the icon picker's list rows make. The dot is `avatarSm`, so
 * the ring reads around the color, not over it.
 */
function Swatch({
	accessibilityLabel,
	selected,
	onSelect,
	children,
}: SwatchProps & { children: ReactNode }) {
	const theme = useAppTheme();

	return (
		<Pressable
			accessible
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel}
			accessibilityState={{ selected }}
			onPress={onSelect}
			style={{
				width: touchTarget,
				height: touchTarget,
				borderRadius: radius.full,
				alignItems: "center",
				justifyContent: "center",
				// The ring is a conditional spread: `border` has no zero width,
				// and a 0 belongs to no scale this repo keeps.
				...(selected
					? {
							borderWidth: border.hairline,
							borderColor: theme.colors.onSurface,
						}
					: {}),
			}}
		>
			{children}
		</Pressable>
	);
}

function HueSwatch({
	hue,
	selected,
	onSelect,
	variant,
}: {
	hue: LabelHueName;
	selected: boolean;
	onSelect: () => void;
	variant: "label" | "location";
}) {
	const { t } = useTranslation();
	const { fill, on } = useSwatchColors(hue, variant);

	return (
		<Swatch
			accessibilityLabel={t(`labels.hue.${hue}`)}
			selected={selected}
			onSelect={onSelect}
		>
			<View
				style={{
					width: size.avatarSm,
					height: size.avatarSm,
					borderRadius: radius.full,
					backgroundColor: fill,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				{selected ? <Icon source="check" size={icon.sm} color={on} /> : null}
			</View>
		</Swatch>
	);
}

function CustomSwatch({
	color,
	selected,
	onOpen,
	variant,
}: {
	color: string;
	selected: boolean;
	onOpen: () => void;
	variant: "label" | "location";
}) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const isCustom = !(color in labelHues);
	const { fill, on } = useSwatchColors(color, variant);

	return (
		<Swatch
			accessibilityLabel={t("labels.customColor")}
			selected={selected}
			onSelect={onOpen}
		>
			<View
				style={{
					width: size.avatarSm,
					height: size.avatarSm,
					borderRadius: radius.full,
					backgroundColor: isCustom ? fill : theme.colors.surfaceVariant,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<Icon
					source="pencil"
					size={icon.sm}
					color={isCustom ? on : theme.colors.onSurfaceVariant}
				/>
			</View>
		</Swatch>
	);
}
