import { useLocalSearchParams, useRouter } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { useEffect, useRef, useState } from "react";
import { detailsCardId } from "@/components/board/board-href";
import { useNodes } from "@/hooks/use-nodes";
import type { Node } from "@/models/node";

type FinishRequest = { homeId: string; parentId: string | null; id: string };

let pending: FinishRequest | undefined;

export function requestProjectFinish(
	homeId: string,
	parentId: string | null,
	id: string,
) {
	pending = { homeId, parentId, id };
}

export function useFinishParam(
	homeId: string,
	parentId: string | null,
	ready: boolean,
	onFinish: (id: string, steps: Node[]) => void,
) {
	const { finish } = useLocalSearchParams<{ finish?: string | string[] }>();
	const id = finish === undefined ? undefined : detailsCardId(finish);
	const { setParams } = useRouter();
	const focused = useIsFocused();
	const consumed = useRef<string | null | undefined>(undefined);
	const [request, setRequest] = useState<FinishRequest>();
	const arrival =
		focused && request?.homeId === homeId && request.parentId === parentId
			? request
			: undefined;
	const steps = useNodes(homeId, arrival?.id ?? null, arrival !== undefined);

	useEffect(() => {
		if (id === undefined) consumed.current = undefined;
		if (!ready || !focused) return;

		if (id !== undefined && consumed.current !== id) {
			consumed.current = id;
			setParams({ finish: undefined });
		}
		if (pending?.homeId === homeId && pending.parentId === parentId) {
			setRequest(pending);
			pending = undefined;
		}
	}, [id, ready, focused, setParams, homeId, parentId]);

	useEffect(() => {
		if (request === undefined) return;
		if (arrival === undefined) setRequest(undefined);
		else if (ready && !steps.loading) {
			setRequest(undefined);
			if (!steps.failed) onFinish(arrival.id, steps.nodes);
		}
	}, [
		request,
		arrival,
		ready,
		steps.loading,
		steps.failed,
		steps.nodes,
		onFinish,
	]);
}
