import { useIsFocused } from "@react-navigation/native";
import { useCallback, useState } from "react";
import type { Node } from "@/models/node";
import { prune, range, type SelectionState, toggle } from "@/models/selection";

const empty: SelectionState = { status: null, ids: [], anchor: null };

export function useCardSelection(board: string, enabled: boolean) {
	const focused = useIsFocused();
	const [state, setState] = useState(empty);
	const [renderedBoard, setRenderedBoard] = useState(board);
	if (renderedBoard !== board) {
		setRenderedBoard(board);
		setState(empty);
	} else if ((!focused || !enabled) && state !== empty) {
		setState(empty);
	}

	const toggleCard = useCallback((card: Pick<Node, "id" | "status">) => {
		setState((previous) => toggle(previous, card) ?? previous);
	}, []);
	const selectRange = useCallback(
		(
			card: Pick<Node, "id" | "status">,
			column: readonly Pick<Node, "id">[],
		) => {
			setState((previous) => range(previous, card, column) ?? previous);
		},
		[],
	);
	const pruneVisible = useCallback(
		(cards: readonly Pick<Node, "id" | "status">[]) => {
			setState((previous) => {
				const visibleIds = new Set(
					cards
						.filter((card) => card.status === previous.status)
						.map((card) => card.id),
				);
				const next = prune(previous, visibleIds);
				return next.ids.length === previous.ids.length ? previous : next;
			});
		},
		[],
	);

	return { state, toggleCard, selectRange, pruneVisible };
}
