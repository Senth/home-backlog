import { useLocalSearchParams, useRouter } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { useEffect, useRef } from "react";
import { detailsCardId } from "@/components/board/board-href";

let pending:
	| { homeId: string; parentId: string | null; id: string }
	| undefined;

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
	onFinish: (id: string, animate: boolean) => void,
) {
	const { finish } = useLocalSearchParams<{ finish?: string | string[] }>();
	const id = finish === undefined ? undefined : detailsCardId(finish);
	const { setParams } = useRouter();
	const focused = useIsFocused();
	const consumed = useRef<string | null | undefined>(undefined);

	useEffect(() => {
		if (id === undefined) consumed.current = undefined;
		if (!ready || !focused) return;

		const arrival =
			pending?.homeId === homeId && pending.parentId === parentId
				? pending
				: undefined;
		const hasParam = id !== undefined && consumed.current !== id;
		if (hasParam) {
			consumed.current = id;
			setParams({ finish: undefined });
		}
		if (arrival !== undefined) {
			pending = undefined;
			onFinish(arrival.id, true);
		} else if (hasParam && id !== null) {
			onFinish(id, false);
		}
	}, [id, ready, focused, setParams, onFinish, homeId, parentId]);
}
