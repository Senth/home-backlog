import type { Ref } from "react";
import { FlatList, ScrollView, type ScrollViewProps } from "react-native";

export type SlimScrollViewProps = ScrollViewProps & {
	fadeEdges?: boolean;
	ref?: Ref<ScrollView>;
};

/** Native keeps the platform's own indicator, and has no CSS mask to fade with. */
export function SlimScrollView({
	fadeEdges: _fadeEdges,
	...props
}: SlimScrollViewProps) {
	return <ScrollView {...props} />;
}

export const SlimFlatList = FlatList;
