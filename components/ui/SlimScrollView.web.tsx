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
import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import { useAppTheme } from "@/theme";
import { radius, scrollbar } from "@/theme/tokens";

export type SlimScrollViewProps = ScrollViewProps & {
	fadeEdges?: boolean;
	ref?: Ref<ScrollView>;
};

type Size = ScrollMetrics["contentSize"];

const frameRate = 16;

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
 * while the pointer is over the scroller or focus is inside it. `fadeEdges`
 * fades the content at any edge that has more beyond it.
 */
export function SlimScrollView({
	fadeEdges = false,
	style,
	horizontal,
	showsVerticalScrollIndicator,
	showsHorizontalScrollIndicator,
	scrollEventThrottle = frameRate,
	onLayout,
	onContentSizeChange,
	onScroll,
	ref,
	...props
}: SlimScrollViewProps) {
	const theme = useAppTheme();
	const coarse = useCoarsePointer();
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
	const thumb = coarse ? null : geometry?.thumb;
	const mask =
		fadeEdges && geometry
			? fadeMask(Boolean(horizontal), geometry.fade)
			: undefined;
	const masked = mask ? { maskImage: mask, WebkitMaskImage: mask } : null;

	return (
		<View
			style={style}
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
					coarse ? showsVerticalScrollIndicator : false
				}
				showsHorizontalScrollIndicator={
					coarse ? showsHorizontalScrollIndicator : false
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
					const { contentOffset, contentSize, layoutMeasurement } =
						event.nativeEvent;
					setOffset({ x: contentOffset.x, y: contentOffset.y });
					setContent({ width: contentSize.width, height: contentSize.height });
					setLayout({
						width: layoutMeasurement.width,
						height: layoutMeasurement.height,
					});
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
