import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useWindowDimensions } from "react-native";
import {
	boardHref,
	detailsCardId,
	detailsHref,
} from "@/components/board/board-href";
import { DetailsView } from "@/components/node/DetailsView";
import { useHome } from "@/contexts/HomeContext";
import { useNode } from "@/hooks/use-node";
import { compactBreakpoint, contentWidth } from "@/theme/tokens";

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
	if (width >= compactBreakpoint)
		return <DesktopDetailsRedirect nodeId={nodeId} />;

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

function DesktopDetailsRedirect({ nodeId }: { nodeId: string }) {
	const { activeHome } = useHome();
	const id = detailsCardId(nodeId);
	const { node, gone } = useNode(activeHome?.id ?? null, id);
	if (id === null || gone) return <Redirect href={boardHref(null)} />;
	if (node === null) return null;
	return <Redirect href={boardHref(node.parentId, node.id)} />;
}
