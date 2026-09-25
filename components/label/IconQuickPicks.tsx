import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Swatch } from "@/components/label/ColorSwatches";
import { PaperIcon } from "@/components/ui/PaperIcon";
import { useLabelColors } from "@/hooks/use-label-colors";
import { useLocationColors } from "@/hooks/use-location-colors";
import { useAppTheme } from "@/theme";
import { icon, radius, size, space } from "@/theme/tokens";

interface IconQuickPicksProps {
	value: string;
	color: string;
	picks: readonly string[];
	onChange: (glyph: string) => void;
	onOpenPicker: () => void;
	variant: "label" | "location";
}

/** Twelve fixed picks and one search slot, matching the color palette's wrap. */
export function IconQuickPicks({
	value,
	color,
	picks,
	onChange,
	onOpenPicker,
	variant,
}: IconQuickPicksProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const label = useLabelColors(color);
	const location = useLocationColors(color);
	const selectedColor = variant === "label" ? label : location;
	const isCustom = !picks.includes(value);
	const selectedGlyph = (name: string) =>
		variant === "location" ? (
			<PaperIcon name={name} size={icon.md} color={selectedColor.fill} />
		) : (
			<View
				style={{
					width: size.avatarSm,
					height: size.avatarSm,
					borderRadius: radius.full,
					backgroundColor: selectedColor.fill,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<PaperIcon name={name} size={icon.md} color={selectedColor.on} />
			</View>
		);

	return (
		<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
			{picks.map((name) => {
				const selected = value === name;
				return (
					<Swatch
						key={name}
						accessibilityLabel={t(`icons.pick.${name}`)}
						selected={selected}
						onSelect={() => onChange(name)}
					>
						{selected ? (
							selectedGlyph(name)
						) : (
							<PaperIcon
								name={name}
								size={icon.md}
								color={theme.colors.onSurfaceVariant}
							/>
						)}
					</Swatch>
				);
			})}
			<Swatch
				accessibilityLabel={t("icons.more")}
				selected={isCustom}
				onSelect={onOpenPicker}
			>
				{isCustom ? (
					<View
						style={{
							alignItems: "center",
							justifyContent: "center",
							width: size.avatarSm,
							height: size.avatarSm,
						}}
					>
						{selectedGlyph(value)}
						<View
							style={{
								position: "absolute",
								bottom: space.none,
								right: space.none,
								width: size.labelDot,
								height: size.labelDot,
								borderRadius: radius.full,
								backgroundColor: theme.colors.background,
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<PaperIcon
								name="magnify"
								size={icon.sm}
								color={theme.colors.onSurfaceVariant}
							/>
						</View>
					</View>
				) : (
					<View
						style={{
							width: size.avatarSm,
							height: size.avatarSm,
							borderRadius: radius.full,
							backgroundColor: theme.colors.surfaceVariant,
							alignItems: "center",
							justifyContent: "center",
						}}
					>
						<PaperIcon
							name="magnify"
							size={icon.sm}
							color={theme.colors.onSurfaceVariant}
						/>
					</View>
				)}
			</Swatch>
		</View>
	);
}
