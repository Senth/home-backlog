import { useIsFocused } from "@react-navigation/native";
import { useCallback, useState } from "react";
import type { View } from "react-native";
import { useEscapeCancel } from "@/hooks/use-escape-cancel";
import type { Node } from "@/models/node";
import { prune, range, type SelectionState, toggle } from "@/models/selection";

const empty: SelectionState = { status: null, ids: [], anchor: null };

export function useCardSelection(board: string, enabled: boolean) {
	const focused = useIsFocused();
	const [state, setState] = useState(empty);
	const [selecting, setSelecting] = useState(false);
	const [moveAnchor, setMoveAnchor] = useState<{ x: number; y: number } | null>(
		null,
	);
	const clear = useCallback(() => {
		setState(empty);
		setSelecting(false);
		setMoveAnchor(null);
	}, []);
	useEscapeCancel(selecting, clear);
	const [renderedBoard, setRenderedBoard] = useState(board);
	if (renderedBoard !== board) {
		setRenderedBoard(board);
		clear();
	} else if ((!focused || !enabled) && selecting) {
		clear();
	}

	const toggleCard = useCallback((card: Pick<Node, "id" | "status">) => {
		setSelecting(true);
		setState((previous) => toggle(previous, card) ?? previous);
	}, []);
	const selectRange = useCallback(
		(
			card: Pick<Node, "id" | "status">,
			column: readonly Pick<Node, "id">[],
		) => {
			setSelecting(true);
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

	const start = useCallback(() => setSelecting(true), []);
	const openMove = useCallback((anchor: View | null) => {
		anchor?.measureInWindow((x, y, _width, height) => {
			setMoveAnchor({ x, y: y + height });
		});
	}, []);
	const closeMove = useCallback(() => setMoveAnchor(null), []);
	return {
		state,
		selecting,
		start,
		clear,
		toggleCard,
		selectRange,
		pruneVisible,
		moveAnchor,
		openMove,
		closeMove,
	};
}
