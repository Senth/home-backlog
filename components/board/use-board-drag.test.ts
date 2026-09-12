import { act, renderHook } from "@testing-library/react-native";
import type { View } from "react-native";
import {
	boardKey,
	cardKey,
	chipKey,
	columnKey,
	useBoardDrag,
} from "@/components/board/use-board-drag";
import { moveNode } from "@/data/nodes";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { paneDwellMs, paneRepeatDwellMs } from "@/models/drag";
import type { Node, Status } from "@/models/node";

/**
 * `models/drag.ts` decides *where* a dropped card lands and is tested on its
 * own. What is here is the half that has no pure answer: a gesture that has to
 * survive being measured asynchronously, a board arriving underneath it, and a
 * press that is over before the card ever lifts.
 */

jest.mock("@/data/nodes", () => ({
	moveNode: jest.fn(() => Promise.resolve()),
}));

jest.mock("@/hooks/use-reduced-motion", () => ({
	useReducedMotion: jest.fn(),
}));

jest.mock("react-i18next", () => ({
	// The keys are asserted rather than the sentences: both locale files are
	// checked for parity by `yarn invariants`, and a test that pinned the English
	// would fail on a rewording that is not a behavior change.
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values === undefined ? key : `${key}:${JSON.stringify(values)}`,
	}),
}));

const moved = moveNode as jest.MockedFunction<typeof moveNode>;
const reducedMotion = useReducedMotion as jest.MockedFunction<
	typeof useReducedMotion
>;

const homeId = "home-1";
const shown: Status[] = ["backlog", "next_up"];

function node(id: string, rank: string, status: Status = "backlog"): Node {
	return { id, title: id, rank, status, parentId: null } as unknown as Node;
}

/** A view that answers `measureInWindow` on a later turn, as the real one does. */
function box(top: number, height: number, left = 0, width = 300): View {
	return {
		measureInWindow: (callback: (...frame: number[]) => void) => {
			setTimeout(() => callback(left, top, width, height), 0);
		},
	} as unknown as View;
}

interface Board {
	cards: Node[];
	/** Below the breakpoint: which pane is on screen, and how many there are. */
	pane?: number;
}

function board({ cards, pane }: Board) {
	const onNotice = jest.fn();
	const onChange = jest.fn();

	// The pane goes through props and comes back as a re-render, the way the
	// board really moves: a walk that only called a spy would never change the
	// index the drag reads, and the re-measure it triggers would never run.
	const view = renderHook(
		(props: { nodes: Node[]; index: number }) =>
			useBoardDrag({
				homeId,
				nodes: props.nodes,
				shown,
				onNotice,
				pane:
					pane === undefined
						? undefined
						: {
								index: props.index,
								count: shown.length,
								onChange: (next: number) => {
									onChange(next);
									props.index = next;
									act(() => view.rerender({ nodes: props.nodes, index: next }));
									showPane(next);
								},
							},
			}),
		{ initialProps: { nodes: cards, index: pane ?? 0 } },
	);

	// The board is 300 wide and 600 tall; every card is 100 tall in the order it
	// is given.
	const register = view.result.current.register;
	register(boardKey)(box(0, 600));
	cards.forEach((card, index) => {
		register(cardKey(card.id))(box(index * 100, 100));
	});

	/**
	 * Which column fills the board.
	 *
	 * Below the breakpoint every pane is mounted and one is shown, so the panes
	 * that are not on screen measure as nothing — which is what keeps them from
	 * winning a hit test. A harness where every column filled the board would
	 * agree with any answer.
	 */
	const showPane = (index: number) => {
		shown.forEach((status, at) => {
			register(columnKey(status))(at === index ? box(0, 600) : box(0, 0, 0, 0));
		});
	};
	showPane(pane ?? 0);

	/** Runs the measuring the grab is waiting on. */
	const measured = async () => {
		await act(async () => {
			jest.runAllTimers();
		});
	};

	/** The board's listeners delivering something while the card is in the air. */
	const arrive = (nodes: Node[]) => {
		act(() => view.rerender({ nodes, index: pane ?? 0 }));
	};

	/**
	 * One card's gesture, read fresh on every step — which is what `DragArea`
	 * does: it keeps the callbacks in a ref it rewrites on each render, so a drop
	 * runs against the board as it is now and not as it was when the card lifted.
	 */
	const gesture = (card: Node) => ({
		grab: (point: { x: number; y: number }) => {
			act(() => view.result.current.handlers(card).onGrab(point));
		},
		move: (point: { x: number; y: number }) => {
			act(() => view.result.current.handlers(card).onMove(point));
		},
		drop: () => {
			act(() => view.result.current.handlers(card).onDrop());
		},
		cancel: () => {
			act(() => view.result.current.handlers(card).onCancel());
		},
	});

	return { view, onNotice, onChange, register, measured, arrive, gesture };
}

