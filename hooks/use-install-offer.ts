import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import {
	decodeInstallOfferDismissed,
	installOfferKey,
} from "@/models/install-offer";

export function useInstallOffer(): {
	visible: boolean;
	install: () => Promise<void>;
	dismiss: () => void;
} {
	const { canInstall, promptInstall } = useInstallPrompt();
	const [loaded, setLoaded] = useState(false);
	const [dismissed, setDismissed] = useState(false);
	const generation = useRef(0);

	useEffect(() => {
		const readGeneration = ++generation.current;
		AsyncStorage.getItem(installOfferKey)
			.catch((reason) => {
				console.warn("Could not read the install offer:", reason);
				return null;
			})
			.then((raw) => {
				if (generation.current !== readGeneration) return;
				setDismissed(decodeInstallOfferDismissed(raw));
				setLoaded(true);
			});
		return () => {
			generation.current++;
		};
	}, []);

	const dismiss = useCallback(() => {
		generation.current++;
		setDismissed(true);
		setLoaded(true);
		AsyncStorage.setItem(installOfferKey, JSON.stringify(true)).catch(
			(reason) => {
				console.warn("Could not save the install offer:", reason);
			},
		);
	}, []);

	return {
		visible: canInstall && loaded && !dismissed,
		install: promptInstall,
		dismiss,
	};
}
