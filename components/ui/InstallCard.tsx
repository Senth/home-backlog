import { useTranslation } from "react-i18next";
import { Button, Card, Text } from "react-native-paper";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { space } from "@/theme/tokens";

/**
 * Offers the PWA install once the browser has said it is possible. Renders
 * nothing otherwise, so it costs no space on native or in Safari.
 */
export function InstallCard() {
	const { t } = useTranslation();
	const { canInstall, promptInstall } = useInstallPrompt();

	if (!canInstall) return null;

	return (
		<Card mode="outlined" style={{ margin: space.md }}>
			<Card.Title title={t("install.title")} />
			<Card.Content>
				<Text variant="bodyMedium">{t("install.body")}</Text>
			</Card.Content>
			<Card.Actions>
				<Button onPress={promptInstall}>{t("install.action")}</Button>
			</Card.Actions>
		</Card>
	);
}
