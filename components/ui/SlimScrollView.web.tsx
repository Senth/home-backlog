import { type Ref, useState } from "react";
import {
	FlatList,
	type FlatListProps,
	type LayoutChangeEvent,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
	ScrollView,
	type ScrollViewProps,
	View,
} from "react-native";
import { type ScrollMetrics, scrollThumb } from "@/components/ui/scroll-thumb";
import { useFinePointer } from "@/hooks/use-coarse-pointer";
import { useAppTheme } from "@/theme";
import { radius, scrollbar } from "@/theme/tokens";

export type SlimScrollViewProps = ScrollViewProps & {
	fadeEdges?: boolean;
	ref?: Ref<ScrollView>;
};

type Size = ScrollMetrics["contentSize"];

const frameMs = 16;

/** The fade as an alpha mask: `black` keeps the content whole, `transparent` is an edge with more beyond it. */
function fadeMask(
	horizontal: boolean,
	fade: { start: boolean; end: boolean },
): string {
	const start = fade.start ? `transparent, black ${scrollbar.fade}px` : "black";
	const end = fade.end
		? `black calc(100% - ${scrollbar.fade}px), transparent`
		: "black";
	return `linear-gradient(to ${horizontal ? "right" : "bottom"}, ${start}, ${end})`;
}

/**
 * The app's scroller on web (#377): the native bar hidden, and a 3px thumb
 * drawn over the content in its place, taking no layout width. The thumb shows
 * while the pointer is over the scroller or focus is inside it, and never when
 * the caller turned the axis's indicator off. `fadeEdges` fades the content at
 * any edge that has more beyond it. The wrapper takes the caller's `style` and
 * `ScrollView`'s own flex defaults, so it sizes exactly as the bare scroller
 * did, `maxHeight` included, and the inner scroller fills it.
 */
export function SlimScrollView({
	fadeEdges = false,
	style,
	horizontal,
	showsVerticalScrollIndicator,
	showsHorizontalScrollIndicator,
	scrollEventThrottle = frameMs,
	onLayout,
	onContentSizeChange,
	onScroll,
	ref,
	...props
}: SlimScrollViewProps) {
	const theme = useAppTheme();
	const fine = useFinePointer();
	const [layout, setLayout] = useState<Size | null>(null);
	const [content, setContent] = useState<Size | null>(null);
	const [offset, setOffset] = useState({ x: 0, y: 0 });
	const [hovered, setHovered] = useState(false);
	const [focused, setFocused] = useState(false);

	const geometry =
		layout && content
			? scrollThumb(
					{
						contentSize: content,
						layoutMeasurement: layout,
						contentOffset: offset,
					},
					horizontal ? "horizontal" : "vertical",
				)
			: null;
	const bare =
		(horizontal
			? showsHorizontalScrollIndicator
			: showsVerticalScrollIndicator) === false;
	const thumbShown = fine && !bare;
	const thumb = thumbShown ? geometry?.thumb : null;
	const mask =
		fadeEdges && geometry
			? fadeMask(Boolean(horizontal), geometry.fade)
			: undefined;
	const masked = mask ? { maskImage: mask, WebkitMaskImage: mask } : null;

	return (
		<View
			style={[{ flexGrow: 1, flexShrink: 1 }, style]}
			onPointerEnter={() => setHovered(true)}
			onPointerLeave={() => setHovered(false)}
			onFocus={() => setFocused(true)}
			onBlur={() => setFocused(false)}
		>
			<ScrollView
				{...props}
				ref={ref}
				horizontal={horizontal}
				showsVerticalScrollIndicator={
					fine ? false : showsVerticalScrollIndicator
				}
				showsHorizontalScrollIndicator={
					fine ? false : showsHorizontalScrollIndicator
				}
				scrollEventThrottle={scrollEventThrottle}
				style={{ flexGrow: 1, ...masked }}
				onLayout={(event: LayoutChangeEvent) => {
					const { width, height } = event.nativeEvent.layout;
					setLayout({ width, height });
					onLayout?.(event);
				}}
				onContentSizeChange={(width, height) => {
					setContent({ width, height });
					onContentSizeChange?.(width, height);
				}}
				onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
					if (fadeEdges || thumbShown) {
						const { x, y } = event.nativeEvent.contentOffset;
						setOffset({ x, y });
					}
					onScroll?.(event);
				}}
			/>
			{thumb ? (
				<View
					pointerEvents="none"
					style={{
						position: "absolute",
						borderRadius: radius.full,
						backgroundColor: theme.colors.outlineVariant,
						opacity: hovered || focused ? 1 : 0,
						...(horizontal
							? {
									left: thumb.offset,
									bottom: scrollbar.inset,
									width: thumb.length,
									height: scrollbar.thumb,
								}
							: {
									top: thumb.offset,
									right: scrollbar.inset,
									width: scrollbar.thumb,
									height: thumb.length,
								}),
					}}
				/>
			) : null}
		</View>
	);
}

/** A `FlatList` whose scroller is `SlimScrollView`. */
export function SlimFlatList<T>(
	props: FlatListProps<T> & { ref?: Ref<FlatList<T>> },
) {
	return (
		<FlatList
			{...props}
			renderScrollComponent={(scrollProps) => (
				<SlimScrollView {...scrollProps} />
			)}
		/>
	);
}
