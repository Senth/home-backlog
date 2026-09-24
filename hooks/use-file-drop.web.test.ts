import { act, renderHook } from "@testing-library/react-native";
import type { RefObject } from "react";
import type { View } from "react-native";
import { useFileDrop } from "@/hooks/use-file-drop.web";

function drag(type: string, files: File[] = []) {
	const event = new Event(type, { cancelable: true }) as DragEvent;
	Object.defineProperty(event, "dataTransfer", {
		value: { types: files.length ? ["Files"] : ["text/plain"], files },
	});
	return event;
}

it("arms on a window file drag, attaches only inside the section, and protects missed drops", () => {
	const target = new EventTarget();
	const section = new EventTarget();
	Object.defineProperty(section, "contains", { value: () => false });
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: target,
	});
	const onFiles = jest.fn();
	const ref = { current: section as unknown as View } as RefObject<View>;
	const { result, unmount } = renderHook(() => useFileDrop(ref, onFiles));
	const files = [{ name: "photo.jpg" }] as File[];
	act(() => target.dispatchEvent(drag("dragenter", files)));
	expect(result.current).toBe("armed");
	act(() => section.dispatchEvent(drag("dragenter", files)));
	expect(result.current).toBe("over");
	const outside = drag("drop", files);
	act(() => target.dispatchEvent(outside));
	expect(outside.defaultPrevented).toBe(true);
	expect(onFiles).not.toHaveBeenCalled();
	expect(result.current).toBe("idle");
	const inside = drag("drop", files);
	act(() => section.dispatchEvent(inside));
	expect(onFiles).toHaveBeenCalledWith(files);
	const text = drag("dragover");
	target.dispatchEvent(text);
	expect(text.defaultPrevented).toBe(false);
	unmount();
	Reflect.deleteProperty(globalThis, "window");
});