beforeEach(() => {
	jest.useFakeTimers();
	moved.mockClear();
	reducedMotion.mockReturnValue(false);
});

afterEach(() => {
	jest.useRealTimers();
});

const a = node("a", "V0");
const b = node("b", "V1");
const c = node("c", "V2");

describe("useBoardDrag", () => {
	it("writes the drop and offers the way back", async () => {
		const { onNotice, measured, gesture } = board({ cards: [a, b, c] });
		const card = gesture(a);

		card.grab({ x: 10, y: 50 });
		await measured();
		card.move({ x: 10, y: 290 });
		card.drop();

		expect(moved).toHaveBeenCalledTimes(1);
		const [, dragged, status, rank] = moved.mock.calls[0] ?? [];
		expect((dragged as Node).id).toBe("a");
		expect(status).toBe("backlog");
		expect((rank as string) > c.rank).toBe(true);

		const notice = onNotice.mock.calls[0]?.[0];
		expect(notice.text).toBe("board.movedDown");

		notice.undo();
		expect(moved).toHaveBeenCalledTimes(2);
		// Back to the status and the rank it had, both of which were in hand.
		expect(moved.mock.calls[1]?.[2]).toBe("backlog");
		expect(moved.mock.calls[1]?.[3]).toBe(a.rank);
	});

	it("says nothing and writes nothing for a card put back where it was", async () => {
		const { onNotice, measured, gesture } = board({ cards: [a, b, c] });
		const card = gesture(b);

		card.grab({ x: 10, y: 150 });
		await measured();
		card.move({ x: 10, y: 160 });
		card.drop();

		expect(moved).not.toHaveBeenCalled();
		expect(onNotice).not.toHaveBeenCalled();
	});

	it("puts a card back, and says so, when it is dropped outside every column", async () => {
		const { view, onNotice, register, measured, gesture } = board({
			cards: [a, b, c],
		});
		// The card is carried over the strip's chip first, so the gap has been
		// somewhere else before the finger leaves the board — the escape has to
		// win even then.
		register(chipKey("next_up"))(box(0, 40, 100, 80));
		const card = gesture(a);

		card.grab({ x: 10, y: 50 });
		await measured();
		card.move({ x: 150, y: 20 });
		card.move({ x: 500, y: 700 });
		// The gap is the only indicator, so "nowhere" is shown by it being gone.
		expect(view.result.current.over).toBeNull();
		card.drop();

		expect(moved).not.toHaveBeenCalled();
		expect(onNotice).toHaveBeenCalledWith({ text: "board.putBack" });
	});

	it("refuses to resurrect a card deleted while it was carried", async () => {
		const { onNotice, measured, arrive, gesture } = board({
			cards: [a, b, c],
		});
		const card = gesture(a);

		card.grab({ x: 10, y: 50 });
		await measured();
		// Deleted by somebody else while it was in the air.
		arrive([b, c]);
		card.move({ x: 10, y: 290 });
		card.drop();

		expect(moved).not.toHaveBeenCalled();
		expect(onNotice).toHaveBeenCalledWith({ text: "board.gone" });
	});

	it("drops a card on a chip by appending it to that column", async () => {
		const { onNotice, register, measured, gesture } = board({
			cards: [a, b, c],
		});
		// The strip sits above the board, and its chips are the way across on a
		// phone.
		register(chipKey("next_up"))(box(0, 40, 100, 80));
		const card = gesture(a);

		card.grab({ x: 10, y: 50 });
		await measured();
		card.move({ x: 150, y: 20 });
		card.drop();

		expect(moved.mock.calls[0]?.[2]).toBe("next_up");
		expect(onNotice.mock.calls[0]?.[0].text).toContain("board.moved");
	});

	it("lifts nothing when the press is over before the measuring is", async () => {
		const { view, measured, gesture } = board({ cards: [a, b, c] });
		const card = gesture(a);

		card.grab({ x: 10, y: 50 });
		// Released inside the measuring window — a click, not a drag.
		card.drop();
		await measured();

		expect(view.result.current.node).toBeNull();
		expect(view.result.current.overlay).toBeNull();
		expect(moved).not.toHaveBeenCalled();
	});

	it("keeps drawing the board as it was when the card lifted", async () => {
		const arrival = node("d", "V3");
		const { view, measured, arrive, gesture } = board({ cards: [a, b, c] });
		const card = gesture(a);

		card.grab({ x: 10, y: 50 });
		await measured();
		arrive([a, b, c, arrival]);

		expect(view.result.current.cards).toEqual([a, b, c]);

		card.cancel();
		act(() => {
			jest.runAllTimers();
		});

		expect(view.result.current.cards).toEqual([a, b, c, arrival]);
	});

	it("lands the card at once instead of settling it when motion is reduced", async () => {
		// docs/DESIGN.md § Motion: no spring on release — the card is already
		// where the finger left it, so it lands there without a timer running.
		reducedMotion.mockReturnValue(true);
		const { view, measured, gesture } = board({ cards: [a, b, c] });
		const card = gesture(a);

		card.grab({ x: 10, y: 50 });
		await measured();
		expect(view.result.current.node).not.toBeNull();

		card.cancel();

		expect(view.result.current.node).toBeNull();
		expect(view.result.current.overlay).toBeNull();
		expect(view.result.current.cards).toEqual([a, b, c]);
	});

	it("walks the board one pane per dwell while a card rests at the edge", async () => {
		const { onChange, measured, gesture } = board({
			cards: [a, b, c],
			pane: 1,
		});
		const card = gesture(a);

		card.grab({ x: 10, y: 50 });
		await measured();
		card.move({ x: 2, y: 300 });

		act(() => {
			jest.advanceTimersByTime(paneDwellMs + 50);
		});
		expect(onChange).toHaveBeenLastCalledWith(0);

		// And the walk stops the moment the card is put down, rather than taking
		// the board one more pane after the finger has gone.
		onChange.mockClear();
		card.cancel();
		act(() => {
			jest.advanceTimersByTime(paneRepeatDwellMs * 2);
		});
		expect(onChange).not.toHaveBeenCalled();
	});

	it("places the gap in the pane the walk arrived at, with the finger still", async () => {
		// The cards are in the pane on screen; walking left reaches an empty one.
		const later = [a, b, c].map((card) => ({ ...card, status: "next_up" }));
		const { onChange, measured, gesture } = board({
			cards: later as Node[],
			pane: 1,
		});
		const card = gesture(later[0] as Node);

		card.grab({ x: 10, y: 50 });
		await measured();
		card.move({ x: 2, y: 300 });

		act(() => {
			jest.advanceTimersByTime(paneDwellMs + 50);
		});
		expect(onChange).toHaveBeenLastCalledWith(0);

		// The board moved under the finger, and the finger has not moved since —
		// so nothing but the re-measure can put the gap in the pane that arrived.
		await act(async () => {
			jest.runAllTimers();
		});
		card.drop();

		expect(moved.mock.calls[0]?.[2]).toBe("backlog");
	});
});
