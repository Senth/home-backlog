import { useFocusEffect } from "@react-navigation/native";
import {
	createContext,
	type Dispatch,
	type ReactNode,
	type SetStateAction,
	useCallback,
	useContext,
	useState,
} from "react";

interface RailAction {
	label: string;
	icon: string;
	onPress: () => void;
}

const RailActionContext = createContext<{
	action: RailAction | null;
	setAction: Dispatch<SetStateAction<RailAction | null>>;
} | null>(null);

export function RailActionProvider({ children }: { children: ReactNode }) {
	const [action, setAction] = useState<RailAction | null>(null);
	return (
		<RailActionContext.Provider value={{ action, setAction }}>
			{children}
		</RailActionContext.Provider>
	);
}

export function useRailAction() {
	const context = useContext(RailActionContext);
	if (context === null) {
		throw new Error("useRailAction must be used within RailActionProvider");
	}
	return context;
}

export function useRegisterRailAction(action: RailAction | null) {
	const { setAction } = useRailAction();
	const label = action?.label;
	const icon = action?.icon;
	const onPress = action?.onPress;
	useFocusEffect(
		useCallback(() => {
			setAction(label && icon && onPress ? { label, icon, onPress } : null);
			return () => setAction(null);
		}, [setAction, label, icon, onPress]),
	);
}
