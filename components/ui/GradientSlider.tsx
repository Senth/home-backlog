import { type KeyboardEvent, useId, useMemo, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useAppTheme } from "@/theme";
import { border, radius, size, space, touchTarget } from "@/theme/tokens";

interface GradientSliderProps {
	value: number;
	onChange: (value: number) => void;
	stops: string[];
	thumbColor: string;
	label: string;
	valueText: string;
}

const clamp = (next: number) => Math.max(0, Math.min(1, next));
const thumbDiameter = size.sliderThumb + space.xs;

export function GradientSlider({
	value,
	onChange,
	stops,
	thumbColor,
	label,
	valueText,
}: GradientSliderProps) {
	const theme = useAppTheme();
	const gradientId = useId();
	const [width, setWidth] = useState(0);
	const current = useRef({ width, onChange });
	current.current = { width, onChange };
	const gesture = useMemo(() => {
		const setPosition = (x: number) => {
			const { width: measuredWidth, onChange: change } = current.current;
			if (measuredWidth > thumbDiameter) {
				change(
					clamp((x - thumbDiameter / 2) / (measuredWidth - thumbDiameter)),
				);
			}
		};
		return Gesture.Race(
			Gesture.Pan()
				.minDistance(0)
				.runOnJS(true)
				.onStart((event) => setPosition(event.x))
				.onUpdate((event) => setPosition(event.x)),
			Gesture.Tap()
				.runOnJS(true)
				.onEnd((event) => setPosition(event.x)),
		);
	}, []);
	const onKeyDown = (event: KeyboardEvent<View>) => {
		const steps: Record<string, number> = {
			ArrowRight: 0.01,
			ArrowUp: 0.01,
			ArrowLeft: -0.01,
			ArrowDown: -0.01,
			PageUp: 0.1,
			PageDown: -0.1,
		};
		const next =
			event.key === "Home"
				? 0
				: event.key === "End"
					? 1
					: event.key in steps
						? clamp(value + steps[event.key])
						: undefined;
		if (next !== undefined) {
			event.preventDefault();
			onChange(next);
		}
	};

	return (
		<GestureDetector gesture={gesture}>
			<View
				accessible
				accessibilityRole="adjustable"
				accessibilityLabel={label}
				accessibilityValue={{
					min: 0,
					max: 100,
					now: Math.round(value * 100),
					text: valueText,
				}}
				accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
				onAccessibilityAction={(event) => {
					if (event.nativeEvent.actionName === "increment")
						onChange(clamp(value + 0.01));
					if (event.nativeEvent.actionName === "decrement")
						onChange(clamp(value - 0.01));
				}}
				{...(Platform.OS === "web"
					? {
							tabIndex: 0,
							onKeyDown,
							"aria-valuemin": 0,
							"aria-valuemax": 100,
							"aria-valuenow": Math.round(value * 100),
							"aria-valuetext": valueText,
						}
					: {})}
				onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
				style={{ minHeight: touchTarget, justifyContent: "center" }}
			>
				<Svg
					width="100%"
					height={size.sliderTrack}
					{...(Platform.OS === "web" ? { "aria-hidden": true } : {})}
				>
					<Defs>
						<LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
							{stops.map((color, index) => (
								<Stop
									key={`${color}-${stops.slice(0, index).filter((each) => each === color).length}`}
									offset={`${(index / Math.max(stops.length - 1, 1)) * 100}%`}
									stopColor={color}
								/>
							))}
						</LinearGradient>
					</Defs>
					<Rect
						width="100%"
						height="100%"
						rx={size.sliderTrack / 2}
						ry={size.sliderTrack / 2}
						fill={`url(#${gradientId})`}
					/>
				</Svg>
				<View
					pointerEvents="none"
					style={{
						position: "absolute",
						left: clamp(value) * Math.max(width - thumbDiameter, 0),
						width: thumbDiameter,
						height: thumbDiameter,
						borderRadius: radius.full,
						borderWidth: border.hairline,
						borderColor: theme.colors.outline,
						backgroundColor: theme.dark
							? theme.colors.onSurface
							: theme.colors.surface,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<View
						style={{
							width: size.sliderThumb - space.xs,
							height: size.sliderThumb - space.xs,
							borderRadius: radius.full,
							backgroundColor: thumbColor,
						}}
					/>
				</View>
			</View>
		</GestureDetector>
	);
}
