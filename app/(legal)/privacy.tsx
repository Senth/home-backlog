import { useTranslation } from "react-i18next";
import { LegalScreen } from "@/components/legal/LegalScreen";

export default function PrivacyPolicy() {
	const { t } = useTranslation();

	return (
		<LegalScreen
			title={t("screen.privacy.title")}
			intro={t("screen.privacy.intro")}
			sections={[
				{
					heading: t("screen.privacy.accountTitle"),
					paragraphs: [
						t("screen.privacy.accountBody"),
						t("screen.privacy.accountSession"),
					],
				},
				{
					heading: t("screen.privacy.contentTitle"),
					paragraphs: [
						t("screen.privacy.contentBody"),
						t("screen.privacy.contentMembers"),
						t("screen.privacy.contentInvites"),
					],
				},
				{
					heading: t("screen.privacy.keysTitle"),
					paragraphs: [
						t("screen.privacy.keysStorage"),
						t("screen.privacy.keysRequests"),
					],
				},
				{
					heading: t("screen.privacy.deviceTitle"),
					paragraphs: [
						t("screen.privacy.deviceOffline"),
						t("screen.privacy.deviceShell"),
					],
				},
				{
					heading: t("screen.privacy.neverTitle"),
					paragraphs: [t("screen.privacy.neverBody")],
				},
				{
					heading: t("screen.privacy.deletionTitle"),
					paragraphs: [
						t("screen.privacy.deletionHome"),
						t("screen.privacy.deletionSignout"),
					],
				},
			]}
		/>
	);
}
