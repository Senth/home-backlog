import { type RefObject, useEffect, useState } from "react";
import type { View } from "react-native";
import {
	type DropPhase,
	type DropState,
	nextDropPhase,
} from "@/models/attachment";

export function useFileDrop(
	section: RefObject<View | null>,
	onFiles: (files: FileList) => void,
): DropPhase {
	const [state, setState] = useState<DropState>({ phase: "idle", depth: 0 });

	useEffect(() => {
		const element = section.current as unknown as HTMLElement | null;
		if (element === null) return;
		const isFiles = (event: DragEvent) =>
			event.dataTransfer?.types.includes("Files") ?? false;
		const update = (
			type: Parameters<typeof nextDropPhase>[1]["type"],
			event: DragEvent,
		) =>
			setState((current) =>
				nextDropPhase(current, { type, isFiles: isFiles(event) }),
			);
		const windowEnter = (event: DragEvent) => update("window-enter", event);
		const windowLeave = (event: DragEvent) => update("window-leave", event);
		const sectionEnter = (event: DragEvent) => {
			if (!element.contains(event.relatedTarget as Node | null))
				update("section-enter", event);
		};
		const sectionLeave = (event: DragEvent) => {
			if (!element.contains(event.relatedTarget as Node | null))
				update("section-leave", event);
		};
		const over = (event: DragEvent) => {
			if (isFiles(event)) event.preventDefault();
		};
		const windowDrop = (event: DragEvent) => {
			if (isFiles(event)) event.preventDefault();
			update("drop", event);
		};
		const sectionDrop = (event: DragEvent) => {
			if (isFiles(event)) {
				event.preventDefault();
				if (event.dataTransfer?.files.length) onFiles(event.dataTransfer.files);
			}
		};
		const end = (event: DragEvent) => update("dragend", event);
		window.addEventListener("dragenter", windowEnter);
		window.addEventListener("dragleave", windowLeave);
		window.addEventListener("dragover", over);
		window.addEventListener("drop", windowDrop);
		window.addEventListener("dragend", end);
		element.addEventListener("dragenter", sectionEnter);
		element.addEventListener("dragleave", sectionLeave);
		element.addEventListener("dragover", over);
		element.addEventListener("drop", sectionDrop);
		element.addEventListener("dragend", end);
		return () => {
			window.removeEventListener("dragenter", windowEnter);
			window.removeEventListener("dragleave", windowLeave);
			window.removeEventListener("dragover", over);
			window.removeEventListener("drop", windowDrop);
			window.removeEventListener("dragend", end);
			element.removeEventListener("dragenter", sectionEnter);
			element.removeEventListener("dragleave", sectionLeave);
			element.removeEventListener("dragover", over);
			element.removeEventListener("drop", sectionDrop);
			element.removeEventListener("dragend", end);
		};
	}, [section, onFiles]);

	return state.phase;
}
