import { useTranslation } from "react-i18next";
import { PlaceholderScreen } from "@/components/ui/PlaceholderScreen";

export default function Maintenance() {
	const { t } = useTranslation();

	return (
		<PlaceholderScreen
			title={t("screen.maintenance.title")}
			body={t("screen.maintenance.empty")}
		/>
	);
}
