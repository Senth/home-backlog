import { act, renderHook } from "@testing-library/react-native";
import { useCoarsePointer, useFinePointer } from "@/hooks/use-pointer.web";

it("tracks coarse pointer changes and removes the listener on unmount", async () => {
	let onChange: (event: MediaQueryListEvent) => void = () => {};
	const addEventListener = jest.fn(
		(_type: string, listener: typeof onChange) => {
			onChange = listener;
		},
	);
	const removeEventListener = jest.fn();
	const matchMedia = jest.fn(() => ({
		matches: true,
		addEventListener,
		removeEventListener,
	}));
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: { matchMedia },
	});
	const { result, unmount } = await renderHook(useCoarsePointer);
	expect(matchMedia).toHaveBeenCalledWith("(pointer: coarse)");
	expect(result.current).toBe(true);
	await act(() => onChange({ matches: false } as MediaQueryListEvent));
	expect(result.current).toBe(false);
	await unmount();
	expect(removeEventListener).toHaveBeenCalledWith("change", onChange);
	Reflect.deleteProperty(globalThis, "window");
});

it("asks for a fine pointer with hover, the query the scrollbar stylesheet uses", async () => {
	const matchMedia = jest.fn(() => ({
		matches: true,
		addEventListener: jest.fn(),
		removeEventListener: jest.fn(),
	}));
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: { matchMedia },
	});
	const { result } = await renderHook(useFinePointer);
	expect(matchMedia).toHaveBeenCalledWith("(hover: hover) and (pointer: fine)");
	expect(result.current).toBe(true);
	Reflect.deleteProperty(globalThis, "window");
});
