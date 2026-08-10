import { useTranslation } from "react-i18next";
import { Appbar } from "react-native-paper";
import { InstallCard } from "@/components/ui/InstallCard";
import { PlaceholderScreen } from "@/components/ui/PlaceholderScreen";
import { useAuth } from "@/contexts/AuthContext";

export default function Projects() {
	const { t } = useTranslation();
	const { signOut } = useAuth();

	return (
		<PlaceholderScreen
			title={t("screen.projects.title")}
			body={t("screen.projects.empty")}
			action={
				<Appbar.Action
					icon="logout"
					accessibilityLabel={t("common.signOut")}
					onPress={signOut}
				/>
			}
		>
			<InstallCard />
		</PlaceholderScreen>
	);
}
