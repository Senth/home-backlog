import { act, renderHook } from "@testing-library/react-native";
import { Animated } from "react-native";
import type { Notice } from "@/components/board/CardMenu";
import { boardKey, cardKey } from "@/components/board/use-board-drag";
import { useFinishTravel } from "@/components/board/use-finish-travel";
import type { Node } from "@/models/node";

jest.mock("@/data/nodes", () => ({ moveNodes: jest.fn() }));

const project = { id: "project", status: "execution" } as Node;
const done = { ...project, status: "done" } as Node;
const success = { text: "board.moved", undo: jest.fn() };
const write = (receive: (notice: Notice) => void) => receive(success);
const frame = { left: 80, top: 64, right: 1280, bottom: 800 };

function options(): Parameters<typeof useFinishTravel>[0] {
	return {
		board: "home",
		focused: true,
		compact: false,
		blocked: false,
		onScreen: undefined,
		shownNodes: [project],
		onNotice: jest.fn(),
		measure: jest.fn(async () => frame),
	};
}

it("moves without travel when the source slot is scrolled out of view", async () => {
	const initialProps = {
		...options(),
		measure: async (key: string) =>
			key === cardKey(project.id)
				? { ...frame, top: -200, bottom: -100 }
				: frame,
	};
	const { result } = await renderHook(useFinishTravel, { initialProps });
	await act(() => result.current.start(project, true, write));
	expect(result.current.flight).toBeNull();
	expect(initialProps.onNotice).toHaveBeenCalledWith(success);
});

it("stops an arrival if a drag starts and does not replay it after the drag", async () => {
	const initialProps = options();
	const stop = jest.fn();
	const spring = jest.spyOn(Animated, "spring").mockReturnValue({
		start: jest.fn(),
		stop,
		reset: jest.fn(),
	});
	try {
		const { result, rerender } = await renderHook(useFinishTravel, {
			initialProps,
		});
		await act(() => result.current.start(project, true, write));
		const landed = { ...initialProps, shownNodes: [done] };
		await rerender(landed);
		expect(spring).toHaveBeenCalledTimes(1);
		expect(initialProps.measure).toHaveBeenCalledWith(boardKey);
		expect(initialProps.onNotice).not.toHaveBeenCalled();
		await rerender({ ...landed, blocked: true });
		expect(stop).toHaveBeenCalledTimes(1);
		expect(result.current.hiddenId).toBeUndefined();
		expect(initialProps.onNotice).toHaveBeenCalledWith(success);
		await rerender(landed);
		expect(spring).toHaveBeenCalledTimes(1);
	} finally {
		spring.mockRestore();
	}
});
