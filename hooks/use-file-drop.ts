import type { RefObject } from "react";
import type { ViewInstance } from "react-native";
import type { DropPhase } from "@/models/attachment";

export function useFileDrop(
	_section: RefObject<ViewInstance | null>,
	_onFiles: (files: FileList) => void,
): DropPhase {
	return "idle";
}
