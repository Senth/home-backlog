import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { Appbar, Text } from "react-native-paper";
import { useHome } from "@/contexts/HomeContext";
import { useAppTheme } from "@/theme";
import { contentWidth, space } from "@/theme/tokens";

/**
 * Managing one home: its name, its people, and the two ways out of it.
 *
 * Reached from the chevron on `/homes`, never from the row itself — tapping a
 * home switches to it, and the destructive actions live a level further in
 * rather than beside the thing people tap most often.
 */
export default function ManageHome() {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();
	const { homeId } = useLocalSearchParams<{ homeId: string }>();
	const { homes } = useHome();

	const home = homes.find((candidate) => candidate.id === homeId) ?? null;

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header>
				<Appbar.BackAction
					accessibilityLabel={t("homes.title")}
					onPress={() => router.back()}
				/>
				<Appbar.Content title={t("manageHome.title")} />
			</Appbar.Header>

			<ScrollView
				contentContainerStyle={{
					padding: space.md,
					gap: space.lg,
					alignSelf: "center",
					width: "100%",
					maxWidth: contentWidth.form,
				}}
			>
				<Text variant="titleLarge">{home?.name ?? ""}</Text>
			</ScrollView>
		</View>
	);
}
