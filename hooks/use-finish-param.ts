import { useLocalSearchParams, useRouter } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { useEffect, useRef } from "react";
import { detailsCardId } from "@/components/board/board-href";

export function useFinishParam(ready: boolean, onFinish: (id: string) => void) {
	const { finish } = useLocalSearchParams<{ finish?: string | string[] }>();
	const id = finish === undefined ? undefined : detailsCardId(finish);
	const { setParams } = useRouter();
	const focused = useIsFocused();
	const consumed = useRef<string | null | undefined>(undefined);

	useEffect(() => {
		if (id === undefined) {
			consumed.current = undefined;
			return;
		}
		if (!ready || !focused || consumed.current === id) return;

		consumed.current = id;
		setParams({ finish: undefined });
		if (id !== null) onFinish(id);
	}, [id, ready, focused, setParams, onFinish]);
}
