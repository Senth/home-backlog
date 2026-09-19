import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { ActivityIndicator, Appbar, Button, Text } from "react-native-paper";
import { CardEditForm } from "@/components/overview/CardEditForm";
import { useCardWrites } from "@/components/overview/use-card-writes";
import { BackAction } from "@/components/ui/BackAction";
import { useDashboardCardsConfig } from "@/contexts/DashboardCardsContext";
import { useHome } from "@/contexts/HomeContext";
import { useLocations } from "@/hooks/use-locations";
import { membersOf } from "@/models/home";
import type { Card, CardScope } from "@/models/overview-cards";
import { useAppTheme } from "@/theme";
import { space, touchTarget } from "@/theme/tokens";

/**
 * One overview card, added or edited — the form the editor used to open as a
 * dialog, on a page of its own with a back arrow (#307).
 *
 * The card arrives as a `cardId` parameter and is looked up in the one
 * card-config context the whole `(app)` stack shares; no parameter is a new
 * card. Save writes through the same data layer the editor uses and returns
 * to the editor by name — never `router.back()`, which is a dead arrow after
 * a reload or a pasted URL.
 */
export default function OverviewCardEdit() {
	const { t } = useTranslation();
	const theme = useAppTheme();
	const router = useRouter();
	const { activeHome } = useHome();
	const { cardId } = useLocalSearchParams<{ cardId?: string }>();
	const { editorCards, loading, failed, retry } = useDashboardCardsConfig();
	const { locations } = useLocations(activeHome?.id ?? null);
	const { createIn, replaceIn, moveScope } = useCardWrites();

	const members = useMemo(
		() => (activeHome === null ? [] : membersOf(activeHome)),
		[activeHome],
	);

	// Until the config has answered, the lookup cannot say "new card" — it
	// would mount the form as an add and a later answer could not fix the
	// draft. Loading holds the form back instead.
	const entry =
		cardId === undefined
			? null
			: (editorCards.find((each) => each.card.id === cardId) ?? null);

	const save = (draft: Card, scope: CardScope) => {
		if (entry === null) createIn(scope, draft);
		else if (entry.scope === scope) replaceIn(scope, draft);
		else moveScope(draft, entry.scope, scope);
		router.replace("/overview-editor");
	};

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Appbar.Header>
				<BackAction
					accessibilityLabel={t("overview.cards.editor.title")}
					onPress={() => router.replace("/overview-editor")}
				/>
				<Appbar.Content
					title={
						entry === null
							? t("overview.cards.editor.add")
							: t("overview.cards.edit.title")
					}
				/>
			</Appbar.Header>

			{loading ? (
				<ActivityIndicator
					accessibilityLabel={t("common.loading")}
					style={{ marginTop: space.xl }}
				/>
			) : failed ? (
				<View style={{ gap: space.md, padding: space.md }}>
					<Text
						variant="bodyMedium"
						style={{ color: theme.colors.onSurfaceVariant }}
					>
						{t("overview.loadFailed")}
					</Text>
					<Button
						mode="contained-tonal"
						icon="refresh"
						onPress={retry}
						contentStyle={{ minHeight: touchTarget }}
						style={{ alignSelf: "flex-start" }}
					>
						{t("common.retry")}
					</Button>
				</View>
			) : (
				<CardEditForm
					card={entry?.card ?? null}
					scope={entry?.scope ?? "global"}
					members={members}
					locations={locations}
					labels={activeHome?.labels ?? []}
					onSave={save}
				/>
			)}
		</View>
	);
}
