import {
	NavigationContext,
	type NavigationProp,
	type ParamListBase,
} from "@react-navigation/native";
import { act, renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";
import {
	RailActionProvider,
	useRailAction,
	useRegisterRailAction,
} from "@/contexts/RailActionContext";

it("registers the focused screen's action, updates it, and clears on blur", () => {
	let focused = true;
	const listeners = new Map<string, () => void>();
	const navigation = {
		isFocused: () => focused,
		addListener: (event: string, listener: () => void) => {
			listeners.set(event, listener);
			return () => listeners.delete(event);
		},
	} as unknown as NavigationProp<ParamListBase>;
	const onPress = jest.fn();
	const action = { label: "Add a project", icon: "plus", onPress };
	function wrapper({ children }: { children: ReactNode }) {
		return (
			<RailActionProvider>
				<NavigationContext.Provider value={navigation}>
					{children}
				</NavigationContext.Provider>
			</RailActionProvider>
		);
	}
	const hook = renderHook(
		({ registered }: { registered: typeof action | null }) => {
			useRegisterRailAction(registered);
			return useRailAction();
		},
		{ wrapper, initialProps: { registered: action as typeof action | null } },
	);
	expect(hook.result.current.action).toEqual(action);
	act(() => hook.result.current.action?.onPress());
	expect(onPress).toHaveBeenCalledTimes(1);
	hook.rerender({ registered: { ...action, label: "Add location" } });
	expect(hook.result.current.action?.label).toBe("Add location");
	act(() => {
		focused = false;
		listeners.get("blur")?.();
	});
	expect(hook.result.current.action).toBeNull();
	act(() => {
		focused = true;
		listeners.get("focus")?.();
	});
	expect(hook.result.current.action?.label).toBe("Add location");
	hook.rerender({ registered: null });
	expect(hook.result.current.action).toBeNull();
	hook.unmount();
});

it("clears the action when its screen unmounts", () => {
	let mounted = true;
	const action = { label: "Add a project", icon: "plus", onPress: jest.fn() };
	const navigation = {
		isFocused: () => true,
		addListener: () => () => {},
	} as unknown as NavigationProp<ParamListBase>;
	function Screen() {
		useRegisterRailAction(action);
		return null;
	}
	function wrapper({ children }: { children: ReactNode }) {
		return (
			<RailActionProvider>
				<NavigationContext.Provider value={navigation}>
					{mounted ? <Screen /> : null}
					{children}
				</NavigationContext.Provider>
			</RailActionProvider>
		);
	}
	const hook = renderHook(() => useRailAction(), { wrapper });
	expect(hook.result.current.action).toEqual(action);
	mounted = false;
	hook.rerender({});
	expect(hook.result.current.action).toBeNull();
});
