import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Appbar, Text } from "react-native-paper";
import { BackAction } from "@/components/ui/BackAction";
import { SlimScrollView } from "@/components/ui/SlimScrollView";
import { useAuth } from "@/contexts/AuthContext";
import { useAppTheme } from "@/theme";
import { contentWidth, space } from "@/theme/tokens";

export interface LegalSection {
	heading: string;
	paragraphs: readonly string[];
}

interface LegalScreenProps {
	title: string;
	intro: string;
	sections: readonly LegalSection[];
}

/**
 * One legal page: a back arrow, a title, and prose.
 *
 * The back arrow cannot be `router.back()` alone: a legal page is reachable
 * with no in-app history — a pasted URL, a link from the login screen opened
 * in a fresh tab — and there `back()` is a no-op that leaves the arrow dead.
 * Someone signed out returns to the login screen; someone signed in has no
 * reason to be here except by accident, and goes to the overview.
 */
export function LegalScreen({ title, intro, sections }: LegalScreenProps) {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();
	const { user } = useAuth();

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header>
				<BackAction
					accessibilityLabel={t("common.back")}
					onPress={() =>
						router.canGoBack()
							? router.back()
							: router.replace(
									user ? "/(app)/(tabs)/overview" : "/(auth)/login",
								)
					}
				/>
				<Appbar.Content title={title} />
			</Appbar.Header>

			<SlimScrollView
				contentContainerStyle={{
					padding: space.md,
					gap: space.lg,
					alignSelf: "center",
					width: "100%",
					maxWidth: contentWidth.form,
				}}
			>
				<Text
					variant="bodyMedium"
					style={{ color: theme.colors.onSurfaceVariant }}
				>
					{intro}
				</Text>
				{sections.map((section) => (
					<View key={section.heading} style={{ gap: space.md }}>
						<Text variant="titleMedium">{section.heading}</Text>
						{section.paragraphs.map((paragraph) => (
							<Text key={paragraph} variant="bodyLarge">
								{paragraph}
							</Text>
						))}
					</View>
				))}
			</SlimScrollView>
		</View>
	);
}
