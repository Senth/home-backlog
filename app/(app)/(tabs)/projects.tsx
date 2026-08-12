import { useTranslation } from "react-i18next";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { InstallCard } from "@/components/ui/InstallCard";
import { PlaceholderScreen } from "@/components/ui/PlaceholderScreen";
import { useAuth } from "@/contexts/AuthContext";

export default function Projects() {
	const { t } = useTranslation();
	const { user } = useAuth();

	return (
		<PlaceholderScreen
			title={t("screen.projects.title")}
			body={t("screen.projects.empty")}
			// "No projects yet" looks the same whether the board is empty, the app
			// is broken, or you signed in with the wrong Google account. Naming the
			// address is what tells those apart on a phone, where the app bar has
			// no room for the display name.
			footnote={
				user?.email ? t("account.signedInAs", { email: user.email }) : undefined
			}
			action={<AccountMenu />}
		>
			<InstallCard />
		</PlaceholderScreen>
	);
}
