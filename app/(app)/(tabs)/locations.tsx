import { useTranslation } from "react-i18next";
import { PlaceholderScreen } from "@/components/ui/PlaceholderScreen";

export default function Locations() {
	const { t } = useTranslation();

	return (
		<PlaceholderScreen
			title={t("screen.locations.title")}
			body={t("screen.locations.empty")}
		/>
	);
}
