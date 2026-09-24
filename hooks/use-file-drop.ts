import type { RefObject } from "react";
import type { View } from "react-native";
import type { DropPhase } from "@/models/attachment";

export function useFileDrop(
	_section: RefObject<View | null>,
	_onFiles: (files: FileList) => void,
): DropPhase {
	return "idle";
}
