import { useTranslation } from "react-i18next";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { PlaceholderScreen } from "@/components/ui/PlaceholderScreen";

export default function Maintenance() {
	const { t } = useTranslation();

	return (
		<PlaceholderScreen
			body={t("screen.maintenance.empty")}
			action={<AccountMenu />}
		/>
	);
}
