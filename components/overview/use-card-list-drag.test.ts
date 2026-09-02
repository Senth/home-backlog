import { act, renderHook } from "@testing-library/react-native";
import type { View } from "react-native";
import {
	listKey,
	rowKey,
	useCardListDrag,
} from "@/components/overview/use-card-list-drag";

/**
 * The pure half — where a dropped card lands and what rank it takes — is
 * `models/drag.ts`'s, already tested. What is here is the list-shaped half:
 * the frozen order, the gap, and the write the drop makes.
 */

jest.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

function card(id: string, rank: string): { id: string; rank: string } {
	return { id, rank };
}

/** A view that answers `measureInWindow` on a later turn, as the real one does. */
function box(top: number, height: number, left = 0, width = 300): View {
	return {
		measureInWindow: (callback: (...frame: number[]) => void) => {
			setTimeout(() => callback(left, top, width, height), 0);
		},
	} as unknown as View;
}

type ListCard = { id: string; rank: string };

function list(cards: ListCard[]) {
	const onMove = jest.fn();
	const view = renderHook(
		(props: { cards: ListCard[] }) =>
			useCardListDrag({ cards: props.cards, onMove }),
		{ initialProps: { cards } },
	);

	// The list is 300 wide; every row is 100 tall in the order it is given.
	const register = view.result.current.register;
	register(listKey)(box(0, cards.length * 100));
	cards.forEach((each, index) => {
		register(rowKey(each.id))(box(index * 100, 100));
	});

	const measured = async () => {
		await act(async () => {
			jest.runAllTimers();
		});
	};

	const gesture = (id: string) => ({
		grab: (point: { x: number; y: number }) => {
			act(() => view.result.current.handlers(id).onGrab(point));
		},
		move: (point: { x: number; y: number }) => {
			act(() => view.result.current.handlers(id).onMove(point));
		},
		drop: () => {
			act(() => view.result.current.handlers(id).onDrop());
		},
		cancel: () => {
			act(() => view.result.current.handlers(id).onCancel());
		},
	});

	return { view, onMove, register, measured, gesture };
}

beforeEach(() => {
	jest.useFakeTimers();
});

afterEach(() => {
	jest.useRealTimers();
});

const a = card("a", "V0");
const b = card("b", "V1");
const c = card("c", "V2");

describe("useCardListDrag", () => {
	it("writes the rank between the neighbours a drop lands between", async () => {
		const { onMove, measured, gesture } = list([a, b, c]);
		const drag = gesture("a");

		drag.grab({ x: 10, y: 50 });
		await measured();
		// Past b's middle, short of c's: the slot between b and c.
		drag.move({ x: 10, y: 200 });
		drag.drop();

		expect(onMove).toHaveBeenCalledTimes(1);
		const [id, rank] = onMove.mock.calls[0] ?? [];
		expect(id).toBe("a");
		expect((rank as string) > b.rank).toBe(true);
		expect((rank as string) < c.rank).toBe(true);
	});

	it("writes nothing for a card put back where it was", async () => {
		const { onMove, measured, gesture } = list([a, b, c]);
		const drag = gesture("b");

		drag.grab({ x: 10, y: 150 });
		await measured();
		drag.move({ x: 10, y: 160 });
		drag.drop();

		expect(onMove).not.toHaveBeenCalled();
	});

	it("freezes the order while a card is up and hands back on cancel", async () => {
		const arrival = card("d", "V3");
		const { view, measured, gesture } = list([a, b, c]);
		const drag = gesture("a");

		drag.grab({ x: 10, y: 50 });
		await measured();
		act(() => view.rerender({ cards: [a, b, c, arrival] }));

		expect(view.result.current.order).toEqual([a, b, c]);

		drag.cancel();
		expect(view.result.current.order).toEqual([a, b, c, arrival]);
	});

	it("opens a gap where the finger is, with the dragged row out of the list", async () => {
		const { view, measured, gesture } = list([a, b, c]);
		const drag = gesture("a");

		expect(view.result.current.gapIndex).toBeNull();

		drag.grab({ x: 10, y: 50 });
		await measured();
		expect(view.result.current.draggedId).toBe("a");
		expect(view.result.current.order).toEqual([a, b, c]);

		// Down past b's middle, short of c's: the gap sits at slot 1 of the two
		// rows left.
		drag.move({ x: 10, y: 200 });
		expect(view.result.current.gapIndex).toBe(1);
		expect(view.result.current.gapHeight).toBe(100);
	});

	it("lifts nothing when the press is over before the measuring is", async () => {
		const { view, onMove, measured, gesture } = list([a, b, c]);
		const drag = gesture("a");

		drag.grab({ x: 10, y: 50 });
		drag.drop();
		await measured();

		expect(view.result.current.draggedId).toBeNull();
		expect(onMove).not.toHaveBeenCalled();
	});
});
