import { router, useLocalSearchParams } from "expo-router";
import { useWindowDimensions } from "react-native";
import { detailsHref } from "@/components/board/board-href";
import { DetailsView } from "@/components/node/DetailsView";
import { contentWidth } from "@/theme/tokens";

function closeToLocations() {
	router.dismissTo("/projects");
	router.navigate("/locations");
}

export default function NodeDetails() {
	const { nodeId, from } = useLocalSearchParams<{
		nodeId: string;
		from?: string;
	}>();
	const { width } = useWindowDimensions();

	return (
		<DetailsView
			key={nodeId}
			nodeId={nodeId}
			width={Math.min(width, contentWidth.form)}
			onClose={from === "locations" ? closeToLocations : undefined}
			onOpenNode={(id) => router.push(detailsHref(id))}
		/>
	);
}
