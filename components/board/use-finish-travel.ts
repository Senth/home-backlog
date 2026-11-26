import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Animated } from "react-native";
import type { Notice } from "@/components/board/CardMenu";
import {
	type BoardDrag,
	boardKey,
	cardKey,
	columnKey,
	dropSpring,
} from "@/components/board/use-board-drag";
import type { Box } from "@/models/drag";
import type { Node, Status } from "@/models/node";
import { drag, space } from "@/theme/tokens";

interface Options {
	board: string;
	focused: boolean;
	compact: boolean;
	blocked: boolean;
	onScreen: Status | undefined;
	shownNodes: Node[];
	measure: BoardDrag["measureFrame"];
	onNotice: (notice: Notice) => void;
}

interface Arrival {
	scope: object;
	id: string;
	compact: boolean;
	from: Box | null;
	notice: Notice;
	flight: { target: Box; progress: Animated.Value } | null;
}

const layoutDeadlineMs = 500;

export function useFinishTravel({
	board,
	focused,
	compact,
	blocked,
	onScreen,
	shownNodes,
	measure,
	onNotice,
}: Options) {
	const scope = useRef<object | null>(null);
	const [arrival, setArrival] = useState<Arrival | null>(null);
	useLayoutEffect(() => {
		scope.current = focused ? { board } : null;
		setArrival(null);
		return () => {
			scope.current = null;
		};
	}, [board, focused]);

	const start = async (
		node: Node,
		eligible: boolean,
		write: (receive: (notice: Notice) => void) => void,
	) => {
		const owner = scope.current;
		const from =
			eligible && !compact
				? await cardFrame(measure, node.id, node.status)
				: null;
		write((notice) => {
			if (scope.current !== owner) return;
			if (
				owner === null ||
				!eligible ||
				(!compact && from === null) ||
				!notice.undo
			) {
				setArrival(null);
				onNotice(notice);
			} else {
				setArrival({
					scope: owner,
					id: node.id,
					compact,
					from,
					notice,
					flight: null,
				});
			}
		});
	};

	const land = useCallback(
		(next: Arrival) => {
			if (scope.current !== next.scope) return;
			setArrival(null);
			onNotice(next.notice);
		},
		[onNotice],
	);
	const node = shownNodes.find(
		(candidate) => candidate.id === arrival?.id && candidate.status === "done",
	);
	const landed = node !== undefined;
	const playable =
		focused &&
		!blocked &&
		arrival?.compact === compact &&
		(!compact || onScreen === "done");

	useLayoutEffect(() => {
		if (arrival === null || scope.current !== arrival.scope) return;
		if (!playable || (!landed && arrival.flight !== null)) {
			land(arrival);
			return;
		}
		if (arrival.flight !== null) {
			const run = Animated.spring(arrival.flight.progress, {
				...dropSpring,
				toValue: 1,
			});
			run.start(({ finished }) => {
				if (finished) land(arrival);
			});
			return () => run.stop();
		}
		if (!landed) {
			const deadline = setTimeout(() => land(arrival), layoutDeadlineMs);
			return () => clearTimeout(deadline);
		}
		let stale = false;
		void cardFrame(measure, arrival.id, "done").then((target) => {
			if (stale) return;
			if (target === null) {
				land(arrival);
				return;
			}
			setArrival({
				...arrival,
				flight: { target, progress: new Animated.Value(0) },
			});
		});
		return () => {
			stale = true;
		};
	}, [arrival, land, landed, measure, playable]);

	const active = playable && landed ? arrival : null;
	const flight = active?.flight;
	const target = flight?.target;

	return {
		start,
		pending: arrival !== null,
		hiddenId: active?.id,
		flight:
			!active || !flight || !target
				? null
				: {
						left: target.left,
						top: target.top,
						width: target.right - target.left,
						height: target.bottom - target.top,
						transform: [
							{
								translateX: settle(
									flight.progress,
									active.from === null
										? -target.right
										: active.from.left - target.left,
									space.none,
								),
							},
							{
								translateY: settle(
									flight.progress,
									active.from === null
										? space.none
										: active.from.top - target.top,
									space.none,
								),
							},
							{
								scale: settle(flight.progress, compact ? 1 : drag.lift, 1),
							},
						],
					},
		node,
	};
}

function settle(progress: Animated.Value, from: number, to: number) {
	return progress.interpolate({ inputRange: [0, 1], outputRange: [from, to] });
}

async function cardFrame(
	measure: Options["measure"],
	id: string,
	status: Status,
): Promise<Box | null> {
	let deadline: ReturnType<typeof setTimeout> | undefined;
	const measured = Promise.all([
		measure(boardKey),
		measure(columnKey(status)),
		measure(cardKey(id)),
	]);
	const frames = await Promise.race([
		measured,
		new Promise<null>((resolve) => {
			deadline = setTimeout(() => resolve(null), layoutDeadlineMs);
		}),
	]);
	clearTimeout(deadline);
	if (frames === null) return null;
	const [board, column, card] = frames;
	if (
		board === null ||
		column === null ||
		card === null ||
		Math.max(board.left, column.left, card.left) >=
			Math.min(board.right, column.right, card.right) ||
		Math.max(board.top, column.top, card.top) >=
			Math.min(board.bottom, column.bottom, card.bottom)
	)
		return null;
	return {
		left: card.left - board.left,
		right: card.right - board.left,
		top: card.top - board.top,
		bottom: card.bottom - board.top,
	};
}
