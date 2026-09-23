import type { RefObject } from "react";
import type { View } from "react-native";

/**
 * Native variant of `use-modal-focus.web.ts`. React Native's own modals are
 * already exclusive to the accessibility focus order and there is no Tab key,
 * so there is nothing to trap — and no DOM focus for a `Menu` to steal.
 */
export function useModalFocus(
	_visible: boolean,
	_testID: string,
	_onDismiss: () => void,
	_options: {
		returnFocusTo?: RefObject<View | null>;
		scrim?: { testID: string; label: string };
	} = {},
) {}

export function useTabTrap(_active: boolean, _testID: string): void {}
