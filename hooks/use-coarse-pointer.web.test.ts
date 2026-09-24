import { act, renderHook } from "@testing-library/react-native";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer.web";

it("tracks coarse pointer changes and removes the listener on unmount", () => {
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
	const { result, unmount } = renderHook(useCoarsePointer);
	expect(matchMedia).toHaveBeenCalledWith("(pointer: coarse)");
	expect(result.current).toBe(true);
	act(() => onChange({ matches: false } as MediaQueryListEvent));
	expect(result.current).toBe(false);
	unmount();
	expect(removeEventListener).toHaveBeenCalledWith("change", onChange);
	Reflect.deleteProperty(globalThis, "window");
});
