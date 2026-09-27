import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { HelperText, Text, TextInput } from "react-native-paper";
import { GradientSlider } from "@/components/ui/GradientSlider";
import {
	type CustomParts,
	composeCustom,
	decomposeCustom,
	drawCustom,
	isHexColor,
	parseHex,
	type Role,
	storedFromTyped,
	toHex,
} from "@/models/label-color";
import { customColorBands, labelHues, useAppTheme } from "@/theme";
import { radius, size, space, touchTarget } from "@/theme/tokens";

interface CustomColorPickerProps {
	value: string;
	onChange: (color: string) => void;
	onInvalidChange?: (invalid: boolean) => void;
	role: Role;
}

export function CustomColorPicker({
	value,
	onChange,
	onInvalidChange,
	role,
}: CustomColorPickerProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const scheme = theme.dark ? "dark" : "light";
	const band = customColorBands[role][scheme];
	const lightBand = customColorBands[role].light;
	const initial =
		value in labelHues
			? labelHues[value as keyof typeof labelHues].light[role]
			: value;
	const [parts, setParts] = useState<CustomParts>(() => ({
		...decomposeCustom(initial, lightBand),
		strength:
			value in labelHues ? 0.5 : decomposeCustom(initial, lightBand).strength,
	}));
	const drawn = useCallback(
		(stored: string) =>
			drawCustom(
				stored,
				role,
				scheme,
				customColorBands,
				theme.colors.background,
			).fill,
		[role, scheme, theme.colors.background],
	);
	const stored = composeCustom(parts, lightBand);
	const color = drawn(stored);
	const [draft, setDraft] = useState(color);
	const [adjusted, setAdjusted] = useState(false);
	const [width, setWidth] = useState<number | null>(null);
	const focused = useRef(false);
	const emitted = useRef<string | null>(null);
	const previousValue = useRef(value);
	const previousHue = useRef(parts.hue);
	previousHue.current = parts.hue;
	useEffect(() => () => onInvalidChange?.(false), [onInvalidChange]);

	useEffect(() => {
		if (emitted.current === value) {
			emitted.current = null;
			previousValue.current = value;
			return;
		}
		const source =
			value in labelHues
				? labelHues[value as keyof typeof labelHues].light[role]
				: value;
		const next = decomposeCustom(
			source,
			lightBand,
			"light",
			previousHue.current,
		);
		if (value in labelHues) next.strength = 0.5;
		setParts(next);
		if (!focused.current || previousValue.current !== value)
			setDraft(drawn(composeCustom(next, lightBand)));
		previousValue.current = value;
		setAdjusted(false);
	}, [value, role, lightBand, drawn]);

	const changeParts = (next: CustomParts) => {
		const hex = composeCustom(next, lightBand);
		setParts(next);
		setDraft(drawn(hex));
		setAdjusted(false);
		onInvalidChange?.(false);
		emitted.current = hex;
		onChange(hex);
	};
	const commit = (next: string) => {
		setDraft(next);
		if (!isHexColor(next)) {
			setAdjusted(false);
			onInvalidChange?.(true);
			return;
		}
		onInvalidChange?.(false);
		const hex = storedFromTyped(next, role, scheme, customColorBands);
		setParts(decomposeCustom(next, band, scheme, parts.hue));
		setAdjusted(toHex(parseHex(next)) !== drawn(hex));
		emitted.current = hex;
		onChange(hex);
	};
	const stops = (count: number, getParts: (fraction: number) => CustomParts) =>
		Array.from({ length: count }, (_, index) =>
			composeCustom(getParts(index / (count - 1)), band, scheme),
		);
	const rows = [
		{
			name: t("labels.hueSlider"),
			value: parts.hue / 360,
			onChange: (fraction: number) =>
				changeParts({ ...parts, hue: fraction * 360 }),
			stops: stops(13, (fraction) => ({
				hue: fraction * 360,
				vividness: 1,
				strength: 0.5,
			})),
		},
		{
			name: t("labels.vividness"),
			value: parts.vividness,
			onChange: (vividness: number) => changeParts({ ...parts, vividness }),
			stops: stops(9, (vividness) => ({ ...parts, vividness })),
		},
		{
			name: t("labels.strength"),
			value: parts.strength,
			onChange: (strength: number) => changeParts({ ...parts, strength }),
			stops: stops(9, (strength) => ({ ...parts, strength })),
		},
	];
	const stacked = width !== null && width < size.sliderLabel + touchTarget;

	return (
		<View
			onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
			style={{ gap: space.sm, opacity: width === null ? 0 : 1 }}
		>
			{rows.map((row) => (
				<View
					key={row.name}
					style={{
						flexDirection: stacked ? "column" : "row",
						alignItems: stacked ? "stretch" : "center",
						gap: stacked ? space.xs : space.none,
					}}
				>
					<Text
						variant="bodyMedium"
						style={{
							...(stacked ? {} : { width: size.sliderLabel }),
							color: theme.colors.onSurfaceVariant,
						}}
					>
						{row.name}
					</Text>
					<View style={stacked ? { width: "100%" } : { flex: 1 }}>
						<GradientSlider
							label={row.name}
							value={row.value}
							valueText={`${Math.round(row.value * 100)}%`}
							onChange={row.onChange}
							stops={row.stops}
							thumbColor={color}
						/>
					</View>
				</View>
			))}
			<View>
				<TextInput
					mode="outlined"
					label={t("labels.customColor")}
					value={draft}
					onChangeText={commit}
					onFocus={() => {
						focused.current = true;
					}}
					onBlur={() => {
						focused.current = false;
						if (isHexColor(draft)) setDraft(color);
					}}
					autoCapitalize="none"
					autoComplete="off"
					error={!isHexColor(draft)}
					left={
						<TextInput.Icon
							icon={() => (
								<View
									style={{
										width: size.labelDot,
										height: size.labelDot,
										borderRadius: radius.full,
										backgroundColor: color,
									}}
								/>
							)}
						/>
					}
				/>
				<HelperText
					type={!isHexColor(draft) ? "error" : "info"}
					visible={!isHexColor(draft) || adjusted}
				>
					{!isHexColor(draft)
						? t("labels.colorInvalid")
						: adjusted
							? t("labels.colorAdjusted")
							: ""}
				</HelperText>
			</View>
		</View>
	);
}
