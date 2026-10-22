import { act, renderHook } from "@testing-library/react-native";
import type { RefObject } from "react";
import type { ViewInstance } from "react-native";
import { useFileDrop } from "@/hooks/use-file-drop.web";

function drag(type: string, files: File[] = []) {
	const event = new Event(type, { cancelable: true }) as DragEvent;
	Object.defineProperty(event, "dataTransfer", {
		value: { types: files.length ? ["Files"] : ["text/plain"], files },
	});
	return event;
}

it("arms on a window file drag, attaches only inside the section, and protects missed drops", async () => {
	const target = new EventTarget();
	const section = new EventTarget();
	Object.defineProperty(section, "contains", { value: () => false });
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: target,
	});
	const onFiles = jest.fn();
	const ref = {
		current: section as unknown as ViewInstance,
	} as RefObject<ViewInstance>;
	const { result, unmount } = await renderHook(() => useFileDrop(ref, onFiles));
	const files = [{ name: "photo.jpg" }] as File[];
	await act(() => target.dispatchEvent(drag("dragenter", files)));
	expect(result.current).toBe("armed");
	await act(() => section.dispatchEvent(drag("dragenter", files)));
	expect(result.current).toBe("over");
	const outside = drag("drop", files);
	await act(() => target.dispatchEvent(outside));
	expect(outside.defaultPrevented).toBe(true);
	expect(onFiles).not.toHaveBeenCalled();
	expect(result.current).toBe("idle");
	const inside = drag("drop", files);
	await act(() => section.dispatchEvent(inside));
	expect(onFiles).toHaveBeenCalledWith(files);
	const text = drag("dragover");
	target.dispatchEvent(text);
	expect(text.defaultPrevented).toBe(false);
	await unmount();
	Reflect.deleteProperty(globalThis, "window");
});
