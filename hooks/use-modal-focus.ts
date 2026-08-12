/**
 * Native variant of `use-modal-focus.web.ts`. React Native's own modals are
 * already exclusive to the accessibility focus order and there is no Tab key,
 * so there is nothing to trap.
 */
export function useModalFocus(
	_visible: boolean,
	_testID: string,
	_onDismiss: () => void,
	_options: { returnFocusTo?: string } = {},
) {}
