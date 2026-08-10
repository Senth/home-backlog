import { useTranslation } from "react-i18next";
import { Snackbar } from "react-native-paper";
import { useServiceWorker } from "@/hooks/use-service-worker";

/**
 * Offers the newly installed build rather than applying it. A silent swap
 * would discard whatever the user was typing at the time.
 */
export function UpdateBanner() {
	const { t } = useTranslation();
	const { updateReady, applyUpdate } = useServiceWorker();

	return (
		<Snackbar
			visible={updateReady}
			onDismiss={() => {}}
			action={{ label: t("update.reload"), onPress: applyUpdate }}
		>
			{t("update.available")}
		</Snackbar>
	);
}
