import { useTranslation } from "react-i18next";
import { LegalScreen } from "@/components/legal/LegalScreen";

export default function TermsOfService() {
	const { t } = useTranslation();

	return (
		<LegalScreen
			title={t("screen.terms.title")}
			intro={t("screen.terms.intro")}
			sections={[
				{
					heading: t("screen.terms.useTitle"),
					paragraphs: [t("screen.terms.useBody")],
				},
				{
					heading: t("screen.terms.contentTitle"),
					paragraphs: [t("screen.terms.contentBody")],
				},
				{
					heading: t("screen.terms.availabilityTitle"),
					paragraphs: [t("screen.terms.availabilityBody")],
				},
				{
					heading: t("screen.terms.changesTitle"),
					paragraphs: [t("screen.terms.changesBody")],
				},
			]}
		/>
	);
}
